// Job document rules. Firestore metadata and Storage bytes.
// Runs under firebase emulators:exec. Fake data only. Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, serverTimestamp, Timestamp } from "firebase/firestore";
import { deleteObject, getBytes, listAll, ref, uploadBytes } from "firebase/storage";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const PATRICK = "R7t41e54Ykcdk9WPdVZnDd697iI2";
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const CREW_ID = "dCrewDoc12345678";
const OFFICE_ID = "dOfficeDoc123456";

const firestoreProd = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
const firestoreEmu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
const storageRules = readFileSync(new URL("../production/storage.rules", import.meta.url), "utf8");

function company(extra) {
  return {
    name: "Co", legalName: "Co", abn: "1", signoff: "Co", logoUrl: "", address: "1 St", phone: "",
    email: "office@co.test", accountsEmail: "accounts@co.test", hubdocAddress: "",
    status: "active", plan: "trial", origin: "signup", isTest: false,
    trialEndsAt: Timestamp.fromDate(new Date(NOW + 7 * DAY)),
    billing: { provider: null, status: "not-configured", stripeCustomerId: null, stripeSubscriptionId: null },
    ...extra,
  };
}
function meta(uid, tenantId, jobId, visibility, fileName, contentType = "application/pdf") {
  return { contentType, customMetadata: { tenantId, jobId, uploaderUid: uid, purpose: "job-document", visibility, fileName } };
}
function docBody(companyId, jobId, docId, uid, extra = {}) {
  return {
    companyId, tenantId: companyId, jobId,
    name: extra.name || "Plan",
    fileName: extra.fileName || "plan.pdf",
    contentType: extra.contentType || "application/pdf",
    size: extra.size || 4,
    visibility: extra.visibility || "crew",
    storagePath: `tenants/${companyId}/jobs/${jobId}/documents/${docId}`,
    uploaderUid: uid,
    uploaderName: extra.uploaderName || "Sue",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

let suites = [];
let storageEnv = null;

async function seed(env) {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const past = Timestamp.fromDate(new Date(NOW - 3 * DAY));
    await setDoc(doc(db, "companies/acme"), company({}));
    await setDoc(doc(db, "companies/otherco"), company({}));
    await setDoc(doc(db, "companies/paused"), company({ trialEndsAt: past }));
    const people = [
      ["hwOp", "operator", null], ["hwLab", "labourer", "heartwood"], ["hwIdle", "operator", "heartwood"],
      ["hwSup", "supervisor", "heartwood"], ["hwMgr", "manager", "heartwood"],
      ["acmeAdm", "admin", "acme"], ["acmeOp", "operator", "acme"], ["acmeIdle", "operator", "acme"],
      ["acmeSup", "supervisor", "acme"], ["acmeMgr", "manager", "acme"],
      ["pausedAdm", "admin", "paused"], ["pausedOp", "operator", "paused"],
      ["otherAdm", "admin", "otherco"],
    ];
    for (const [uid, role, companyId] of people) {
      const row = { name: uid, role, email: uid + "@example.com" };
      if (companyId) { row.companyId = companyId; row.tenantId = companyId; }
      await setDoc(doc(db, "users", uid), row);
    }
    await setDoc(doc(db, "jobs/hw1"), { client: "Orbit", address: "1 Creek Rd", status: "Scheduled", assigned: ["hwOp", "hwLab", "hwSup"] });
    await setDoc(doc(db, "jobs/acme1"), { companyId: "acme", tenantId: "acme", client: "Acme Homes", address: "2 St", status: "Scheduled", assigned: ["acmeOp", "acmeSup"] });
    await setDoc(doc(db, "jobs/paused1"), { companyId: "paused", tenantId: "paused", client: "Paused", address: "3 St", status: "Scheduled", assigned: ["pausedOp"] });
    await setDoc(doc(db, "jobs/other1"), { companyId: "otherco", tenantId: "otherco", client: "Other", address: "4 St", status: "Scheduled", assigned: [] });
  });
}

test.before(async () => {
  const specs = [
    ["production", "demo-job-docs-prod", firestoreProd],
    ["emulator", "demo-job-docs-emu", firestoreEmu],
  ];
  for (const [name, projectId, rules] of specs) {
    const env = await initializeTestEnvironment({
      projectId,
      firestore: { rules },
      storage: { rules: storageRules },
    });
    await seed(env);
    suites.push({ name, env });
  }
  // Storage rules read Firestore inside the emulator project this process was
  // started with (demo-heartwood). A different rules-unit-testing project id
  // makes those lookups miss and deny every upload.
  storageEnv = await initializeTestEnvironment({
    projectId: "demo-heartwood",
    firestore: { rules: firestoreProd },
    storage: { rules: storageRules },
  });
  await storageEnv.clearFirestore();
  await storageEnv.clearStorage();
  await seed(storageEnv);
});

