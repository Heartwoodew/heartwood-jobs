// 12 Nov 2026 (Alex): (a) an accepted Heartwood admin invite gives full Heartwood admin through heartwoodAdmins/{uid}
// (written by acceptStaffInvite or a Heartwood admin), beside the fixed UID list; nobody self-promotes. (b) Run sheets
// belong to one company and use that company's depot. Loads cloud/firestore.production.rules. Fake data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, runTransaction, serverTimestamp, Timestamp,
} from "firebase/firestore";
import { buildInviteDraft, newInviteToken } from "../../app/features/staff-invites.js";
import { buildApproval, setRouteDepot, DEPOT_ADDRESS } from "../../app/features/route-order.js";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
let env;
test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-hw-admin-runsheets",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") } });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    // What acceptStaffInvite writes for an accepted Heartwood admin invite.
    await setDoc(doc(d, "users/hwNew"), { name: "Hana", role: "admin", email: "hana@example.com", companyId: "heartwood" });
    await setDoc(doc(d, "heartwoodAdmins/hwNew"), { uid: "hwNew", role: "admin", companyId: "heartwood", inviteId: "i1", grantedBy: ALEX, grantedAt: new Date() });
    // Profile says admin but no grant; and a grant whose profile is not admin.
    await setDoc(doc(d, "users/hwNoGrant"), { name: "Nora", role: "admin", companyId: "heartwood" });
    await setDoc(doc(d, "users/hwOpGrant"), { name: "Olly", role: "operator", companyId: "heartwood" });
    await setDoc(doc(d, "heartwoodAdmins/hwOpGrant"), { uid: "hwOpGrant", role: "admin", companyId: "heartwood" });
    await setDoc(doc(d, "users/op1"), { name: "Sam", role: "operator", companyId: "heartwood" });
    await setDoc(doc(d, "users/hwSup"), { name: "Sue", role: "supervisor", companyId: "heartwood" });
    await setDoc(doc(d, "users/bAdmin"), { name: "Bea", role: "admin", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bOp"), { name: "Bo", role: "operator", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "companies/bravo"), { name: "Bravo", ownerUid: "bAdmin", status: "active", plan: "base", isTest: false, address: "1 Bravo St, Ipswich QLD" });
    await setDoc(doc(d, "jobs/hw1"), { companyId: "heartwood", assigned: ["op1"], status: "Scheduled", notes: "" });
    await setDoc(doc(d, "jobMoney/hw1"), { jobId: "hw1", companyId: "heartwood", poAmount: 900 });
    await setDoc(doc(d, "quotes/q1"), { companyId: "heartwood", totalEx: 2000 });
  });
});
test.after(async () => { if (env) await env.cleanup(); });
const db = uid => env.authenticatedContext(uid).firestore();

async function invite(fdb, uid, role, email, tenantId = "heartwood") {
  const draft = buildInviteDraft({ name: "New Person", email, role, createdBy: uid, now: new Date(), token: newInviteToken(), tenantId });
  const ref = doc(collection(fdb, "invites"));
  const expiresAt = Timestamp.fromDate(draft.invite.expiresAt);
  const payload = { ...draft.invite, createdAt: serverTimestamp(), expiresAt };
  await runTransaction(fdb, async tx => {
    const lockRef = doc(fdb, "inviteEmails", payload.email);
    await tx.get(lockRef);
    tx.set(ref, payload);
    tx.set(lockRef, { email: payload.email, status: "pending", inviteId: ref.id, expiresAt, role, tenantId: payload.tenantId });
  });
  return ref;
}

test("an invited Heartwood admin (grant) gets admin reads and writes", async () => {
  const a = db("hwNew");
  await assertSucceeds(getDocs(query(collection(a, "users"), where("companyId", "==", "heartwood"))));
  await assertSucceeds(getDoc(doc(a, "jobs/hw1")));
  await assertSucceeds(getDocs(query(collection(a, "jobs"), where("companyId", "==", "heartwood"))));
  await assertSucceeds(updateDoc(doc(a, "jobs/hw1"), { notes: "Gate code 1234" }));
  await assertSucceeds(getDoc(doc(a, "jobMoney/hw1")));
  await assertSucceeds(getDoc(doc(a, "quotes/q1")));
  await assertSucceeds(updateDoc(doc(a, "users/op1"), { name: "Sam T" }));
  await assertSucceeds(invite(a, "hwNew", "admin", "second.admin@example.com"));
  await assertSucceeds(invite(a, "hwNew", "labourer", "lab.hw@example.com"));
  // Still not Alex-only (owner) or Xero: those stay on their own lists.
  await assertFails(getDoc(doc(a, "reimbursements/r1")));
  await assertFails(getDoc(doc(a, "ownerSettings/o1")));
});

test("no grant, or a grant without an admin profile, gives no Heartwood admin access", async () => {
  for (const uid of ["hwNoGrant", "hwOpGrant"]) {
    const x = db(uid);
    await assertFails(getDocs(query(collection(x, "users"), where("companyId", "==", "heartwood"))), uid);
    await assertFails(getDoc(doc(x, "jobMoney/hw1")), uid);
    await assertFails(getDoc(doc(x, "quotes/q1")), uid);
    await assertFails(updateDoc(doc(x, "jobs/hw1"), { notes: "x" }), uid);
  }
  await assertFails(invite(db("hwNoGrant"), "hwNoGrant", "admin", "nogrant.admin@example.com"));
});

