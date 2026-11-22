// Cross-company storage access, plus quick probes for role, invites, password reset and chat.
// Runs under firebase emulators:exec. Fake data only. Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { getBytes, listAll, ref, uploadBytes } from "firebase/storage";
import { acceptStaffInvite } from "../functions/shared/staff-invites.js";
import { adminSendPasswordReset } from "../functions/password-reset.js";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const TOKEN = "a".repeat(43);
const DAY = 24 * 60 * 60 * 1000;

let env;

function db(uid) { return env.authenticatedContext(uid).firestore(); }
function storage(uid) { return env.authenticatedContext(uid).storage(); }
function photoMeta(uid, tenantId, jobId) {
  return {
    contentType: "image/jpeg",
    customMetadata: { tenantId, jobId, uploaderUid: uid, purpose: "job-photo", batchCount: "1" },
  };
}
function docMeta(uid, tenantId, jobId) {
  return {
    contentType: "application/pdf",
    customMetadata: { tenantId, jobId, uploaderUid: uid, purpose: "job-document", visibility: "office", fileName: "plan.pdf" },
  };
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-heartwood",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
    storage: { rules: readFileSync(new URL("../production/storage.rules", import.meta.url), "utf8") },
  });
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    const open = {
      name: "Co", status: "active", plan: "trial", isTest: true, ownerPaused: false,
      trialEndsAt: Timestamp.fromDate(new Date(Date.now() + 7 * DAY)),
    };
    await setDoc(doc(d, "companies/acme"), { ...open, name: "Acme" });
    await setDoc(doc(d, "companies/bravo"), { ...open, name: "Bravo" });
    const people = [
      ["acmeOp", "operator", "acme", null],
      ["acmeIdle", "operator", "acme", null],
      ["acmeSup", "supervisor", "acme", null],
      ["acmeAdm", "admin", "acme", null],
      ["acmeScoped", "operator", "acme", ["Other Builder"]],
      ["bravoOp", "operator", "bravo", null],
      ["bravoAdm", "admin", "bravo", null],
    ];
    for (const [uid, role, companyId, customerIds] of people) {
      const row = { name: uid, role, email: uid + "@example.com", companyId, tenantId: companyId };
      if (customerIds) row.customerIds = customerIds;
      await setDoc(doc(d, "users", uid), row);
    }
    await setDoc(doc(d, "jobs/acmeJob"), {
      companyId: "acme", tenantId: "acme", client: "Acme Homes", status: "Scheduled",
      assigned: ["acmeOp", "bravoOp", "acmeScoped"],
    });
    await setDoc(doc(d, "jobs/bravoJob"), {
      companyId: "bravo", tenantId: "bravo", client: "Bravo Homes", status: "Scheduled",
      assigned: ["bravoOp", "acmeAdm"],
    });
    await setDoc(doc(d, "tenants/acme/chats/staff/messages/m1"), {
      senderUid: "acmeOp", senderName: "Ollie", text: "Acme yard", createdAt: Timestamp.now(),
    });
    await setDoc(doc(d, "users/acmeOp/fcmTokens/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), {
      token: "fcm-" + "a".repeat(40), companyId: "acme", origin: "https://app.callupapp.com.au", platform: "web",
    });
    await setDoc(doc(d, "invites/accepted-invite"), {
      name: "Casey", email: "casey.reuse@example.com", role: "operator", status: "accepted",
      createdBy: "acmeAdm", createdAt: Timestamp.now(), expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * DAY)),
      token: "b".repeat(43), tenantId: "acme", companyId: "acme",
    });
    const bucket = ctx.storage();
    await uploadBytes(ref(bucket, "tenants/acme/jobs/acmeJob/photos/p1.jpg"), jpeg, photoMeta("acmeOp", "acme", "acmeJob"));
    await uploadBytes(ref(bucket, "tenants/acme/receipts/rAcme/original"), jpeg, {
      contentType: "image/jpeg",
      customMetadata: { tenantId: "acme", receiptId: "rAcme", uploaderUid: "acmeOp", purpose: "receipt" },
    });
    await setDoc(doc(d, "receipts/rAcme"), { uid: "acmeOp", companyId: "acme", tenantId: "acme", amountInc: 10, status: "queued" });
  });
});