test.after(async () => {
  for (const suite of suites) await suite.env.cleanup();
  if (storageEnv) await storageEnv.cleanup();
});

function db(env, uid, token) { return env.authenticatedContext(uid, token).firestore(); }
function storage(env, uid) { return env.authenticatedContext(uid).storage(); }
const pathOf = (companyId, jobId, docId) => `tenants/${companyId}/jobs/${jobId}/documents/${docId}`;

test("each role can upload, read, rename and delete only what that role is allowed", async () => {
  for (const { name, env } of suites) {
    const verified = { email: "bea@acme.test", email_verified: true };
    const admin = db(env, "acmeAdm", verified);
    const crewRef = doc(admin, "jobs/acme1/documents", CREW_ID);
    const officeRef = doc(admin, "jobs/acme1/documents", OFFICE_ID);
    await assertSucceeds(setDoc(crewRef, docBody("acme", "acme1", CREW_ID, "acmeAdm", { visibility: "crew", name: "Site plan" })), name);
    await assertSucceeds(setDoc(officeRef, docBody("acme", "acme1", OFFICE_ID, "acmeAdm", { visibility: "office", name: "Invoice 12" })), name);
    await assertSucceeds(updateDoc(doc(db(env, "acmeSup"), "jobs/acme1/documents", CREW_ID), { name: "Ground floor", updatedAt: serverTimestamp() }), name);
    await assertSucceeds(getDoc(doc(db(env, "acmeMgr"), "jobs/acme1/documents", OFFICE_ID)), name);
    const seen = await assertSucceeds(getDocs(query(collection(db(env, "acmeOp"), "jobs/acme1/documents"), where("visibility", "==", "crew"))), name);
    assert.deepEqual(seen.docs.map(d => d.id), [CREW_ID], name);
    assert.equal(seen.docs[0].data().name, "Ground floor");
    await assertFails(getDoc(doc(db(env, "acmeOp"), "jobs/acme1/documents", OFFICE_ID)), name);
    await assertFails(getDocs(collection(db(env, "acmeOp"), "jobs/acme1/documents")), name);
    await assertFails(getDoc(doc(db(env, "acmeIdle"), "jobs/acme1/documents", CREW_ID)), name);
    await assertFails(setDoc(doc(db(env, "acmeOp"), "jobs/acme1/documents", "dCrewUpload123456"), docBody("acme", "acme1", "dCrewUpload123456", "acmeOp")), name);
    await assertFails(deleteDoc(doc(db(env, "acmeOp"), "jobs/acme1/documents", CREW_ID)), name);
    await assertFails(updateDoc(doc(db(env, "acmeOp"), "jobs/acme1/documents", CREW_ID), { name: "Stolen", updatedAt: serverTimestamp() }), name);
    await assertFails(updateDoc(doc(db(env, "acmeAdm"), "jobs/acme1/documents", OFFICE_ID), { visibility: "crew", updatedAt: serverTimestamp() }), name);
    await assertFails(setDoc(doc(db(env, "otherAdm"), "jobs/acme1/documents", "dOtherTry12345678"), docBody("acme", "acme1", "dOtherTry12345678", "otherAdm")), name);
    await assertFails(getDoc(doc(db(env, "otherAdm"), "jobs/acme1/documents", CREW_ID)), name);
    await assertSucceeds(deleteDoc(doc(db(env, "acmeMgr"), "jobs/acme1/documents", OFFICE_ID)), name);
    const gone = await assertSucceeds(getDoc(doc(db(env, "acmeSup"), "jobs/acme1/documents", OFFICE_ID)), name);
    assert.equal(gone.exists(), false, name);
  }
});

