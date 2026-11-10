// Company isolation: Heartwood admins vs other companies' jobs, timesheets, leave and claims. Fake data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, query, where, serverTimestamp } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2", PAT = "R7t41e54Ykcdk9WPdVZnDd697iI2", SYNC = "38SU5waAy4f9UI9N6JTqDMaYpQg2";
const OP = "op1", BADM = "bAdm", BOP = "bOp", BSUP = "bSup", COP = "cOp";
let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-company-isolation",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, "users/" + ALEX), { role: "admin", name: "Alex" });
    await setDoc(doc(d, "users/" + PAT), { role: "operator", name: "Patrick" });
    await setDoc(doc(d, "users/" + OP), { role: "operator", name: "Sam" });
    await setDoc(doc(d, "users/" + BADM), { role: "admin", name: "Bea", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/" + BSUP), { role: "supervisor", name: "Sue", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/" + BOP), { role: "operator", name: "Bo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/" + COP), { role: "admin", name: "Cy", companyId: "charlie", tenantId: "charlie" });
    await setDoc(doc(d, "companies/bravo"), { name: "Bravo", isTest: false });
    await setDoc(doc(d, "companies/testco"), { name: "Test Co", isTest: true });
    await setDoc(doc(d, "jobs/hw1"), { companyId: "heartwood", client: "HW", assigned: [OP], status: "Scheduled" });
    await setDoc(doc(d, "jobs/legacy"), { client: "Old HW", assigned: [], status: "Scheduled" });
    await setDoc(doc(d, "jobs/b1"), { companyId: "bravo", tenantId: "bravo", client: "Bravo", assigned: [BOP], status: "Scheduled" });
    await setDoc(doc(d, "timesheets/op1_2026-11-09"), { companyId: "heartwood", uid: OP, name: "Sam", weekStart: "2026-11-09" });
    await setDoc(doc(d, "timesheets/op1_2026-11-02"), { uid: OP, name: "Sam", weekStart: "2026-11-02" });
    await setDoc(doc(d, "timesheets/bOp_2026-11-09"), { companyId: "bravo", tenantId: "bravo", uid: BOP, name: "Bo", weekStart: "2026-11-09" });
    await setDoc(doc(d, "leaveRequests/lvheartwood012345"), { uid: OP, name: "Sam", status: "pending" });
    await setDoc(doc(d, "companies/bravo/reimbursementClaims/rcpaid00000000000"), { uid: BOP, name: "Bo", status: "paid", receiptPath: "" });
  });
});
test.after(async () => { if (env) await env.cleanup(); });
const db = (uid, tok) => env.authenticatedContext(uid, tok).firestore();

test("Heartwood admins see and change Heartwood jobs only; sync and the company itself keep theirs", async () => {
  for (const uid of [ALEX, PAT]) {
    const a = db(uid);
    await assertSucceeds(getDoc(doc(a, "jobs/hw1")));
    await assertSucceeds(getDoc(doc(a, "jobs/legacy")));
    await assertSucceeds(getDocs(query(collection(a, "jobs"), where("companyId", "==", "heartwood"))));
    await assertFails(getDoc(doc(a, "jobs/b1")));
    await assertFails(getDocs(collection(a, "jobs")));
    await assertFails(getDocs(query(collection(a, "jobs"), where("companyId", "==", "bravo"))));
    await assertFails(updateDoc(doc(a, "jobs/b1"), { client: "x" }));
    await assertFails(deleteDoc(doc(a, "jobs/b1")));
    await assertFails(setDoc(doc(a, "jobs/new-b-" + uid), { companyId: "bravo", client: "x", assigned: [] }));
    await assertFails(updateDoc(doc(a, "jobs/hw1"), { companyId: "bravo" }));
    await assertSucceeds(updateDoc(doc(a, "jobs/hw1"), { notes: "ok " + uid }));
  }
  await assertSucceeds(getDoc(doc(db(SYNC), "jobs/b1")));
  await assertSucceeds(getDocs(collection(db(SYNC), "jobs")));
  await assertSucceeds(getDoc(doc(db(BADM), "jobs/b1")));
  await assertSucceeds(updateDoc(doc(db(BADM), "jobs/b1"), { notes: "mine" }));
  await assertSucceeds(getDoc(doc(db(OP), "jobs/hw1")));
});

