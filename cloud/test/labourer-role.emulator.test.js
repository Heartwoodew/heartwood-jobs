// 12 Nov 2026 (Alex): four invite profiles - labourer, operator, supervisor, admin. A labourer has exactly the
// operator's access (assigned jobs, own receipts/timesheet, prestarts, fleet meter) and no dollar amounts. Admin
// invites only by an admin. Loads cloud/firestore.production.rules. Fake data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where, runTransaction, serverTimestamp, Timestamp,
} from "firebase/firestore";
import { buildInviteDraft, newInviteToken } from "../../app/features/staff-invites.js";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
let env;
test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-labourer-role",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") } });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, "users/op1"), { role: "operator", name: "Sam", companyId: "heartwood" });
    await setDoc(doc(d, "users/lab1"), { role: "labourer", name: "Lee", companyId: "heartwood" });
    await setDoc(doc(d, "users/bAdmin"), { role: "admin", name: "Bea", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bSup"), { role: "supervisor", name: "Sid", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bOp"), { role: "operator", name: "Bo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bLab"), { role: "labourer", name: "Bix", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "companies/bravo"), { name: "Bravo", ownerUid: "bAdmin", status: "active", plan: "base", isTest: false });
    for (const [id, uid] of [["hwOp", "op1"], ["hwLab", "lab1"]])
      await setDoc(doc(d, "jobs", id), { companyId: "heartwood", assigned: [uid], status: "Scheduled", log: [] });
    await setDoc(doc(d, "jobs/bJob"), { companyId: "bravo", tenantId: "bravo", assigned: ["bOp", "bLab"], status: "Scheduled" });
    await setDoc(doc(d, "jobMoney/hwLab"), { jobId: "hwLab", companyId: "heartwood", poAmount: 900, invoiceAmount: 1000 });
    await setDoc(doc(d, "jobMoney/bJob"), { jobId: "bJob", companyId: "bravo", tenantId: "bravo", poAmount: 900 });
    await setDoc(doc(d, "quotes/qb"), { companyId: "bravo", tenantId: "bravo", totalEx: 2000 });
    await setDoc(doc(d, "receipts/rOther"), { uid: "op1", companyId: "heartwood", amountInc: 70 });
    for (const t of ["heartwood", "bravo"])
      await setDoc(doc(d, "tenants", t, "fleet", "tipper"), { type: "vehicle", name: "Tipper", reading: 100, readingUnit: "km" });
  });
});
test.after(async () => { if (env) await env.cleanup(); });
const db = uid => env.authenticatedContext(uid).firestore();

function prestart(uid, name) {
  return { assetId: "tipper", assetType: "vehicle", assetName: "Tipper", kind: "tip-truck", day: "2026-11-12", reading: 120, readingUnit: "km",
    odometer: 120, items: [{ id: "tt-hyd", result: "pass", comment: "", critical: true }], signerUid: uid, signerName: name,
    signedAt: serverTimestamp(), defect: false, doNotOperate: false, resolved: false };
}

test("a Heartwood labourer gets the operator's job, receipt, prestart and fleet access", async () => {
  for (const [uid, name, job, km] of [["op1", "Sam", "hwOp", 150], ["lab1", "Lee", "hwLab", 160]]) {
    const o = db(uid);
    await assertSucceeds(getDoc(doc(o, "jobs", job)));
    await assertSucceeds(getDocs(query(collection(o, "jobs"), where("companyId", "==", "heartwood"), where("assigned", "array-contains", uid))));
    await assertSucceeds(updateDoc(doc(o, "jobs", job), { status: "In progress", updatedAt: serverTimestamp(), updatedBy: uid }));
    await assertFails(getDoc(doc(o, "jobs", job === "hwOp" ? "hwLab" : "hwOp")));
    await assertSucceeds(addDoc(collection(o, "receipts"), { uid, companyId: "heartwood", status: "queued", tonnes: 2 }));
    await assertSucceeds(addDoc(collection(o, "tenants", "heartwood", "prestarts"), prestart(uid, name)));
    await assertSucceeds(getDoc(doc(o, "tenants", "heartwood", "fleet", "tipper")));
    await assertSucceeds(updateDoc(doc(o, "tenants", "heartwood", "fleet", "tipper"),
      { reading: km, readingUnit: "km", readingAt: serverTimestamp(), readingBy: uid, readingByName: name }));
    await assertFails(updateDoc(doc(o, "tenants", "heartwood", "fleet", "tipper"), { name: "Renamed" }));
    await assertSucceeds(getDoc(doc(o, "timesheets", `${uid}_2026-11-09`)));
  }
});

