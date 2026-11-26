// Requirement rules. Office edits items. Crew tick only. No money fields.
// Fake data only. Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const firestoreProd = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
const firestoreEmu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");

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
function itemBody(companyId, uid, extra = {}) {
  return {
    companyId,
    section: "shared",
    text: "SWMS supplied and on site before the job starts.",
    source: "template",
    sort: 0,
    done: false,
    doneBy: "",
    doneAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    ...extra,
  };
}
function metaBody(uid, extra = {}) {
  return {
    templateId: "coral-homes",
    builder: "Coral Homes",
    storey: "single",
    cleanStage: "first",
    notes: "Access: side gate",
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    ...extra,
  };
}

let suites = [];

async function seed(env) {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const past = Timestamp.fromDate(new Date(NOW - 3 * DAY));
    await setDoc(doc(db, "companies/acme"), company({}));
    await setDoc(doc(db, "companies/paused"), company({ trialEndsAt: past }));
    await setDoc(doc(db, "companies/otherco"), company({}));
    const people = [
      ["hwOp", "operator", "heartwood"], ["hwLab", "labourer", "heartwood"], ["hwIdle", "operator", "heartwood"],
      ["hwSup", "supervisor", "heartwood"], ["hwMgr", "manager", "heartwood"],
      ["acmeAdm", "admin", "acme"], ["acmeOp", "operator", "acme"], ["acmeLab", "labourer", "acme"],
      ["acmeIdle", "operator", "acme"], ["acmeSup", "supervisor", "acme"],
      ["pausedAdm", "admin", "paused"], ["otherAdm", "admin", "otherco"],
    ];
    for (const [uid, role, companyId] of people) {
      await setDoc(doc(db, "users", uid), { name: uid, role, email: uid + "@example.com", companyId, tenantId: companyId });
    }
    await setDoc(doc(db, "jobs/hw1"), { companyId: "heartwood", client: "Coral Homes Qld Pty Ltd", address: "1 Creek Rd", status: "Scheduled", assigned: ["hwOp", "hwLab"] });
    await setDoc(doc(db, "jobs/acme1"), { companyId: "acme", tenantId: "acme", client: "Coral Homes Qld Pty Ltd", address: "2 St", status: "Scheduled", assigned: ["acmeOp", "acmeLab"] });
    await setDoc(doc(db, "jobs/paused1"), { companyId: "paused", tenantId: "paused", client: "Coral Homes Qld Pty Ltd", address: "3 St", status: "Scheduled", assigned: ["pausedAdm"] });
  });
}

test.before(async () => {
  const specs = [
    ["production", "demo-job-req-prod", firestoreProd],
    ["emulator", "demo-job-req-emu", firestoreEmu],
  ];
  for (const [name, projectId, rules] of specs) {
    const env = await initializeTestEnvironment({ projectId, firestore: { rules } });
    await seed(env);
    suites.push({ name, env });
  }
});

test.after(async () => {
  for (const suite of suites) await suite.env.cleanup();
});

function db(env, uid) { return env.authenticatedContext(uid).firestore(); }
const itemRef = (database, jobId, itemId) => doc(database, "jobs", jobId, "requirementItems", itemId);
const metaRef = (database, jobId) => doc(database, "jobs", jobId, "requirementMeta", "current");

