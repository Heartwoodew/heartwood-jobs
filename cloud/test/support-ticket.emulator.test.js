// Support ticket rules. Loads production Firestore and Storage rules in the emulator.
// Fake data only. Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, serverTimestamp } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const PATRICK = "R7t41e54Ykcdk9WPdVZnDd697iI2";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const ID = "Abcd1234Abcd1234Abcd";
const ID2 = "Efgh5678Efgh5678Efgh";

let env;

function ownerToken() {
  return { email: "alex@heartwoodew.com", email_verified: true, platformOwner: true };
}
function db(uid, token) { return env.authenticatedContext(uid, token).firestore(); }
function storage(uid, token) { return env.authenticatedContext(uid, token).storage(); }
function ticket(uid, companyId, extra = {}) {
  return {
    subject: "Map pin missing",
    description: "The pin does not show on today's job.",
    uid,
    name: "Sam",
    email: "sam@acme.test",
    role: "labourer",
    companyId,
    companyName: "Acme",
    appVersion: "callup-shell-v156-dispatch-drag",
    swVersion: "callup-shell-v156-dispatch-drag",    userAgent: "test",
    page: "/app/ more",
    createdAt: serverTimestamp(),
    status: "open",
    screenshotPath: "",
    ...extra,
  };
}
function shotMeta(uid, companyId, ticketId) {
  return {
    contentType: "image/jpeg",
    customMetadata: { purpose: "support-ticket", uploaderUid: uid, companyId, ticketId },
  };
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-heartwood",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
    storage: { rules: readFileSync(new URL("../production/storage.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const root = ctx.firestore();
    await setDoc(doc(root, "users/crew1"), { role: "labourer", companyId: "acme", name: "Sam" });
    await setDoc(doc(root, "users/crew2"), { role: "operator", companyId: "acme", name: "Jo" });
    await setDoc(doc(root, "users/bravo"), { role: "admin", companyId: "bravo", name: "Bea" });
    await setDoc(doc(root, "users/heldOp"), { role: "operator", companyId: "held", name: "Pat" });
    await setDoc(doc(root, "companies/acme"), { name: "Acme", isTest: false, status: "active", plan: "paid" });
    await setDoc(doc(root, "companies/held"), { name: "Held", isTest: false, status: "active", plan: "paid", ownerPaused: true });
  });
});

test.after(async () => { if (env) await env.cleanup(); });

test("a person creates and reads only their own ticket, including while the company is paused", async () => {
  const path = `supportTickets/acme/crew1/${ID}/shot.jpg`;
  await assertSucceeds(uploadBytes(ref(storage("crew1"), path), JPEG, shotMeta("crew1", "acme", ID)));
  await assertSucceeds(getBytes(ref(storage("crew1"), path)));
  await assertFails(getBytes(ref(storage("crew2"), path)));
  await assertFails(getBytes(ref(storage("bravo"), path)));
  await assertSucceeds(getBytes(ref(storage(ALEX, ownerToken()), path)));
  await assertFails(uploadBytes(ref(storage("crew1"), `supportTickets/bravo/crew1/${ID}/shot.jpg`), JPEG, shotMeta("crew1", "bravo", ID)));
  await assertFails(uploadBytes(ref(storage("crew1"), `supportTickets/acme/crew2/${ID}/shot.jpg`), JPEG, shotMeta("crew1", "acme", ID)));
  await assertFails(uploadBytes(ref(storage("crew1"), path.replace("shot.jpg", "shot.png")), JPEG, { contentType: "image/png", customMetadata: shotMeta("crew1", "acme", ID).customMetadata }));

  await assertSucceeds(setDoc(doc(db("crew1"), "supportTickets/" + ID), ticket("crew1", "acme", { screenshotPath: path })));
  await assertSucceeds(getDoc(doc(db("crew1"), "supportTickets/" + ID)));
  await assertFails(getDoc(doc(db("crew2"), "supportTickets/" + ID)));
  await assertFails(getDoc(doc(db("bravo"), "supportTickets/" + ID)));
  await assertFails(getDocs(collection(db("crew1"), "supportTickets")));
  await assertSucceeds(getDocs(query(collection(db("crew1"), "supportTickets"), where("uid", "==", "crew1"), where("companyId", "==", "acme"))));
  await assertFails(setDoc(doc(db("crew1"), "supportTickets/BadId"), ticket("crew1", "acme")));
  await assertFails(setDoc(doc(db("crew1"), "supportTickets/" + ID2), ticket("crew2", "acme")));
  await assertFails(setDoc(doc(db("crew1"), "supportTickets/" + ID2), ticket("crew1", "bravo")));
  await assertFails(setDoc(doc(db("crew1"), "supportTickets/" + ID2), ticket("crew1", "acme", { status: "closed" })));
  await assertFails(setDoc(doc(db("crew1"), "supportTickets/" + ID2), ticket("crew1", "acme", { poAmount: 50 })));
  await assertFails(setDoc(doc(db("crew1"), "supportTickets/" + ID2), ticket("crew1", "acme", { screenshotPath: "supportTickets/bravo/crew1/" + ID2 + "/shot.jpg" })));
  await assertSucceeds(setDoc(doc(db("heldOp"), "supportTickets/HeldPaused1234567890ab"), ticket("heldOp", "held")));
  await assertFails(updateDoc(doc(db("crew1"), "supportTickets/" + ID), { status: "closed", updatedAt: serverTimestamp() }));
});

test("only the platform owner lists every ticket and changes its status", async () => {
  await assertSucceeds(getDocs(collection(db(ALEX, ownerToken()), "supportTickets")));
  await assertSucceeds(getDoc(doc(db(ALEX, ownerToken()), "supportTickets/" + ID)));
  await assertSucceeds(updateDoc(doc(db(ALEX, ownerToken()), "supportTickets/" + ID), { status: "closed", updatedAt: serverTimestamp() }));
  const closed = await getDoc(doc(db(ALEX, ownerToken()), "supportTickets/" + ID));
  assert.equal(closed.data().status, "closed");
  assert.equal(closed.data().subject, "Map pin missing");
  await assertFails(updateDoc(doc(db(ALEX, ownerToken()), "supportTickets/" + ID), { subject: "Changed", updatedAt: serverTimestamp() }));
  await assertFails(getDocs(collection(db(PATRICK), "supportTickets")));
  await assertFails(getDocs(collection(db("someone", { email: "a@b.test", email_verified: true, platformOwner: true }), "supportTickets")));
  const own = await getDoc(doc(db("crew1"), "supportTickets/" + ID));
  assert.equal(own.data().poAmount, undefined);
  assert.doesNotMatch(JSON.stringify(own.data()), /poAmount|quoteAmount|invoiceAmount/);
});
