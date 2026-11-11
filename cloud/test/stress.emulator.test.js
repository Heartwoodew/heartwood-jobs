// Stress and abuse checks against the live Firestore rules (cloud/firestore.production.rules) on the emulator.
// Fake data only. Never points at heartwood-9f37f. Run with `npm run test:stress-emulator` from cloud/.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, serverTimestamp, arrayUnion, Timestamp, runTransaction } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2", PAT = "R7t41e54Ykcdk9WPdVZnDd697iI2";
const N = Number(process.env.STRESS_STAFF || 25);
const COMPANIES = ["bravo", "charlie"];
const staffOf = c => Array.from({ length: N }, (_, i) => `${c}Op${i}`);
const hwStaff = Array.from({ length: N }, (_, i) => `hwOp${i}`);
let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-stress",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, "users/" + ALEX), { role: "admin", name: "Alex" });
    await setDoc(doc(d, "users/" + PAT), { role: "operator", name: "Patrick" });
    for (const uid of hwStaff) await setDoc(doc(d, "users/" + uid), { role: "operator", name: uid, companyId: "heartwood" });
    for (const c of COMPANIES) {
      await setDoc(doc(d, "companies/" + c), { name: c, isTest: false, status: "active", plan: "trial", staffCount: N + 2, jobCount: 1,
        billing: { provider: null, status: "not-configured", stripeCustomerId: null, stripeSubscriptionId: null }, ownerUid: c + "Adm" });
      await setDoc(doc(d, "users/" + c + "Adm"), { role: "admin", name: c + " admin", companyId: c, tenantId: c });
      await setDoc(doc(d, "users/" + c + "Sup"), { role: "supervisor", name: c + " sup", companyId: c, tenantId: c });
      for (const uid of staffOf(c)) await setDoc(doc(d, "users/" + uid), { role: "operator", name: uid, companyId: c, tenantId: c });
      await setDoc(doc(d, `jobs/${c}-big`), { companyId: c, tenantId: c, client: c, assigned: staffOf(c), status: "Scheduled", log: [], price: 1000 });
      await setDoc(doc(d, `timesheets/${c}Op0_2026-11-09`), { companyId: c, uid: c + "Op0", name: "x", weekStart: "2026-11-09" });
      await setDoc(doc(d, `companies/${c}/leaveRequests/lvseed${c.padEnd(10, "0")}`), { uid: c + "Op0", name: "x", status: "pending", companyId: c });
      await setDoc(doc(d, `quotes/${c}-q1`), { companyId: c, total: 5 });
      await setDoc(doc(d, `receipts/${c}-r1`), { companyId: c, uid: c + "Op0", status: "queued" });
    }
    await setDoc(doc(d, "jobs/hw-big"), { companyId: "heartwood", client: "HW", assigned: hwStaff, status: "Scheduled", log: [] });
    await setDoc(doc(d, "xeroQueue/x1"), { status: "queued", by: ALEX });
    await setDoc(doc(d, "reimbursements/r1"), { amount: 1 });
    await setDoc(doc(d, "meta/profitHistory"), { months: [] });
  });
});
test.after(async () => { if (env) await env.cleanup(); });
const db = uid => env.authenticatedContext(uid).firestore();
// Like assertFails, but names the probe that was wrongly allowed.
async function deny(label, p) {
  try { await p; } catch (e) { if (e.code === "permission-denied" || /PERMISSION_DENIED|false for/.test(String(e.message))) return; throw e; }
  throw new Error("allowed but should be denied: " + label);
}

const entryNew = (id, uid) => ({
  id, source: "clock", status: "open", date: "2026-11-11", start: "06:00", finish: "", breakStart: "", breakEnd: "", note: "", job: "",
  clockOn: { at: serverTimestamp(), fix: "no location" }, enteredBy: uid, enteredByName: uid, enteredAt: serverTimestamp(), edits: {}, lastEditId: "",
});
const sheet = (uid, companyId, id, entry) => ({
  uid, name: uid, weekStart: "2026-11-09", weekEnd: "2026-11-15", days: {}, totalHrs: 0,
  updatedAt: serverTimestamp(), updatedAtIso: new Date().toISOString(), lastEntryId: id, entries: { [id]: entry }, companyId,
});