test("heartwood office and assigned crew follow the same split, including with no company document", async () => {
  for (const { name, env } of suites) {
    const alex = db(env, ALEX, { email: "alex@heartwoodew.com", email_verified: true });
    await assertSucceeds(setDoc(doc(alex, "jobs/hw1/documents", CREW_ID), docBody("heartwood", "hw1", CREW_ID, ALEX, { visibility: "crew", name: "Levels" })), name);
    await assertSucceeds(setDoc(doc(db(env, PATRICK), "jobs/hw1/documents", OFFICE_ID), docBody("heartwood", "hw1", OFFICE_ID, PATRICK, { visibility: "office", name: "Quote" })), name);
    await assertSucceeds(getDoc(doc(db(env, "hwSup"), "jobs/hw1/documents", OFFICE_ID)), name);
    await assertSucceeds(getDoc(doc(db(env, "hwMgr"), "jobs/hw1/documents", OFFICE_ID)), name);
    const crew = await assertSucceeds(getDocs(query(collection(db(env, "hwOp"), "jobs/hw1/documents"), where("visibility", "==", "crew"))), name);
    assert.deepEqual(crew.docs.map(d => d.data().name), ["Levels"], name);
    const labourer = await assertSucceeds(getDocs(query(collection(db(env, "hwLab"), "jobs/hw1/documents"), where("visibility", "==", "crew"))), name);
    assert.equal(labourer.size, 1, name);
    await assertFails(getDoc(doc(db(env, "hwOp"), "jobs/hw1/documents", OFFICE_ID)), name);
    await assertFails(getDoc(doc(db(env, "hwLab"), "jobs/hw1/documents", OFFICE_ID)), name);
    await assertFails(getDoc(doc(db(env, "hwIdle"), "jobs/hw1/documents", CREW_ID)), name);
    await assertFails(setDoc(doc(db(env, "hwOp"), "jobs/hw1/documents", "dHwCrewUpload123"), docBody("heartwood", "hw1", "dHwCrewUpload123", "hwOp")), name);
    await assertFails(deleteDoc(doc(db(env, "hwLab"), "jobs/hw1/documents", CREW_ID)), name);
    await assertFails(getDoc(doc(db(env, "acmeAdm"), "jobs/hw1/documents", CREW_ID)), name);
    await assertSucceeds(updateDoc(doc(db(env, "hwSup"), "jobs/hw1/documents", CREW_ID), { name: "Levels A", updatedAt: serverTimestamp() }), name);
    await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), "jobs/hw1/documents")), name);
  }
});

test("a paused company cannot read or write job documents", async () => {
  for (const { name, env } of suites) {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), "jobs/paused1/documents", CREW_ID), {
        companyId: "paused", tenantId: "paused", jobId: "paused1", name: "Secret", fileName: "s.pdf",
        contentType: "application/pdf", size: 4, visibility: "crew",
        storagePath: pathOf("paused", "paused1", CREW_ID),
        uploaderUid: "pausedAdm", uploaderName: "Pat", createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    await assertFails(getDoc(doc(db(env, "pausedAdm"), "jobs/paused1/documents", CREW_ID)), name);
    await assertFails(getDoc(doc(db(env, "pausedOp"), "jobs/paused1/documents", CREW_ID)), name);
    await assertFails(setDoc(doc(db(env, "pausedAdm"), "jobs/paused1/documents", "dPausedNew123456"), docBody("paused", "paused1", "dPausedNew123456", "pausedAdm")), name);
    await assertFails(deleteDoc(doc(db(env, "pausedAdm"), "jobs/paused1/documents", CREW_ID)), name);
  }
});