test.after(async () => { if (env) await env.cleanup(); });

test("a user from company B cannot read company A's job photos even when assigned", async () => {
  const path = "tenants/acme/jobs/acmeJob/photos/p1.jpg";
  const folder = "tenants/acme/jobs/acmeJob/photos";
  await assertFails(getBytes(ref(storage("bravoOp"), path)));
  await assertFails(listAll(ref(storage("bravoOp"), folder)));
  await assertFails(getBytes(ref(storage("bravoAdm"), path)));
  await assertFails(listAll(ref(storage("bravoAdm"), folder)));
  await assertSucceeds(getBytes(ref(storage("acmeOp"), path)));
  await assertSucceeds(listAll(ref(storage("acmeOp"), folder)));
  await assertSucceeds(getBytes(ref(storage("acmeSup"), path)));
  await assertSucceeds(listAll(ref(storage("acmeSup"), folder)));
  await assertSucceeds(getBytes(ref(storage("acmeAdm"), path)));
  await assertFails(getBytes(ref(storage("acmeIdle"), path)));
  await assertFails(listAll(ref(storage("acmeIdle"), folder)));
  await assertFails(getBytes(ref(storage("acmeScoped"), path)));
  await assertFails(getBytes(ref(storage("acmeOp"), "tenants/acme/receipts/rAcme/original")));
});

test("a company office cannot upload a document onto another company's job", async () => {
  const same = "tenants/acme/jobs/acmeJob/documents/dSameCo12345678";
  const pathIsMineJobIsTheirs = "tenants/acme/jobs/bravoJob/documents/dWrongJob123456";
  const theirPath = "tenants/bravo/jobs/bravoJob/documents/dOtherCo1234567";
  await assertSucceeds(uploadBytes(ref(storage("acmeAdm"), same), pdf, docMeta("acmeAdm", "acme", "acmeJob")));
  await assertSucceeds(uploadBytes(ref(storage("acmeSup"), "tenants/acme/jobs/acmeJob/documents/dSupSame12345678"), pdf, docMeta("acmeSup", "acme", "acmeJob")));
  await assertFails(uploadBytes(ref(storage("acmeAdm"), pathIsMineJobIsTheirs), pdf, docMeta("acmeAdm", "acme", "bravoJob")));
  await assertFails(uploadBytes(ref(storage("bravoAdm"), theirPath), pdf, docMeta("bravoAdm", "acme", "acmeJob")));
  await assertFails(uploadBytes(ref(storage("bravoAdm"), "tenants/bravo/jobs/acmeJob/documents/dBravoOnAcme123"), pdf, docMeta("bravoAdm", "bravo", "acmeJob")));
  await assertSucceeds(uploadBytes(ref(storage("bravoAdm"), "tenants/bravo/jobs/bravoJob/documents/dBravoOwn1234567"), pdf, docMeta("bravoAdm", "bravo", "bravoJob")));
});

test("a worker cannot promote themselves to supervisor or admin", async () => {
  const op = db("acmeOp");
  await assertFails(updateDoc(doc(op, "users/acmeOp"), { role: "supervisor" }));
  await assertFails(updateDoc(doc(op, "users/acmeOp"), { role: "admin" }));
  await assertFails(updateDoc(doc(op, "users/acmeOp"), { role: "admin", companyId: "bravo", tenantId: "bravo" }));
  await assertFails(updateDoc(doc(db("acmeSup"), "users/acmeSup"), { role: "admin" }));
  await assertFails(updateDoc(doc(db("bravoOp"), "users/bravoOp"), { role: "manager" }));
  const still = await assertSucceeds(getDoc(doc(op, "users/acmeOp")));
  assert.equal(still.data().role, "operator");
  assert.equal(still.data().companyId, "acme");
});

