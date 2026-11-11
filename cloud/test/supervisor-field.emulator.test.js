// Supervisors do the same field work as operators, inside their own company only, with no admin or money rights.
// Loads cloud/firestore.production.rules. Fake data only. Never points at heartwood-9f37f.
import test from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, query, where, serverTimestamp } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const SUP = "hwSup", SUP2 = "hwSup2", OP = "hwOp", BSUP = "bSup", BADM = "bAdm";
let env;
const db = uid => env.authenticatedContext(uid).firestore();
const receipt = (uid, companyId = "heartwood") => ({ uid, companyId, status: "queued", supplier: "Ampol", amountInc: 42 });
const rc = (uid, name) => ({ uid, name, date: "2026-11-09", amountCents: 1500, supplier: "Bunnings", category: "parts", notes: "", paidWith: "cash",
  jobId: "", jobLabel: "", receiptPath: "", receiptName: "", status: "submitted", decisionNote: "", decidedBy: "", decidedByName: "", decidedAt: null,
  paidAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
const approve = uid => ({ status: "approved", decidedBy: uid, decidedByName: "x", decidedAt: serverTimestamp(), updatedAt: serverTimestamp() });
function sig(uid, companyId) {
  const now = Date.now();
  return { uid, name: "Sue Supervisor", swmsId: "mobile-plant", swmsTitle: "Mobile plant", version: "2026-01", jobId: "", jobLabel: "",
    sig: "data:image/png;base64," + "A".repeat(40), signedAt: serverTimestamp(), signedAtMs: now, expiresAtMs: now + 365 * 864e5,
    device: "test", companyId };
}
function incident(n, reportedBy, companyId) {
  const reportNo = "INC-" + String(n).padStart(4, "0");
  return { reportNo, seq: n, reportedBy, reporterName: "Sue", status: "Open", type: "Hazard", description: "Loose kerb", companyId,
    ...(companyId !== "heartwood" ? { tenantId: companyId } : {}) };
}
async function reportIncident(uid, companyId, n, reportedBy = uid) {
  const d = db(uid), b = writeBatch(d);
  const counter = companyId === "heartwood" ? "main" : companyId;
  const id = companyId === "heartwood" ? "INC-" + String(n).padStart(4, "0") : companyId + "_INC-" + String(n).padStart(4, "0");
  b.set(doc(d, "incidentCounter/" + counter), { n });
  b.set(doc(d, "incidents/" + id), incident(n, reportedBy, companyId));
  return b.commit();
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-supervisor-field",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, "users/" + ALEX), { role: "admin", name: "Alex" });
    await setDoc(doc(d, "users/" + SUP), { role: "supervisor", name: "Sue" });
    await setDoc(doc(d, "users/" + SUP2), { role: "supervisor", name: "Sid", companyId: "heartwood" });
    await setDoc(doc(d, "users/" + OP), { role: "operator", name: "Sam" });
    await setDoc(doc(d, "users/" + BSUP), { role: "supervisor", name: "Bea Sup", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/" + BADM), { role: "admin", name: "Bea", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "companies/bravo"), { name: "Bravo", ownerUid: BADM, status: "active", isTest: false });
    await setDoc(doc(d, "jobs/hwSupJob"), { companyId: "heartwood", client: "Orbit", address: "1 Field St", assigned: [SUP, SUP2, BSUP], status: "Scheduled", poAmount: 900 });
    await setDoc(doc(d, "jobs/hwLegacy"), { client: "Orbit", address: "2 Old Rd", assigned: [SUP], status: "Scheduled" });
    await setDoc(doc(d, "jobs/hwOther"), { companyId: "heartwood", client: "Orbit", address: "3 Not Mine", assigned: [OP], status: "Scheduled" });
    await setDoc(doc(d, "jobs/bravoJob"), { companyId: "bravo", tenantId: "bravo", client: "Acme", address: "8 B St", assigned: [SUP, BSUP], status: "Scheduled" });
    await setDoc(doc(d, "incidentCounter/main"), { n: 5 });
    await setDoc(doc(d, "incidents/INC-0001"), { reportNo: "INC-0001", seq: 1, reportedBy: OP, status: "Open", type: "Hazard", companyId: "heartwood" });
    await setDoc(doc(d, "receipts/opReceipt"), receipt(OP));
    await setDoc(doc(d, "swmsChunks/mobile-plant_0"), { data: "AAAA", companyId: "heartwood" });
    await setDoc(doc(d, "clients/orbit"), { name: "Orbit", companyId: "heartwood", contacts: [] });
    await setDoc(doc(d, "clients/acme"), { name: "Acme", companyId: "bravo", tenantId: "bravo", contacts: [] });
    await setDoc(doc(d, "reimbursementClaims/rcsupclaim0000000"), { ...rc(SUP, "Sue"), createdAt: null, updatedAt: null });
    await setDoc(doc(d, "reimbursementClaims/rcopclaim00000000"), { ...rc(OP, "Sam"), createdAt: null, updatedAt: null });
    await setDoc(doc(d, "companies/bravo/reimbursementClaims/rcbsupclaim000000"), { ...rc(BSUP, "Bea Sup"), companyId: "bravo", createdAt: null, updatedAt: null });
    await setDoc(doc(d, "meta/quoteRates"), { travelPerKm: 4 });
  });
});
test.after(async () => { if (env) await env.cleanup(); });

test("a Heartwood supervisor opens and works their own assigned jobs like an operator", async () => {
  for (const uid of [SUP, SUP2]) {
    await assertSucceeds(getDoc(doc(db(uid), "jobs/hwSupJob")));
    await assertSucceeds(getDocs(query(collection(db(uid), "jobs"), where("companyId", "==", "heartwood"), where("assigned", "array-contains", uid))));
    await assertSucceeds(updateDoc(doc(db(uid), "jobs/hwSupJob"), { status: "In progress", updatedAt: serverTimestamp(), updatedBy: uid }));
  }
  await assertSucceeds(getDoc(doc(db(SUP), "jobs/hwLegacy")));
  await assertFails(getDoc(doc(db(SUP), "jobs/hwOther")));
  await assertFails(getDocs(query(collection(db(SUP), "jobs"), where("companyId", "==", "heartwood"))));
  // Same field list as operators: no money, address, assignment, Xero or company changes, and no Cancelled.
  await assertFails(updateDoc(doc(db(SUP), "jobs/hwSupJob"), { poAmount: 1, updatedBy: SUP }));
  await assertFails(updateDoc(doc(db(SUP), "jobs/hwSupJob"), { address: "Elsewhere", updatedBy: SUP }));
  await assertFails(updateDoc(doc(db(SUP), "jobs/hwSupJob"), { assigned: [SUP], updatedBy: SUP }));
  await assertFails(updateDoc(doc(db(SUP), "jobs/hwSupJob"), { xeroStatus: "queued", updatedBy: SUP }));
  await assertFails(updateDoc(doc(db(SUP), "jobs/hwSupJob"), { status: "Cancelled", updatedBy: SUP }));
  await assertFails(updateDoc(doc(db(SUP), "jobs/hwSupJob"), { status: "Done", updatedBy: OP }));
});

test("a Heartwood supervisor submits their own receipts only", async () => {
  await assertSucceeds(setDoc(doc(db(SUP), "receipts/supR1"), receipt(SUP)));
  await assertSucceeds(setDoc(doc(db(SUP), "receiptChunks/supC1"), { uid: SUP, companyId: "heartwood", data: "AAAA" }));
  await assertSucceeds(getDoc(doc(db(SUP), "receipts/supR1")));
  await assertFails(setDoc(doc(db(SUP), "receipts/supR2"), receipt(OP)));
  await assertFails(setDoc(doc(db(SUP), "receipts/supR3"), receipt(SUP, "bravo")));
  await assertFails(setDoc(doc(db(SUP), "receipts/supR4"), { ...receipt(SUP), status: "done" }));
  await assertFails(getDoc(doc(db(SUP), "receipts/opReceipt")));
  await assertFails(updateDoc(doc(db(SUP), "receipts/supR1"), { status: "done" }));
});

test("a Heartwood supervisor reports incidents as themself and cannot read or close others", async () => {
  await assertSucceeds(reportIncident(SUP, "heartwood", 6));
  await assertSucceeds(getDoc(doc(db(SUP), "incidents/INC-0006")));
  await assertFails(reportIncident(SUP, "heartwood", 7, OP));
  await assertFails(getDoc(doc(db(SUP), "incidents/INC-0001")));
  await assertFails(getDocs(query(collection(db(SUP), "incidents"), where("companyId", "==", "heartwood"))));
  await assertFails(updateDoc(doc(db(SUP), "incidents/INC-0006"), { status: "Closed", closedBy: SUP, closedAt: serverTimestamp() }));
});

test("a Heartwood supervisor opens and signs SWMS and reads clients, but cannot edit clients", async () => {
  await assertSucceeds(getDoc(doc(db(SUP), "swmsChunks/mobile-plant_0")));
  await assertSucceeds(setDoc(doc(db(SUP), "swmsSignatures/supSig1"), sig(SUP, "heartwood")));
  await assertFails(setDoc(doc(db(SUP), "swmsSignatures/supSig2"), sig(OP, "heartwood")));
  await assertSucceeds(getDoc(doc(db(SUP), "clients/orbit")));
  await assertFails(updateDoc(doc(db(SUP), "clients/orbit"), { name: "Renamed" }));
});

test("a Heartwood supervisor gets no admin or money powers", async () => {
  await assertFails(getDoc(doc(db(SUP), "meta/quoteRates")));
  await assertFails(getDoc(doc(db(SUP), "reimbursementClaims/rcopclaim00000000")));
  await assertFails(updateDoc(doc(db(SUP), "reimbursementClaims/rcsupclaim0000000"), approve(SUP)));
  await assertFails(updateDoc(doc(db(SUP), "reimbursementClaims/rcopclaim00000000"), approve(SUP)));
  await assertFails(getDoc(doc(db(SUP), "users/" + OP)));
  await assertFails(getDoc(doc(db(SUP), "timesheets/" + OP + "_2026-11-09")));
  await assertFails(setDoc(doc(db(SUP), "jobs/supNew"), { companyId: "heartwood", client: "x", address: "x", assigned: [SUP], status: "Scheduled" }));
});

test("a Heartwood supervisor cannot work another company's job, even when assigned", async () => {
  await assertFails(getDoc(doc(db(SUP), "jobs/bravoJob")));
  await assertFails(updateDoc(doc(db(SUP), "jobs/bravoJob"), { status: "In progress", updatedAt: serverTimestamp(), updatedBy: SUP }));
});

test("another company's supervisor does field work in their own company only", async () => {
  const b = db(BSUP);
  // Own company: jobs, receipts, incidents, SWMS signatures and clients already work through the company rules.
  await assertSucceeds(getDoc(doc(b, "jobs/bravoJob")));
  await assertSucceeds(updateDoc(doc(b, "jobs/bravoJob"), { status: "In progress", updatedAt: serverTimestamp(), updatedBy: BSUP }));
  await assertSucceeds(setDoc(doc(b, "receipts/bsupR1"), receipt(BSUP, "bravo")));
  await assertSucceeds(reportIncident(BSUP, "bravo", 1));
  await assertSucceeds(setDoc(doc(b, "swmsSignatures/bsupSig1"), sig(BSUP, "bravo")));
  await assertSucceeds(getDoc(doc(b, "clients/acme")));
  // Heartwood: not their company, even on a Heartwood job they were put on.
  await assertFails(getDoc(doc(b, "jobs/hwSupJob")));
  await assertFails(updateDoc(doc(b, "jobs/hwSupJob"), { status: "In progress", updatedAt: serverTimestamp(), updatedBy: BSUP }));
  await assertFails(setDoc(doc(b, "receipts/bsupR2"), receipt(BSUP)));
  await assertFails(reportIncident(BSUP, "heartwood", 8));
  await assertFails(getDoc(doc(b, "swmsChunks/mobile-plant_0")));
  await assertFails(setDoc(doc(b, "swmsSignatures/bsupSig2"), sig(BSUP, "heartwood")));
  await assertFails(getDoc(doc(b, "clients/orbit")));
  // Not an approver: their own claim stays with a bravo admin.
  await assertFails(updateDoc(doc(b, "companies/bravo/reimbursementClaims/rcbsupclaim000000"), approve(BSUP)));
  await assertFails(setDoc(doc(b, "receipts/bsupR3"), receipt(BADM, "bravo")));
});