test("storage allows office upload and delete, hides office-only files from crew, and blocks other companies", async () => {
  for (const { name, env } of [{ name: "storage", env: storageEnv }]) {
    const crewPath = pathOf("acme", "acme1", CREW_ID);
    const officePath = pathOf("acme", "acme1", OFFICE_ID);
    const hwCrew = pathOf("heartwood", "hw1", CREW_ID);
    const hwOffice = pathOf("heartwood", "hw1", OFFICE_ID);
    await assertSucceeds(uploadBytes(ref(storage(env, "acmeSup"), crewPath), PDF, meta("acmeSup", "acme", "acme1", "crew", "plan.pdf")), name);
    await assertSucceeds(uploadBytes(ref(storage(env, "acmeMgr"), officePath), PDF, meta("acmeMgr", "acme", "acme1", "office", "invoice.pdf")), name);
    await assertSucceeds(getBytes(ref(storage(env, "acmeOp"), crewPath)), name);
    await assertFails(getBytes(ref(storage(env, "acmeOp"), officePath)), name);
    await assertFails(getBytes(ref(storage(env, "acmeIdle"), crewPath)), name);
    await assertFails(listAll(ref(storage(env, "acmeOp"), `tenants/acme/jobs/acme1/documents`)), name);
    await assertSucceeds(listAll(ref(storage(env, "acmeAdm"), `tenants/acme/jobs/acme1/documents`)), name);
    await assertFails(uploadBytes(ref(storage(env, "acmeOp"), pathOf("acme", "acme1", "dCrewNoUpload1234")), PDF, meta("acmeOp", "acme", "acme1", "crew", "no.pdf")), name);
    await assertFails(deleteObject(ref(storage(env, "acmeOp"), crewPath)), name);
    await assertFails(getBytes(ref(storage(env, "otherAdm"), crewPath)), name);
    await assertFails(uploadBytes(ref(storage(env, "otherAdm"), pathOf("acme", "acme1", "dCrossCo12345678")), PDF, meta("otherAdm", "acme", "acme1", "crew", "x.pdf")), name);
    await assertSucceeds(uploadBytes(ref(storage(env, ALEX), hwCrew), PDF, meta(ALEX, "heartwood", "hw1", "crew", "levels.pdf")), name);
    await assertSucceeds(uploadBytes(ref(storage(env, "hwSup"), hwOffice), PDF, meta("hwSup", "heartwood", "hw1", "office", "quote.pdf")), name);
    await assertSucceeds(getBytes(ref(storage(env, "hwOp"), hwCrew)), name);
    await assertSucceeds(getBytes(ref(storage(env, "hwLab"), hwCrew)), name);
    await assertFails(getBytes(ref(storage(env, "hwOp"), hwOffice)), name);
    await assertFails(getBytes(ref(storage(env, "hwIdle"), hwCrew)), name);
    await assertFails(getBytes(ref(storage(env, "acmeAdm"), hwCrew)), name);
    await assertFails(uploadBytes(ref(storage(env, "hwOp"), pathOf("heartwood", "hw1", "dHwCrewBlocked12")), PDF, meta("hwOp", "heartwood", "hw1", "crew", "x.pdf")), name);
    await assertSucceeds(deleteObject(ref(storage(env, "hwMgr"), hwOffice)), name);
    await assert.rejects(getBytes(ref(storage(env, "hwSup"), hwOffice)), /object-not-found/, name);
    await assertSucceeds(deleteObject(ref(storage(env, "acmeSup"), officePath)), name);
  }
});

test("storage rejects the wrong type or an oversized file, and a paused company cannot read or delete", async () => {
  for (const { name, env } of [{ name: "storage", env: storageEnv }]) {
    const ok = pathOf("acme", "acme1", "dDrawing12345678");
    await assertSucceeds(uploadBytes(ref(storage(env, "acmeAdm"), ok), PDF, meta("acmeAdm", "acme", "acme1", "crew", "slab.dwg", "application/octet-stream")), name);
    await assertSucceeds(uploadBytes(ref(storage(env, "acmeAdm"), pathOf("acme", "acme1", "dPhotoFile123456")), new Uint8Array([0xff, 0xd8]), meta("acmeAdm", "acme", "acme1", "crew", "shot.jpg", "image/jpeg")), name);
    await assertFails(uploadBytes(ref(storage(env, "acmeAdm"), pathOf("acme", "acme1", "dBadType12345678")), PDF, meta("acmeAdm", "acme", "acme1", "crew", "notes.txt", "text/plain")), name);
    await assertFails(uploadBytes(ref(storage(env, "acmeAdm"), pathOf("acme", "acme1", "dBadLoose1234567")), PDF, meta("acmeAdm", "acme", "acme1", "crew", "notes.txt", "application/octet-stream")), name);
    await assertFails(uploadBytes(ref(storage(env, "acmeAdm"), pathOf("acme", "acme1", "dTooBig123456789")), new Uint8Array(25 * 1024 * 1024 + 1), meta("acmeAdm", "acme", "acme1", "crew", "big.pdf")), name);
    const pausedPath = pathOf("paused", "paused1", CREW_ID);
    const pausedNew = pathOf("paused", "paused1", "dPausedUp1234567");
    await env.withSecurityRulesDisabled(async ctx => {
      await uploadBytes(ref(ctx.storage(), pausedPath), PDF, meta("pausedAdm", "paused", "paused1", "crew", "secret.pdf"));
    });
    await assertFails(getBytes(ref(storage(env, "pausedAdm"), pausedPath)), name);
    await assertFails(getBytes(ref(storage(env, "pausedOp"), pausedPath)), name);
    // Create reads the user and the job (company match). A third read of the
    // company document would exceed the production cap, so a paused office can
    // upload a file for their own job. They still cannot read or delete it.
    await assertSucceeds(uploadBytes(ref(storage(env, "pausedAdm"), pausedNew), PDF, meta("pausedAdm", "paused", "paused1", "office", "new.pdf")), name);
    await assertFails(getBytes(ref(storage(env, "pausedAdm"), pausedNew)), name);
    await assertFails(deleteObject(ref(storage(env, "pausedAdm"), pausedPath)), name);
  }
});