test("office edits requirements, a Heartwood supervisor cannot write the job, and crew can only tick", async () => {
  for (const { name, env } of suites) {
    const admin = db(env, "acmeAdm");
    const sup = db(env, "acmeSup");
    const crew = db(env, "acmeOp");
    const labourer = db(env, "acmeLab");
    const idle = db(env, "acmeIdle");
    const line = itemRef(admin, "acme1", "rshared00");
    await assertSucceeds(setDoc(line, itemBody("acme", "acmeAdm")), name);
    const listed = await assertSucceeds(getDocs(collection(crew, "jobs", "acme1", "requirementItems")), name);
    assert.equal(listed.size, 1, name);
    await assertFails(getDocs(collection(idle, "jobs", "acme1", "requirementItems")), name);
    await assertSucceeds(updateDoc(itemRef(sup, "acme1", "rshared00"), {
      text: "SWMS is on site before the start.",
      updatedAt: serverTimestamp(),
      updatedBy: "acmeSup",
    }), name);
    await assertSucceeds(setDoc(metaRef(admin, "acme1"), metaBody("acmeAdm")), name);
    await assertSucceeds(getDoc(metaRef(crew, "acme1")), name);
    await assertSucceeds(updateDoc(itemRef(crew, "acme1", "rshared00"), {
      done: true, doneBy: "acmeOp", doneAt: serverTimestamp(), updatedBy: "acmeOp",
    }), name);
    await assertSucceeds(updateDoc(itemRef(labourer, "acme1", "rshared00"), {
      done: false, doneBy: "", doneAt: null, updatedBy: "acmeLab",
    }), name);
    await assertFails(updateDoc(itemRef(crew, "acme1", "rshared00"), {
      text: "Crew rewrote this.", updatedAt: serverTimestamp(), updatedBy: "acmeOp",
    }), name);
    await assertFails(deleteDoc(itemRef(crew, "acme1", "rshared00")), name);
    await assertFails(updateDoc(metaRef(crew, "acme1"), { notes: "Crew notes", updatedAt: serverTimestamp(), updatedBy: "acmeOp" }), name);
    await assertFails(getDoc(itemRef(idle, "acme1", "rshared00")), name);
    await assertFails(getDoc(metaRef(idle, "acme1")), name);
    await assertFails(getDoc(itemRef(db(env, "otherAdm"), "acme1", "rshared00")), name);
    await assertFails(setDoc(itemRef(admin, "acme1", "rmoneyfld01"), itemBody("acme", "acmeAdm", { poAmount: 12 })), name);
    await assertFails(setDoc(itemRef(admin, "acme1", "rmoneyfld02"), itemBody("acme", "acmeAdm", { tipFee: 5 })), name);
    await assertFails(setDoc(itemRef(admin, "acme1", "rmoneyfld03"), itemBody("acme", "acmeAdm", { rate: 9 })), name);
    await assertFails(setDoc(itemRef(admin, "acme1", "rmoneyfld04"), itemBody("acme", "acmeAdm", { quoteAmount: 1 })), name);
    await assertFails(setDoc(metaRef(admin, "acme1"), metaBody("acmeAdm", { poAmount: 20 })), name);
    await assertSucceeds(deleteDoc(itemRef(sup, "acme1", "rshared00")), name);

    const hwSup = db(env, "hwSup");
    await assertSucceeds(setDoc(itemRef(hwSup, "hw1", "rshared00"), itemBody("heartwood", "hwSup")), name);
    await assertSucceeds(setDoc(metaRef(hwSup, "hw1"), metaBody("hwSup")), name);
    await assertSucceeds(getDoc(itemRef(db(env, "hwMgr"), "hw1", "rshared00")), name);
    await assertFails(updateDoc(doc(hwSup, "jobs/hw1"), { notes: "supervisor tried to write the job", updatedAt: serverTimestamp(), updatedBy: "hwSup" }), name);
    await assertSucceeds(updateDoc(itemRef(db(env, "hwOp"), "hw1", "rshared00"), {
      done: true, doneBy: "hwOp", doneAt: serverTimestamp(), updatedBy: "hwOp",
    }), name);
    await assertFails(updateDoc(itemRef(db(env, "hwLab"), "hw1", "rshared00"), {
      text: "Labourer rewrote this.", updatedAt: serverTimestamp(), updatedBy: "hwLab",
    }), name);
    await assertFails(getDoc(itemRef(db(env, "hwIdle"), "hw1", "rshared00")), name);
    await assertSucceeds(setDoc(doc(hwSup, "companies/heartwood/requirementTemplates/coral-homes"), {
      companyId: "heartwood", templateId: "coral-homes", builder: "Coral Homes", title: "Coral Homes",
      items: [{ section: "shared", text: "SWMS supplied and on site before the job starts." }],
      updatedAt: serverTimestamp(), updatedBy: "hwSup",
    }), name);
    await assertFails(getDoc(doc(db(env, "hwOp"), "companies/heartwood/requirementTemplates/coral-homes")), name);
    await assertFails(setDoc(itemRef(db(env, "pausedAdm"), "paused1", "rpauseditem1"), itemBody("paused", "pausedAdm")), name);
    await assertFails(getDoc(itemRef(env.unauthenticatedContext().firestore(), "hw1", "rshared00")), name);
    assert.equal(ALEX.length > 0, true);
  }
});
