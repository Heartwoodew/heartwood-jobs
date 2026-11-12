// Round 3 (Q6): crew can't read quote totals or PO amounts. Money lives in jobMoney/{jobId}, office only.
// Loads cloud/firestore.production.rules. Fake data only. Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { migrateJobMoney } from "../scripts/migrate-job-money.mjs";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, collection, query, where } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const PATRICK = "R7t41e54Ykcdk9WPdVZnDd697iI2";
const SYNC = "38SU5waAy4f9UI9N6JTqDMaYpQg2";
let env;
const money = (jobId, companyId, extra = {}) => ({ jobId, companyId, ...(companyId !== "heartwood" ? { tenantId: companyId } : {}),
  quoteAmount: 2085, poAmount: 2085, poAmountBasis: "accepted quote (ex GST)", poAmountSource: "quote", ...extra });

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-job-money",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, "users/op1"), { role: "operator", name: "Sam" });
    await setDoc(doc(d, "users/hwSupOp"), { role: "operator", staffRole: "supervisor", name: "Hank" });
    await setDoc(doc(d, "users/bAdm"), { role: "admin", name: "Bea", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bSup"), { role: "supervisor", name: "Sue", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bOp"), { role: "operator", name: "Bo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/cAdm"), { role: "admin", name: "Cy", companyId: "charlie", tenantId: "charlie" });
    await setDoc(doc(d, "jobs/hw1"), { companyId: "heartwood", client: "Orbit", assigned: ["op1", "hwSupOp"], status: "Scheduled", po: "PO-1" });
    await setDoc(doc(d, "jobs/b1"), { companyId: "bravo", tenantId: "bravo", client: "Acme", assigned: ["bOp"], status: "Scheduled",
      quote: { travelKm: 10, extraItems: [{ id: "x1", kind: "rubbish", qty: 6, unit: "m3" }] }, workAmounts: ["Rubbish removal: 6 m³"] });
    // A job from before the move: money still on the job document.
    await setDoc(doc(d, "jobs/bLegacy"), { companyId: "bravo", tenantId: "bravo", client: "Acme", assigned: ["bOp"], status: "Scheduled",
      quoteAmount: 900, poAmount: 900, poAmountBasis: "accepted quote (ex GST)", poAmountSource: "quote" });
    await setDoc(doc(d, "jobMoney/hw1"), money("hw1", "heartwood"));
    await setDoc(doc(d, "jobMoney/b1"), money("b1", "bravo"));
  });
});
test.after(async () => { if (env) await env.cleanup(); });
const db = uid => env.authenticatedContext(uid).firestore();

test("crew read their job but not its money (Heartwood and company staff)", async () => {
  await assertSucceeds(getDoc(doc(db("op1"), "jobs/hw1")));
  await assertFails(getDoc(doc(db("op1"), "jobMoney/hw1")));
  await assertFails(getDoc(doc(db("hwSupOp"), "jobMoney/hw1")));
  await assertSucceeds(getDoc(doc(db("bOp"), "jobs/b1")));
  await assertFails(getDoc(doc(db("bOp"), "jobMoney/b1")));
  await assertFails(getDocs(query(collection(db("bOp"), "jobMoney"), where("companyId", "==", "bravo"))));
  await assertFails(setDoc(doc(db("bOp"), "jobMoney/b1"), money("b1", "bravo", { poAmount: 1 })));
  await assertFails(setDoc(doc(db("op1"), "jobMoney/hw1"), money("hw1", "heartwood", { poAmount: 1 })));
});