test(`concurrent clock-on and clock-off for ${N * 3} staff across three companies`, async () => {
  const all = [...hwStaff.map(u => [u, "heartwood"]), ...COMPANIES.flatMap(c => staffOf(c).filter(u => u !== c + "Op0").map(u => [u, c]))];
  const t0 = Date.now();
  await Promise.all(all.map(([uid, c]) => assertSucceeds(setDoc(doc(db(uid), `timesheets/${uid}_2026-11-09`), sheet(uid, c, "e" + uid.toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(8, "0"), entryNew("e" + uid.toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(8, "0"), uid))))));
  const offFailed = [];
  // Clock off: one entry key changes; the stamps already written stay the same.
  await Promise.all(all.map(async ([uid, c]) => {
    const id = "e" + uid.toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(8, "0");
    const ref = doc(db(uid), `timesheets/${uid}_2026-11-09`);
    const cur = (await getDoc(ref)).data();
    const e = cur.entries[id];
    try {
      await updateDoc(ref, { [`entries.${id}`]: { ...e, status: "closed", finish: "14:00", clockOff: { at: serverTimestamp(), fix: "no location" } },
        lastEntryId: id, updatedAt: serverTimestamp(), updatedAtIso: new Date().toISOString(), totalHrs: 8, companyId: c });
    } catch (err) { offFailed.push(`${uid} (${c}): ${String(err.message).includes("1000 expressions") ? "rules expression limit" : err.code}`); }
  }));
  console.log("stress: clock-off failures", offFailed.length, JSON.stringify(offFailed.slice(0, 8)));
  assert.deepEqual(offFailed, []);
  console.log(`stress: ${all.length} staff clock on + off in ${Date.now() - t0} ms`);
});

test("a worker cannot rewrite a recorded clock-on time (any company, Heartwood included)", async () => {
  for (const [uid, c] of [["hwOp1", "heartwood"], ["bravoOp1", "bravo"]]) {
    const id = "e" + uid.toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(8, "0");
    const ref = doc(db(uid), `timesheets/${uid}_2026-11-09`);
    const cur = (await getDoc(ref)).data();
    const e = cur.entries[id];
    const fakeAt = Timestamp.fromDate(new Date("2026-11-11T19:00:00Z"));
    // Whole-document rewrite with an earlier clock-on stamp and a different author.
    await assertFails(setDoc(ref, { ...cur, entries: { [id]: { ...e, clockOn: { at: fakeAt, fix: "no location" }, start: "04:00" } }, totalHrs: 10,
      updatedAt: serverTimestamp() }), `${uid} rewrote clockOn`);
    await assertFails(setDoc(ref, { ...cur, entries: {}, totalHrs: 40, updatedAt: serverTimestamp() }), `${uid} wiped entries`);
    await assertFails(updateDoc(ref, { [`entries.${id}.enteredBy`]: "someoneElse", updatedAt: serverTimestamp() }), `${uid} changed author`);
  }
});

test("staff of one company cannot see or touch another company's records", async () => {
  const targets = c => [`jobs/${c}-big`, `timesheets/${c}Op0_2026-11-09`, `companies/${c}/leaveRequests/lvseed${c.padEnd(10, "0")}`, `quotes/${c}-q1`, `receipts/${c}-r1`, `users/${c}Adm`, `companies/${c}`];
  const callers = ["bravoAdm", "bravoSup", "bravoOp3", "hwOp3", PAT];
  const checks = [];
  for (const who of callers) {
    // Heartwood admins (isAdmin uid allowlist) can still read and write every users/ doc. Logged as a finding below.
    for (const path of targets("charlie").filter(x => !(who === PAT && x.startsWith("users/")))) checks.push(deny(`${who} read ${path}`, getDoc(doc(db(who), path))));
  }
  for (const who of ["charlieAdm", "charlieSup", "charlieOp3"]) {
    for (const p of ["jobs/hw-big", "xeroQueue/x1", "reimbursements/r1", "meta/profitHistory"]) checks.push(deny(`${who} read ${p}`, getDoc(doc(db(who), p))));
    checks.push(deny(`${who} listed all jobs`, getDocs(collection(db(who), "jobs"))));
    checks.push(deny(`${who} listed bravo jobs`, getDocs(query(collection(db(who), "jobs"), where("companyId", "==", "bravo")))));
    checks.push(deny(`${who} listed all users`, getDocs(collection(db(who), "users"))));
    checks.push(deny(`${who} updated bravo job`, updateDoc(doc(db(who), "jobs/bravo-big"), { status: "Done", updatedBy: who })));
  }
  const res = await Promise.allSettled(checks);
  const bad = res.filter(r => r.status === "rejected").map(r => String(r.reason.message));
  console.log("stress: isolation leaks", JSON.stringify(bad));
  assert.deepEqual(bad, []);
  console.log(`stress: ${checks.length} cross-company probes denied`);
});

