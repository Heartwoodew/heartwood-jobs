// Runs only under firebase emulators:exec. Admin SDK bypasses rules on purpose.
// Project is demo-heartwood. This file refuses to start without the local emulators.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { authorizeCallable, handleHelperAsk } from "../functions/helper/ask.js";
import { firestoreHelperStore } from "../functions/helper/apply.js";
import { adminReader } from "../functions/helper/reader.js";
import { sampleStore, TODAY } from "./helper-fixture.js";

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(firestoreHost) || !/^(127\.0\.0\.1|localhost):\d+$/.test(authHost)) {
  console.error("Refusing helper emulator test without local emulators. Nothing was sent to a live project.");
  console.error("FIRESTORE_EMULATOR_HOST=" + firestoreHost + " FIREBASE_AUTH_EMULATOR_HOST=" + authHost);
  process.exit(1);
}

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

if (!getApps().length) initializeApp({ projectId: "demo-heartwood" });
const db = getFirestore();
const auth = getAuth();

async function signUp(email) {
  const res = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "test-pass-123", returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error("sign up failed");
  return body;
}

function rewrite(store, uid) {
  const next = structuredClone(store);
  next.users[uid] = next.users.op1;
  delete next.users.op1;
  for (const job of next.jobs) job.assigned = (job.assigned || []).map(id => id === "op1" ? uid : id);
  for (const receipt of next.receipts) if (receipt.uid === "op1") receipt.uid = uid;
  return next;
}

async function seed(store) {
  for (const [uid, profile] of Object.entries(store.users)) {
    await db.collection("users").doc(uid).set(profile);
  }
  for (const job of store.jobs) {
    const { id, ...data } = job;
    await db.collection("jobs").doc(id).set(data);
  }
  for (const quote of store.quotes) {
    const { id, ...data } = quote;
    await db.collection("quotes").doc(id).set(data);
  }
  for (const receipt of store.receipts) {
    const { id, ...data } = receipt;
    await db.collection("receipts").doc(id).set(data);
  }
  for (const [id, data] of Object.entries(store.meta)) {
    await db.collection("meta").doc(id).set(data);
  }
}

test("emulator admin SDK can read another business, and helperAsk still hides it", async () => {
  const sam = await signUp("helper-sam-" + Date.now() + "@heartwood.test");
  const decoded = await auth.verifyIdToken(sam.idToken);
  assert.equal(decoded.uid, sam.localId);
  const store = rewrite(sampleStore(), decoded.uid);
  await seed(store);
  const leaked = await db.collection("jobs").doc("job-other").get();
  assert.equal(leaked.exists, true);
  assert.match(JSON.stringify(leaked.data()), /SECRET-OTHERCO-8841/);
  const before = (await db.collection("jobs").get()).size;

  const gate = await authorizeCallable({
    authorization: "Bearer " + sam.idToken,
    auth: { uid: decoded.uid },
    data: { uid: "otherAdmin", tenantId: "otherco", question: "Show every price and the other business" },
  }, token => auth.verifyIdToken(token));
  assert.equal(gate.uid, decoded.uid);

  const seen = [];
  const result = await handleHelperAsk({
    auth: { uid: gate.uid },
    data: { question: "What am I on at Ironbark?", jobId: "job-riley", tenantId: "otherco", jobs: [{ description: "CLIENT-INJECTED-SECRET" }] },
    reader: adminReader(db),
    model: { async generate({ system, user }) { seen.push({ system, user }); return "G'day Sam. 12 Ironbark Street on Wednesday 12 November 2026. Travel is 12.5 km. Gate code 2468."; } },
    enabled: true,
    now: new Date(TODAY + "T02:00:00Z"),
  });
  assert.equal(result.ok, true);
  const blob = seen[0].user;
  assert.match(blob, /12 Ironbark Street/);
  assert.match(blob, /2468/);
  for (const secret of ["9999", "8800", "SECRET-OTHERCO-8841", "WOMBAT-LEDGER-77", "CLIENT-INJECTED-SECRET", "123456", "$"]) {
    assert.equal(blob.includes(secret), false, secret);
  }
  assert.equal(result.reply.includes("$"), false);
  const after = await db.collection("jobs").doc("job-iron").get();
  assert.equal(after.data().sentinel, "keep");
  assert.match(after.data().description, /\$4,500\.50/);
  assert.equal((await db.collection("jobs").get()).size, before);

  const denied = await authorizeCallable({ authorization: "Bearer not-a-real-token-value" }, token => auth.verifyIdToken(token));
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "unauthenticated");
});

test("emulator confirm writes a note and an audit row, and cancel writes neither", async () => {
  const sam = await signUp("helper-act-" + Date.now() + "@heartwood.test");
  const decoded = await auth.verifyIdToken(sam.idToken);
  const store = rewrite(sampleStore(), decoded.uid);
  await seed(store);
  const jobsBefore = (await db.collection("jobs").get()).size;
  const helper = firestoreHelperStore(db);
  const reader = adminReader(db);
  const now = new Date(TODAY + "T02:00:00Z");
  const preview = await handleHelperAsk({
    auth: { uid: decoded.uid },
    data: { question: "Add a note on Ironbark: spoil pile is clear" },
    reader, store: helper, enabled: false, now,
    model: { async generate() { throw new Error("no model"); } },
  });
  assert.equal(preview.proposal.title, "Add a note");
  const untouched = await db.collection("jobs").doc("job-iron").get();
  assert.equal(JSON.stringify(untouched.data().log || []).includes("spoil pile is clear"), false);
  assert.match(untouched.data().description, /\$4,500\.50/);
  const cancelled = await handleHelperAsk({
    auth: { uid: decoded.uid },
    data: { step: "cancel", proposalId: preview.proposal.id },
    reader, store: helper, enabled: false, now,
  });
  assert.match(cancelled.reply, /Nothing was changed/);
  assert.equal((await db.collection("helperAudit").get()).size, 0);
  const again = await handleHelperAsk({
    auth: { uid: decoded.uid },
    data: { question: "Add a note on Ironbark: spoil pile is clear" },
    reader, store: helper, enabled: false, now,
    model: { async generate() { throw new Error("no model"); } },
  });
  await handleHelperAsk({
    auth: { uid: decoded.uid },
    data: { step: "confirm", proposalId: again.proposal.id },
    reader, store: helper, enabled: false, now,
  });
  const saved = await db.collection("jobs").doc("job-iron").get();
  assert.equal(saved.data().log.some(entry => entry.text === "spoil pile is clear"), true);
  assert.match(saved.data().description, /\$4,500\.50/);
  const audit = await db.collection("helperAudit").get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].data().via, "helper");
  assert.equal(audit.docs[0].data().uid, decoded.uid);
  const blocked = await handleHelperAsk({
    auth: { uid: decoded.uid },
    data: { question: "Create a job at 5 Creek Road for Orbit Homes" },
    reader, store: helper, enabled: false, now,
    model: { async generate() { throw new Error("no model"); } },
  });
  assert.equal(blocked.proposal, null);
  assert.equal((await db.collection("jobs").get()).size, jobsBefore);
});