test("office reads and writes money for its own company only", async () => {
  await assertSucceeds(getDoc(doc(db(ALEX), "jobMoney/hw1")));
  await assertSucceeds(getDoc(doc(db(PATRICK), "jobMoney/hw1")));
  await assertSucceeds(getDocs(query(collection(db(ALEX), "jobMoney"), where("companyId", "==", "heartwood"))));
  await assertSucceeds(getDoc(doc(db("bAdm"), "jobMoney/b1")));
  await assertSucceeds(getDoc(doc(db("bSup"), "jobMoney/b1")));
  await assertSucceeds(getDocs(query(collection(db("bSup"), "jobMoney"), where("companyId", "==", "bravo"))));
  await assertSucceeds(setDoc(doc(db("bAdm"), "jobMoney/b1"), { jobId: "b1", companyId: "bravo", poAmount: 2100, poAmountBasis: "entered in app (ex GST)", poAmountSource: "app" }, { merge: true }));
  await assertSucceeds(setDoc(doc(db(ALEX), "jobMoney/hw1"), { jobId: "hw1", companyId: "heartwood", poAmount: null }, { merge: true }));
  await assertSucceeds(setDoc(doc(db(SYNC), "jobMoney/hw1"), { jobId: "hw1", companyId: "heartwood", poAmount: 50 }, { merge: true }));
  // other company / Heartwood boundary
  await assertFails(getDoc(doc(db("cAdm"), "jobMoney/b1")));
  await assertFails(setDoc(doc(db("cAdm"), "jobMoney/b1"), { jobId: "b1", companyId: "charlie", poAmount: 1 }, { merge: true }));
  await assertFails(getDoc(doc(db("bAdm"), "jobMoney/hw1")));
  await assertFails(setDoc(doc(db("bAdm"), "jobMoney/hwNew"), money("hwNew", "heartwood")));
  await assertFails(setDoc(doc(db(ALEX), "jobMoney/bNew"), money("bNew", "bravo")));
  // shape
  await assertFails(setDoc(doc(db("bAdm"), "jobMoney/b2"), money("WRONG", "bravo")));
  await assertFails(setDoc(doc(db("bAdm"), "jobMoney/b3"), money("b3", "bravo", { poAmount: "lots" })));
  await assertFails(setDoc(doc(db("bAdm"), "jobMoney/b4"), money("b4", "bravo", { profitAmount: 5 })));
  await assertFails(setDoc(doc(db("bAdm"), "jobMoney/b5"), money("b5", "bravo", { invoiceAmount: "lots" })));
  await assertFails(deleteDoc(doc(db("bAdm"), "jobMoney/b1")));
});

test("a job with no money doc yet: office reads 'not found' (Find PO listener stays alive); crew still can't", async () => {
  assert.equal((await assertSucceeds(getDoc(doc(db(ALEX), "jobMoney/hwNoMoney")))).exists(), false);
  assert.equal((await assertSucceeds(getDoc(doc(db(PATRICK), "jobMoney/hwNoMoney")))).exists(), false);
  assert.equal((await assertSucceeds(getDoc(doc(db("bAdm"), "jobMoney/bNoMoney")))).exists(), false);
  assert.equal((await assertSucceeds(getDoc(doc(db("bSup"), "jobMoney/bNoMoney")))).exists(), false);
  await assertFails(getDoc(doc(db("op1"), "jobMoney/hwNoMoney")));
  await assertFails(getDoc(doc(db("hwSupOp"), "jobMoney/hwNoMoney")));
  await assertFails(getDoc(doc(db("bOp"), "jobMoney/bNoMoney")));
  // existing docs of another company stay closed
  await assertFails(getDoc(doc(db("cAdm"), "jobMoney/b1")));
  await assertFails(getDoc(doc(db("bAdm"), "jobMoney/hw1")));
});