test("role escalation attempts by staff and supervisors are refused", async () => {
  const op = db("bravoOp2"), sup = db("bravoSup");
  await assertFails(updateDoc(doc(op, "users/bravoOp2"), { role: "admin" }));
  await assertFails(updateDoc(doc(op, "users/bravoOp2"), { companyId: "charlie", tenantId: "charlie" }));
  await assertFails(updateDoc(doc(sup, "users/bravoSup"), { role: "admin" }));
  await assertFails(updateDoc(doc(sup, "users/bravoOp2"), { role: "supervisor" }));
  await assertFails(setDoc(doc(op, "users/newGuy"), { role: "admin", name: "x", companyId: "bravo", tenantId: "bravo" }));
  await assertFails(updateDoc(doc(op, "companies/bravo"), { billing: { provider: "stripe", status: "active", stripeCustomerId: "cus_x", stripeSubscriptionId: "sub_x" } }));
  await assertFails(updateDoc(doc(op, "companies/bravo"), { plan: "paid" }));
  await assertFails(updateDoc(doc(db("bravoAdm"), "companies/bravo"), { plan: "paid" }));
  await assertFails(updateDoc(doc(db("bravoAdm"), "companies/bravo"), { billing: { provider: "stripe", status: "active", stripeCustomerId: "cus_x", stripeSubscriptionId: "sub_x" } }));
  await assertFails(updateDoc(doc(db("bravoAdm"), "companies/bravo"), { isTest: true }));
  await assertFails(setDoc(doc(op, "companies/evil-co"), { name: "x" }));
  await assertFails(updateDoc(doc(op, `companies/bravo/leaveRequests/lvseed${"bravo".padEnd(10, "0")}`), { status: "approved" }));
  await assertFails(updateDoc(doc(op, "jobs/bravo-big"), { price: 1, updatedBy: "bravoOp2" }));
  await assertFails(updateDoc(doc(op, "jobs/bravo-big"), { status: "Invoiced", updatedBy: "bravoOp2" }));
  await assertFails(getDocs(collection(op, "invites")));
  await assertFails(getDoc(doc(op, "companyMeta/bravo_quoteRates")));
  await assertFails(setDoc(doc(sup, "companyMeta/bravo_quoteRates"), { companyId: "bravo", rates: {} }));
});

test("assigned staff hammer one job at once and every diary line survives", async () => {
  const staff = staffOf("bravo");
  await Promise.all(staff.map(uid => assertSucceeds(updateDoc(doc(db(uid), "jobs/bravo-big"), {
    status: "In progress", log: arrayUnion({ by: uid, t: "on site " + uid }), updatedAt: serverTimestamp(), updatedBy: uid,
  }))));
  let snap;
  await env.withSecurityRulesDisabled(async ctx => { snap = (await getDoc(doc(ctx.firestore(), "jobs/bravo-big"))).data(); });
  assert.equal(snap.log.length, staff.length);
  // An operator cannot shrink the diary.
  await assertFails(updateDoc(doc(db(staff[1]), "jobs/bravo-big"), { log: [], updatedAt: serverTimestamp(), updatedBy: staff[1] }));
});

test("concurrent leave requests and a supervisor deciding all of them", async () => {
  const staff = staffOf("charlie").slice(1);
  const lvId = i => "lvstress" + String(i).padStart(10, "0");
  await Promise.all(staff.map((uid, i) => assertSucceeds(setDoc(doc(db(uid), `companies/charlie/leaveRequests/${lvId(i)}`), {
    uid, name: uid, type: i % 2 ? "sick" : "annual", start: "2026-12-01", end: "2026-12-02", startHalf: "", endHalf: "", reason: "r",
    certificatePath: "", certificateName: "", status: "pending", decisionNote: "", decidedBy: "", decidedByName: "", decidedAt: null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }))));
  await Promise.all(staff.map((uid, i) => assertSucceeds(updateDoc(doc(db("charlieSup"), `companies/charlie/leaveRequests/${lvId(i)}`), {
    status: i % 3 ? "approved" : "declined", decisionNote: "ok", decidedBy: "charlieSup", decidedByName: "charlie sup", decidedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }))));
  const list = await getDocs(collection(db("charlieAdm"), "companies/charlie/leaveRequests"));
  assert.equal(list.size, staff.length + 1);
  await assertFails(getDocs(collection(db("bravoAdm"), "companies/charlie/leaveRequests")));
});

test("companyStatsBump: a plain staff member can inflate the company's staff and job counters", async () => {
  // Display-only counters (billing counts users), recorded as a low finding. Each call may only add 1.
  const op = db("bravoOp4");
  let ok = 0;
  for (let i = 0; i < 5; i++) {
    try {
      await runTransaction(op, async tx => {
        const ref = doc(op, "companies/bravo");
        const cur = (await tx.get(ref)).data();
        tx.update(ref, { staffCount: cur.staffCount + 1, lastActivityAt: serverTimestamp() });
      });
      ok++;
    } catch { /* denied */ }
  }
  console.log(`stress: operator bumped bravo staffCount ${ok}/5 times`);
});

test("FINDING: a Heartwood admin can read and edit another company's staff profiles", async () => {
  const pat = db(PAT);
  const read = await getDoc(doc(pat, "users/charlieAdm")).then(() => true, () => false);
  const write = await updateDoc(doc(pat, "users/charlieOp5"), { name: "renamed by Heartwood" }).then(() => true, () => false);
  console.log(`stress: Heartwood admin cross-company users read=${read} write=${write}`);
});
