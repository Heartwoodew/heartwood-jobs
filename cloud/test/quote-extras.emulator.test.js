// Quote extra items / price overrides / picked place, and company saved presets. Loads cloud/firestore.production.rules.
// Fake data only. Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, addDoc, collection } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
let env;
const item = i => ({ id: "x" + i, kind: "rubbish", description: "Rubbish removal", material: "Green waste", qty: 6, unit: "m3", unitPrice: 55, note: "" });
const place = { formattedAddress: "1 Test St, Chuwar QLD 4306, Australia", lat: -27.56, lng: 152.78, placeId: "ChIJtest", source: "google-places" };

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-quote-extras",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, "users/op1"), { role: "operator", name: "Sam" });
    await setDoc(doc(d, "users/bAdm"), { role: "admin", name: "Bea", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bSup"), { role: "supervisor", name: "Sue", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bOp"), { role: "operator", name: "Bo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/cAdm"), { role: "admin", name: "Cy", companyId: "charlie", tenantId: "charlie" });
    // An existing quote from before extra items: no extraItems / priceOverrides / addressPlace.
    await setDoc(doc(d, "quotes/hwOld"), { companyId: "heartwood", client: "Orbit", quoteStatus: "Draft", totalEx: 400, lines: [] });
    await setDoc(doc(d, "quotes/bOld"), { companyId: "bravo", client: "Acme", quoteStatus: "Draft", totalEx: 300, lines: [] });
  });
});
test.after(async () => { if (env) await env.cleanup(); });
const db = uid => env.authenticatedContext(uid).firestore();

test("office users save quotes with extra items, overrides, GST and a picked place", async () => {
  const extras = { extraItems: [item(1), { ...item(2), kind: "concrete", description: "Concrete removal", unit: "t", note: "reinforced" }], priceOverrides: { "machine:truck": 360 }, gst: 20, totalInc: 220, addressPlace: place };
  await assertSucceeds(setDoc(doc(db(ALEX), "quotes/hw1"), { companyId: "heartwood", client: "Orbit", quoteStatus: "Draft", totalEx: 200, ...extras }));
  await assertSucceeds(addDoc(collection(db("bAdm"), "quotes"), { companyId: "bravo", tenantId: "bravo", client: "Acme", quoteStatus: "Draft", ...extras }));
  await assertSucceeds(addDoc(collection(db("bSup"), "quotes"), { companyId: "bravo", tenantId: "bravo", client: "Acme", quoteStatus: "Draft", extraItems: [item(3)], priceOverrides: {}, addressPlace: null }));
});

test("existing quotes without the new fields still update", async () => {
  await assertSucceeds(updateDoc(doc(db(ALEX), "quotes/hwOld"), { client: "Orbit Homes" }));
  await assertSucceeds(updateDoc(doc(db("bAdm"), "quotes/bOld"), { client: "Acme Homes" }));
  await assertSucceeds(updateDoc(doc(db("bAdm"), "quotes/bOld"), { extraItems: [item(1)], priceOverrides: { travel: 50 } }));
});

test("shape limits: list/map types, 40 items, 20 overrides, place fields", async () => {
  const base = { companyId: "bravo", tenantId: "bravo", client: "Acme", quoteStatus: "Draft" };
  const a = db("bAdm");
  await assertFails(setDoc(doc(a, "quotes/b1"), { ...base, extraItems: "rubbish" }));
  await assertFails(setDoc(doc(a, "quotes/b2"), { ...base, extraItems: Array.from({ length: 41 }, (_, i) => item(i)) }));
  await assertSucceeds(setDoc(doc(a, "quotes/b3"), { ...base, extraItems: Array.from({ length: 40 }, (_, i) => item(i)) }));
  await assertFails(setDoc(doc(a, "quotes/b4"), { ...base, priceOverrides: [1] }));
  await assertFails(setDoc(doc(a, "quotes/b5"), { ...base, priceOverrides: Object.fromEntries(Array.from({ length: 21 }, (_, i) => ["k" + i, 1])) }));
  await assertFails(setDoc(doc(a, "quotes/b6"), { ...base, addressPlace: { ...place, lat: "south" } }));
  await assertFails(setDoc(doc(a, "quotes/b7"), { ...base, addressPlace: { ...place, extra: true } }));
  await assertFails(updateDoc(doc(a, "quotes/bOld"), { extraItems: { a: 1 } }));
});

test("permissions unchanged: staff and other companies cannot read or write quotes", async () => {
  await assertFails(getDoc(doc(db("bOp"), "quotes/bOld")));
  await assertFails(setDoc(doc(db("bOp"), "quotes/bx"), { companyId: "bravo", client: "x", extraItems: [] }));
  await assertFails(getDoc(doc(db("op1"), "quotes/hwOld")));
  await assertFails(getDoc(doc(db("cAdm"), "quotes/bOld")));
  await assertFails(updateDoc(doc(db("cAdm"), "quotes/bOld"), { extraItems: [] }));
  await assertFails(setDoc(doc(db("bAdm"), "quotes/hwx"), { companyId: "heartwood", client: "x", extraItems: [] }));
  await assertFails(updateDoc(doc(db("bAdm"), "quotes/bOld"), { companyId: "charlie" }));
});

test("company saved presets live on the quote-rates doc: admin writes, supervisor reads, staff neither", async () => {
  const presets = { companyId: "bravo", extraPresets: [{ id: "p1", kind: "rubbish", label: "Skip bin 6m", description: "Skip bin", unit: "skip", unitPrice: 380 }] };
  await assertSucceeds(setDoc(doc(db("bAdm"), "companyMeta/bravo_quoteRates"), presets, { merge: true }));
  const got = await assertSucceeds(getDoc(doc(db("bSup"), "companyMeta/bravo_quoteRates")));
  assert.equal(got.data().extraPresets[0].label, "Skip bin 6m");
  await assertFails(setDoc(doc(db("bSup"), "companyMeta/bravo_quoteRates"), presets, { merge: true }));
  await assertFails(getDoc(doc(db("bOp"), "companyMeta/bravo_quoteRates")));
  await assertSucceeds(setDoc(doc(db(ALEX), "meta/quoteRates"), { extraPresets: presets.extraPresets }, { merge: true }));
});

test("accepted quote → job with extras, amounts and place geo is allowed for the office; crew reads the job", async () => {
  const job = { companyId: "bravo", tenantId: "bravo", client: "Acme", address: "1 Test St", assigned: ["bOp"], status: "Scheduled", source: "quote",
    quote: { extraItems: [item(1)], priceOverrides: {}, gst: 10, totalInc: 110, totalEx: 100, lines: [] },
    workAmounts: ["Rubbish removal — Green waste: 6 m³"], addressPlace: place,
    geo: { lat: place.lat, lng: place.lng, query: "1 Test St", source: "google-places", at: "2026-11-11T00:00:00Z" } };
  await assertSucceeds(setDoc(doc(db("bAdm"), "jobs/bq1"), job));
  const seen = await assertSucceeds(getDoc(doc(db("bOp"), "jobs/bq1")));
  assert.deepEqual(seen.data().workAmounts, ["Rubbish removal — Green waste: 6 m³"]);
  await assertFails(updateDoc(doc(db("bOp"), "jobs/bq1"), { workAmounts: ["tampered"] }));
});