test("app writers can't put money or quote prices on a job; removing a legacy copy is allowed", async () => {
  const base = { companyId: "bravo", tenantId: "bravo", client: "Acme", assigned: [], status: "Scheduled" };
  await assertFails(setDoc(doc(db("bAdm"), "jobs/bn1"), { ...base, poAmount: 100 }));
  await assertFails(setDoc(doc(db("bAdm"), "jobs/bn2"), { ...base, quoteAmount: 100 }));
  await assertFails(setDoc(doc(db("bSup"), "jobs/bn3"), { ...base, quote: { travelKm: 3, totalEx: 100 } }));
  await assertFails(setDoc(doc(db("bAdm"), "jobs/bn4"), { ...base, quote: { lines: [{ label: "Truck", amount: 100 }] } }));
  await assertSucceeds(setDoc(doc(db("bAdm"), "jobs/bn5"), { ...base, quote: { travelKm: 3, extraItems: [] }, workAmounts: ["6 m³"] }));
  await assertFails(updateDoc(doc(db("bAdm"), "jobs/b1"), { poAmount: 100 }));
  await assertFails(updateDoc(doc(db("bSup"), "jobs/b1"), { quoteAmount: 100 }));
  await assertFails(updateDoc(doc(db("bAdm"), "jobs/b1"), { quote: { travelKm: 10, gst: 10 } }));
  await assertSucceeds(updateDoc(doc(db("bAdm"), "jobs/b1"), { notes: "gate code" }));
  // legacy job: other edits keep working, changing the amount there is refused, clearing it is allowed
  await assertSucceeds(updateDoc(doc(db("bSup"), "jobs/bLegacy"), { notes: "ok" }));
  await assertFails(updateDoc(doc(db("bAdm"), "jobs/bLegacy"), { poAmount: 950 }));
  await assertFails(updateDoc(doc(db("bAdm"), "jobs/bLegacy"), { poAmount: null }));
  await assertSucceeds(updateDoc(doc(db("bAdm"), "jobs/bLegacy"), { poAmount: deleteField(), poAmountBasis: deleteField(), poAmountSource: deleteField(), quoteAmount: deleteField() }));
  // Heartwood admins
  await assertFails(setDoc(doc(db(ALEX), "jobs/hwn1"), { companyId: "heartwood", client: "Orbit", assigned: [], status: "Scheduled", poAmount: 10 }));
  await assertFails(updateDoc(doc(db(PATRICK), "jobs/hw1"), { poAmount: 10 }));
  await assertSucceeds(updateDoc(doc(db(ALEX), "jobs/hw1"), { po: "PO-2" }));
});

test("Find PO suggestions: jobMoney holds the list (office + box), app writers can't put it on a job, crew can't read it", async () => {
  const cands = [{ po: "3008309", kind: "clean", amount: 640, basis: "ex GST", source: "pdf", confidence: "high", match: 2 }];
  await assertSucceeds(setDoc(doc(db(SYNC), "jobMoney/hw1"), { jobId: "hw1", companyId: "heartwood", poLookupCandidates: cands }, { merge: true }));
  await assertSucceeds(setDoc(doc(db(ALEX), "jobMoney/hw1"), { jobId: "hw1", companyId: "heartwood", poLookupCandidates: [] }, { merge: true }));
  await assertSucceeds(setDoc(doc(db("bSup"), "jobMoney/b1"), { jobId: "b1", companyId: "bravo", poLookupCandidates: cands }, { merge: true }));
  await assertFails(setDoc(doc(db(ALEX), "jobMoney/hw1"), { jobId: "hw1", companyId: "heartwood", poLookupCandidates: "3008309" }, { merge: true }));
  await assertFails(setDoc(doc(db("op1"), "jobMoney/hw1"), { jobId: "hw1", companyId: "heartwood", poLookupCandidates: [] }, { merge: true }));
  await assertFails(getDoc(doc(db("op1"), "jobMoney/hw1")));
  // on the job: not even an empty list from the app; removing a legacy copy is fine; the box still may (until it switches)
  await assertFails(updateDoc(doc(db(ALEX), "jobs/hw1"), { poLookupCandidates: [] }));
  await assertFails(updateDoc(doc(db("bAdm"), "jobs/b1"), { poLookupCandidates: cands }));
  await assertFails(setDoc(doc(db("bAdm"), "jobs/bn9"), { companyId: "bravo", tenantId: "bravo", client: "Acme", assigned: [], status: "Scheduled", poLookupCandidates: [] }));
  await env.withSecurityRulesDisabled(async ctx => { await updateDoc(doc(ctx.firestore(), "jobs/hw1"), { poLookupCandidates: cands }); });
  await assertSucceeds(updateDoc(doc(db(ALEX), "jobs/hw1"), { poLookupStatus: "pending", poLookupCandidates: deleteField() }));
  await assertSucceeds(updateDoc(doc(db(SYNC), "jobs/hw1"), { poLookupStatus: "choose", poLookupCandidates: cands }));
  await assertSucceeds(updateDoc(doc(db(SYNC), "jobs/hw1"), { poLookupCandidates: deleteField() }));
});

test("the box (sync) may still write poAmount on a job until its workers move", async () => {
  await assertSucceeds(updateDoc(doc(db(SYNC), "jobs/hw1"), { poAmount: 123, poAmountBasis: "ex GST", poAmountSource: "Find PO: test" }));
});