test("labourers see no dollar amounts (Heartwood and a CallUp company)", async () => {
  const hw = db("lab1");
  for (const p of ["jobMoney/hwLab", "receipts/rOther", "meta/quoteRates", "meta/invoicing", "xeroQueue/x1"])
    await assertFails(getDoc(doc(hw, p)), p);
  const b = db("bLab");
  await assertSucceeds(getDoc(doc(b, "jobs/bJob")));
  for (const p of ["jobMoney/bJob", "quotes/qb", "companyMeta/bravo_quoteRates", "companyMeta/bravo_invoicing"])
    await assertFails(getDoc(doc(b, p)), p);
  await assertFails(getDocs(query(collection(b, "quotes"), where("companyId", "==", "bravo"))));
  await assertFails(getDocs(query(collection(b, "users"), where("companyId", "==", "bravo"))));
  // Company labourer: prestart and fleet meter like a company operator.
  for (const [uid, name, km] of [["bOp", "Bo", 150], ["bLab", "Bix", 160]]) {
    await assertSucceeds(addDoc(collection(db(uid), "tenants", "bravo", "prestarts"), prestart(uid, name)));
    await assertSucceeds(updateDoc(doc(db(uid), "tenants", "bravo", "fleet", "tipper"),
      { reading: km, readingUnit: "km", readingAt: serverTimestamp(), readingBy: uid, readingByName: name }));
  }
});

async function invite(fdb, uid, role, email, tenantId = "bravo") {
  const draft = buildInviteDraft({ name: "New Person", email, role, createdBy: uid, now: new Date(), token: newInviteToken(), tenantId });
  assert.equal(draft.ok, true, role);
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

test("invites: admin gives all four roles; a supervisor gives three, never admin; crew give none", async () => {
  const admin = db("bAdmin"), sup = db("bSup");
  const ids = {};
  for (const role of ["labourer", "operator", "supervisor", "admin"])
    ids[role] = await assertSucceeds(invite(admin, "bAdmin", role, `${role}.a@bravo.test`));
  for (const role of ["labourer", "operator", "supervisor"])
    await assertSucceeds(invite(sup, "bSup", role, `${role}.s@bravo.test`));
  await assertFails(invite(sup, "bSup", "admin", "admin.s@bravo.test"));
  for (const uid of ["bOp", "bLab"]) await assertFails(invite(db(uid), uid, "labourer", `x.${uid.toLowerCase()}@bravo.test`));
  // Heartwood: Alex (fixed list) may invite an admin (accepting it writes the heartwoodAdmins grant).
  await assertSucceeds(invite(db(ALEX), ALEX, "admin", "admin.hw@example.com", "heartwood"));
  await assertSucceeds(invite(db(ALEX), ALEX, "labourer", "lab.hw@example.com", "heartwood"));
  // A supervisor never reads (or resends) an admin invite: it carries the sign-up token.
  await assertFails(getDoc(doc(sup, "invites", ids.admin.id)));
  await assertSucceeds(getDoc(doc(sup, "invites", ids.labourer.id)));
  await assertFails(getDocs(query(collection(sup, "invites"), where("tenantId", "==", "bravo"))));
  const listed = await assertSucceeds(getDocs(query(collection(sup, "invites"), where("tenantId", "==", "bravo"),
    where("role", "in", ["labourer", "operator", "supervisor"]))));
  assert.equal(listed.docs.some(d => d.data().role === "admin"), false);
  const all = await assertSucceeds(getDocs(query(collection(admin, "invites"), where("tenantId", "==", "bravo"),
    where("role", "in", ["labourer", "operator", "supervisor", "admin"]))));
  assert.equal(all.docs.filter(d => d.data().role === "admin").length, 1);
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 7 * 864e5));
  await assertFails(updateDoc(doc(sup, "invites", ids.admin.id), { token: newInviteToken(), expiresAt, resentAt: serverTimestamp(), resentBy: "bSup" }));
  // Nobody writes a role onto their own profile.
  await assertFails(updateDoc(doc(db("bLab"), "users", "bLab"), { role: "admin" }));
  await assertFails(updateDoc(doc(db("bSup"), "users", "bSup"), { role: "admin" }));
});