test("a staff invite cannot be accepted twice or after it expires", async () => {
  const admin = db("acmeAdm");
  await assertFails(updateDoc(doc(admin, "invites/accepted-invite"), { status: "pending" }));
  await assertFails(updateDoc(doc(db("acmeOp"), "invites/accepted-invite"), { status: "pending", token: "c".repeat(43) }));
  await assertFails(setDoc(doc(db("acmeOp"), "users/acmeOp"), { role: "admin", companyId: "acme", tenantId: "acme", name: "Ollie" }));

  const expired = await acceptStaffInvite({ token: TOKEN, password: "long-enough" }, {
    now: () => new Date("2026-12-01T00:00:00.000Z"),
    findByToken: async () => [{
      id: "inv1", name: "Casey", email: "casey.expired@example.com", role: "operator", status: "pending",
      expiresAt: new Date("2026-11-01T00:00:00.000Z"), token: TOKEN, tenantId: "acme", companyId: "acme", createdBy: "acmeAdm",
    }],
  });
  assert.equal(expired.reason, "expired");

  const used = await acceptStaffInvite({ token: TOKEN, password: "long-enough" }, {
    now: () => new Date("2026-11-08T00:00:00.000Z"),
    findByToken: async () => [{
      id: "inv2", name: "Casey", email: "casey.used@example.com", role: "operator", status: "accepted",
      expiresAt: new Date("2026-12-01T00:00:00.000Z"), token: TOKEN, tenantId: "acme", companyId: "acme", createdBy: "acmeAdm",
    }],
  });
  assert.equal(used.reason, "accepted");
});

test("an admin cannot reset a password for another company's user", async () => {
  const lookedUp = [];
  const users = {
    bravoAdm: { profile: { role: "admin", companyId: "bravo", name: "Bea" }, heartwoodGrant: false },
    acmeOp: { profile: { role: "operator", companyId: "acme", name: "Ollie" }, heartwoodGrant: false },
    bravoOp: { profile: { role: "operator", companyId: "bravo", name: "Bo" }, heartwoodGrant: false },
  };
  const deps = {
    getUser: async uid => users[uid] || { profile: null, heartwoodGrant: false },
    getAuthUser: async uid => {
      lookedUp.push(uid);
      return { email: uid + "@example.com", providerData: [{ providerId: "password" }] };
    },
  };
  const cross = await adminSendPasswordReset({ callerUid: "bravoAdm", targetUid: "acmeOp" }, deps);
  assert.deepEqual(cross, { ok: false, reason: "permission-denied" });
  assert.deepEqual(lookedUp, []);
  const same = await adminSendPasswordReset({ callerUid: "bravoAdm", targetUid: "bravoOp" }, deps);
  assert.equal(same.reason, "not-sent");
  assert.deepEqual(lookedUp, ["bravoOp"]);
});

test("chat and push tokens do not cross companies", async () => {
  const msg = "tenants/acme/chats/staff/messages/m1";
  const token = "users/acmeOp/fcmTokens/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  await assertSucceeds(getDoc(doc(db("acmeOp"), msg)));
  await assertFails(getDoc(doc(db("bravoOp"), msg)));
  await assertFails(getDoc(doc(db("bravoAdm"), msg)));
  await assertFails(setDoc(doc(db("bravoOp"), "tenants/acme/chats/staff/messages/m2"), {
    senderUid: "bravoOp", senderName: "Bo", text: "hello", createdAt: serverTimestamp(),
  }));
  await assertSucceeds(getDoc(doc(db("acmeOp"), token)));
  await assertFails(getDoc(doc(db("bravoOp"), token)));
  await assertFails(getDoc(doc(db("bravoAdm"), token)));
  await assertFails(setDoc(doc(db("bravoAdm"), "users/acmeOp/fcmTokens/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), {
    token: "fcm-" + "b".repeat(40), companyId: "acme", origin: "https://app.callupapp.com.au", platform: "web", updatedAt: serverTimestamp(),
  }));
});