test("crew still only change their own working fields", async () => {
  await assertSucceeds(updateDoc(doc(db("op1"), "jobs/hw1"), { status: "In progress", updatedBy: "op1" }));
  await assertFails(updateDoc(doc(db("op1"), "jobs/hw1"), { quoteAmount: 1, updatedBy: "op1" }));
});

test("migration moves legacy money off the job; crew then see no money and the office still does", async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "jobs/bOld"), { companyId: "bravo", tenantId: "bravo", client: "Acme", assigned: ["bOp"], status: "Scheduled",
      quoteAmount: 1500, poAmount: 1500, poAmountBasis: "accepted quote (ex GST)", poAmountSource: "quote", invoiceNo: "INV-1",
      quote: { travelKm: 2, totalEx: 1500, gst: 150, totalInc: 1650, lines: [{ label: "Truck", amount: 1500 }], extraItems: [{ id: "x", qty: 3, unit: "t", unitPrice: 80 }] } });
    const dry = await migrateJobMoney(ctx.firestore(), { commit: false });
    assert.ok(dry.rows.some(r => r.path === "jobs/bOld"));
    assert.equal((await getDoc(doc(ctx.firestore(), "jobs/bOld"))).data().poAmount, 1500, "dry run writes nothing");
    const done = await migrateJobMoney(ctx.firestore(), { commit: true });
    assert.equal(JSON.stringify(done).match(/1500|1650|\b80\b/), null, "report holds no amounts");
    // a legacy Find PO suggestions list (with amounts) moves too
    await setDoc(doc(ctx.firestore(), "jobs/hwSug"), { companyId: "heartwood", client: "Torsion", assigned: ["op1"], status: "Scheduled", poLookupStatus: "choose",
      poLookupCandidates: [{ po: "3008777", amount: 777, basis: "ex GST", source: "pdf" }] });
    await migrateJobMoney(ctx.firestore(), { commit: true });
    assert.equal("poLookupCandidates" in (await getDoc(doc(ctx.firestore(), "jobs/hwSug"))).data(), false);
    assert.equal((await getDoc(doc(ctx.firestore(), "jobMoney/hwSug"))).data().poLookupCandidates[0].amount, 777);
    // older Find PO messages carried the PO amount on the crew-readable job
    await setDoc(doc(ctx.firestore(), "jobs/hwMsg"), { companyId: "heartwood", client: "Orbit", assigned: ["op1"], status: "Scheduled", po: "3008111",
      poLookupStatus: "found", poLookupMsg: "PO 3008111 $4321 ex GST (orbit_po PDF x.pdf)", notes: "cash $50" });
    const scrub = await migrateJobMoney(ctx.firestore(), { commit: true });
    assert.equal(scrub.textScrubbed.poLookupMsg >= 1, true);
    assert.ok(scrub.textWithPrice.some(r => r.path === "jobs/hwMsg" && r.fields.includes("notes")));
    assert.equal(JSON.stringify(scrub).match(/4321|\$50/), null, "report holds no amounts");
    const again = await migrateJobMoney(ctx.firestore(), { commit: true });
    assert.equal(again.jobsChanged, 0, "second run has nothing to do");
  });
  const hwMsg = (await assertSucceeds(getDoc(doc(db("op1"), "jobs/hwMsg")))).data();
  assert.equal(hwMsg.poLookupMsg, "PO 3008111 [price removed] (orbit_po PDF x.pdf)");
  assert.equal(hwMsg.notes, "cash $50", "typed notes are left for the office");
  const crew = (await assertSucceeds(getDoc(doc(db("bOp"), "jobs/bOld")))).data();
  assert.equal(JSON.stringify(crew).match(/1500|1650|unitPrice|totalEx|poAmount|quoteAmount/), null);
  assert.equal(crew.quote.extraItems[0].qty, 3);
  assert.equal(crew.invoiceNo, "INV-1");
  await assertFails(getDoc(doc(db("bOp"), "jobMoney/bOld")));
  const office = (await assertSucceeds(getDoc(doc(db("bSup"), "jobMoney/bOld")))).data();
  assert.equal(office.poAmount, 1500);
  assert.equal(office.quoteAmount, 1500);
  // the money already in jobMoney/b1 (set by the office above) was not overwritten by the migration
  assert.equal((await assertSucceeds(getDoc(doc(db("bAdm"), "jobMoney/b1")))).data().poAmount, 2100);
});