test("Master page still adds demo jobs to a test company, and nowhere else", async () => {
  const alex = db(ALEX, { email: "alex@heartwoodew.com", email_verified: true });
  await assertSucceeds(setDoc(doc(alex, "jobs/demo-testco-1"), { companyId: "testco", tenantId: "testco", demo: true, client: "Demo", assigned: [] }));
  await assertFails(setDoc(doc(alex, "jobs/demo-bravo-1"), { companyId: "bravo", tenantId: "bravo", demo: true, client: "Demo", assigned: [] }));
});

test("timesheets: Heartwood admins read Heartwood sheets only (with or without companyId)", async () => {
  for (const uid of [ALEX, PAT]) {
    const a = db(uid);
    await assertSucceeds(getDoc(doc(a, "timesheets/op1_2026-11-09")));
    await assertSucceeds(getDoc(doc(a, "timesheets/op1_2026-11-02")));
    await assertSucceeds(getDocs(query(collection(a, "timesheets"), where("companyId", "==", "heartwood"), where("weekStart", "==", "2026-11-09"))));
    await assertFails(getDoc(doc(a, "timesheets/bOp_2026-11-09")));
    await assertFails(getDocs(query(collection(a, "timesheets"), where("weekStart", "==", "2026-11-09"))));
    await assertFails(getDocs(query(collection(a, "timesheets"), where("companyId", "==", "bravo"))));
    await assertFails(updateDoc(doc(a, "timesheets/bOp_2026-11-09"), { sent: true }));
  }
  await assertSucceeds(getDoc(doc(db(BADM), "timesheets/bOp_2026-11-09")));
  await assertSucceeds(getDoc(doc(db(SYNC), "timesheets/bOp_2026-11-09")));
  await assertSucceeds(getDoc(doc(db(BOP), "timesheets/bOp_2026-11-09")));
});