test("supervisors and crew can't self-promote or invite an admin", async () => {
  const grant = uid => ({ uid, role: "admin", companyId: "heartwood", grantedBy: uid, grantedAt: serverTimestamp() });
  for (const uid of ["op1", "hwSup", "hwNoGrant", "bAdmin"]) {
    await assertFails(setDoc(doc(db(uid), "heartwoodAdmins", uid), grant(uid)), uid);
    await assertFails(updateDoc(doc(db(uid), "users", uid), { role: "admin" }), uid);
  }
  // A granted admin can't re-grant or remove their own grant either; another admin manages it.
  await assertFails(setDoc(doc(db("hwNew"), "heartwoodAdmins", "hwNew"), grant("hwNew")));
  await assertFails(deleteDoc(doc(db("hwNew"), "heartwoodAdmins", "hwNew")));
  await assertFails(getDoc(doc(db("op1"), "heartwoodAdmins/hwNew")));
  await assertSucceeds(getDoc(doc(db("hwNew"), "heartwoodAdmins/hwNew")));
  await assertSucceeds(setDoc(doc(db(ALEX), "heartwoodAdmins", "hwSup"), { uid: "hwSup", role: "admin", companyId: "heartwood", grantedBy: ALEX, grantedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(db(ALEX), "heartwoodAdmins", "hwSup")));
  await assertFails(setDoc(doc(db(ALEX), "heartwoodAdmins", "hwSup"), { uid: "hwSup", role: "admin", companyId: "bravo", grantedBy: ALEX, grantedAt: serverTimestamp() }));
  // Admin invites only by admins.
  await assertFails(invite(db("hwSup"), "hwSup", "admin", "sup.admin@example.com"));
  await assertSucceeds(invite(db("hwSup"), "hwSup", "operator", "sup.op@example.com"));
  await assertFails(invite(db("op1"), "op1", "admin", "op.admin@example.com"));
});

function sheet({ me, worker, companyId, depot }) {
  setRouteDepot(depot, { heartwood: companyId === "heartwood" });
  const built = buildApproval({ me, worker, companyId, date: "2026-11-13", jobIds: ["j1"], minutes: 30, km: 12, currentMinutes: 40, currentKm: 15 });
  assert.equal(built.ok, true, built.reason);
  return { id: built.id, data: { ...built.data, approvedAt: serverTimestamp() } };
}

test("run sheets: each company saves its own with its own depot; no cross-company reads or writes", async () => {
  const alexMe = { uid: ALEX, name: "Alex", role: "admin" }, beaMe = { uid: "bAdmin", name: "Bea", role: "admin" };
  const hw = sheet({ me: alexMe, worker: { uid: "op1", name: "Sam" }, companyId: "heartwood", depot: "" });
  assert.equal(hw.data.depot, DEPOT_ADDRESS);
  await assertSucceeds(setDoc(doc(db(ALEX), "runSheets", hw.id), hw.data, { merge: true }));
  const bv = sheet({ me: beaMe, worker: { uid: "bOp", name: "Bo" }, companyId: "bravo", depot: "1 Bravo St, Ipswich QLD" });
  assert.equal(bv.data.depot, "1 Bravo St, Ipswich QLD");
  await assertSucceeds(setDoc(doc(db("bAdmin"), "runSheets", bv.id), bv.data, { merge: true }));
  // Workers read their own; each admin reads only their own company's.
  await assertSucceeds(getDoc(doc(db("op1"), "runSheets", hw.id)));
  await assertSucceeds(getDoc(doc(db("bOp"), "runSheets", bv.id)));
  await assertFails(getDoc(doc(db("bOp"), "runSheets", hw.id)));
  await assertSucceeds(getDoc(doc(db("hwNew"), "runSheets", hw.id)));
  await assertFails(getDoc(doc(db("bAdmin"), "runSheets", hw.id)));
  await assertFails(getDoc(doc(db(ALEX), "runSheets", bv.id)));
  await assertFails(getDoc(doc(db("hwNew"), "runSheets", bv.id)));
  // A missing sheet is still a plain "not there" for an admin.
  await assertSucceeds(getDoc(doc(db("bAdmin"), "runSheets", "bOp_2026-12-01")));
  // No writing another company's sheet, or a sheet for another company's worker, or under another company id.
  const cross = sheet({ me: beaMe, worker: { uid: "op1", name: "Sam" }, companyId: "bravo", depot: "1 Bravo St, Ipswich QLD" });
  await assertFails(setDoc(doc(db("bAdmin"), "runSheets", cross.id), cross.data, { merge: true }));
  await assertFails(setDoc(doc(db("bAdmin"), "runSheets", cross.id), { ...cross.data, companyId: "heartwood" }, { merge: true }));
  const alexOnBravo = sheet({ me: alexMe, worker: { uid: "bOp", name: "Bo" }, companyId: "heartwood", depot: "" });
  await assertFails(setDoc(doc(db(ALEX), "runSheets", alexOnBravo.id), alexOnBravo.data, { merge: true }));
  await assertFails(setDoc(doc(db(ALEX), "runSheets", alexOnBravo.id), { ...alexOnBravo.data, companyId: "bravo" }, { merge: true }));
  // A depot is still required, and a supervisor/crew can't approve.
  await assertFails(setDoc(doc(db("bAdmin"), "runSheets", bv.id), { ...bv.data, depot: "" }, { merge: true }));
  await assertFails(setDoc(doc(db("bOp"), "runSheets", bv.id), { ...bv.data, approvedBy: "bOp" }, { merge: true }));
  // A client company with no address set can't build one (the app says to add it in Company settings).
  setRouteDepot("", { heartwood: false });
  assert.equal(buildApproval({ me: beaMe, worker: { uid: "bOp", name: "Bo" }, companyId: "bravo", date: "2026-11-13", jobIds: ["j1"], minutes: 1, km: 1, currentMinutes: 1, currentKm: 1 }).ok, false);
});