const lv = (uid, name) => ({ uid, name, type: "annual", start: "2026-12-01", end: "2026-12-02", startHalf: "", endHalf: "", reason: "Holiday",
  certificatePath: "", certificateName: "", status: "pending", decisionNote: "", decidedBy: "", decidedByName: "", decidedAt: null,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
const rc = (uid, name) => ({ uid, name, date: "2026-11-09", amountCents: 1500, supplier: "Bunnings", category: "parts", notes: "", paidWith: "cash",
  jobId: "", jobLabel: "", receiptPath: "", receiptName: "", status: "submitted", decisionNote: "", decidedBy: "", decidedByName: "", decidedAt: null,
  paidAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

test("leave works for another company, inside that company only", async () => {
  const p = "companies/bravo/leaveRequests/lvbravo00000000001";
  await assertSucceeds(setDoc(doc(db(BOP), p), lv(BOP, "Bo")));
  await assertSucceeds(getDoc(doc(db(BOP), p)));
  await assertSucceeds(getDocs(query(collection(db(BOP), "companies/bravo/leaveRequests"), where("uid", "==", BOP))));
  await assertFails(getDocs(collection(db(BOP), "companies/bravo/leaveRequests")));
  await assertSucceeds(getDocs(collection(db(BSUP), "companies/bravo/leaveRequests")));
  await assertSucceeds(getDocs(collection(db(BADM), "companies/bravo/leaveRequests")));
  await assertFails(getDoc(doc(db(ALEX), p)));
  await assertFails(getDocs(collection(db(ALEX), "companies/bravo/leaveRequests")));
  await assertFails(getDoc(doc(db(COP), p)));
  await assertFails(setDoc(doc(db(OP), "companies/bravo/leaveRequests/lvbravo00000000002"), lv(OP, "Sam")));
  await assertFails(setDoc(doc(db(BOP), "companies/charlie/leaveRequests/lvbravo00000000003"), lv(BOP, "Bo")));
  await assertFails(setDoc(doc(db(BOP), "leaveRequests/lvbravo00000000004"), lv(BOP, "Bo")));
  await assertFails(setDoc(doc(db(BOP), "companies/heartwood/leaveRequests/lvbravo00000000005"), lv(BOP, "Bo")));
  const dec = { status: "approved", decisionNote: "Enjoy", decidedBy: BSUP, decidedByName: "Sue", decidedAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await assertFails(updateDoc(doc(db(BOP), p), { ...dec, decidedBy: BOP }));
  await assertFails(updateDoc(doc(db(ALEX), p), { ...dec, decidedBy: ALEX }));
  await assertSucceeds(updateDoc(doc(db(BSUP), p), dec));
  // Heartwood is unchanged.
  await assertSucceeds(getDocs(collection(db(ALEX), "leaveRequests")));
  await assertSucceeds(setDoc(doc(db(OP), "leaveRequests/lvheartwood0000002"), lv(OP, "Sam")));
  await assertFails(getDoc(doc(db(BADM), "leaveRequests/lvheartwood012345")));
});

test("reimbursement claims work for another company, inside that company only", async () => {
  const p = "companies/bravo/reimbursementClaims/rcbravo00000000001";
  await assertSucceeds(setDoc(doc(db(BOP), p), rc(BOP, "Bo")));
  await assertSucceeds(getDoc(doc(db(BOP), p)));
  await assertSucceeds(getDocs(collection(db(BADM), "companies/bravo/reimbursementClaims")));
  await assertFails(getDocs(collection(db(BSUP), "companies/bravo/reimbursementClaims")));
  await assertFails(getDoc(doc(db(ALEX), p)));
  await assertFails(getDocs(collection(db(ALEX), "companies/bravo/reimbursementClaims")));
  await assertFails(getDoc(doc(db(COP), p)));
  await assertFails(setDoc(doc(db(OP), "companies/bravo/reimbursementClaims/rcbravo00000000002"), rc(OP, "Sam")));
  await assertFails(setDoc(doc(db(BOP), "companies/bravo/reimbursementClaims/rcbravo00000000003"), { ...rc(BOP, "Bo"), companyId: "bravo" }));
  const dec = { status: "paid", decisionNote: "", decidedBy: BADM, decidedByName: "Bea", decidedAt: serverTimestamp(), paidAt: serverTimestamp(), updatedAt: serverTimestamp(), hubdocStatus: "no-receipt" };
  await assertFails(updateDoc(doc(db(BOP), p), { ...dec, decidedBy: BOP }));
  await assertFails(updateDoc(doc(db(ALEX), p), { ...dec, decidedBy: ALEX }));
  await assertSucceeds(updateDoc(doc(db(BADM), p), dec));
  // Box filer: paid claims only, Hubdoc state only.
  const sync = db(SYNC);
  await assertSucceeds(getDoc(doc(sync, "companies/bravo/reimbursementClaims/rcpaid00000000000")));
  await assertSucceeds(getDocs(query(collection(sync, "companies/bravo/reimbursementClaims"), where("status", "==", "paid"))));
  await assertSucceeds(updateDoc(doc(sync, "companies/bravo/reimbursementClaims/rcpaid00000000000"), { hubdocStatus: "sending", hubdocAttempts: 1, hubdocUpdatedAt: "2026-11-10T00:00:00Z" }));
  await assertFails(updateDoc(doc(sync, "companies/bravo/reimbursementClaims/rcpaid00000000000"), { amountCents: 1 }));
  await assertSucceeds(getDocs(collection(sync, "companies")));
  await assertFails(updateDoc(doc(sync, "companies/bravo"), { hubdocAddress: "x@app.hubdoc.com" }));
  await assertFails(getDoc(doc(db(BOP), "companies/charlie")));
});
