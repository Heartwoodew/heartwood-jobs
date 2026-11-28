// Real Firestore transactions against the emulator: two workers racing on one export send exactly one email.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { hoursLiveDeps, processHoursExport } from "../functions/hours-export-mail.js";

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "";
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(firestoreHost)) {
  console.error("Refusing hours mail test without the local Firestore emulator. Nothing was sent to a live project.");
  process.exit(1);
}
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
if (!getApps().length) initializeApp({ projectId: "demo-hours-mail" });
const db = getFirestore();

const XLSX = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from("x")]);
const ON = { INVITE_EMAIL_ENABLED: "true", INVITE_EMAIL_ALLOW_TO: "callup932+" };

async function seed(id, over = {}) {
  await db.collection("hoursExports").doc(id).set({
    weekStart: "2026-11-23", weekEnd: "2026-11-29", to: "callup932+hours@gmail.com", fileName: "Acme_hours.xlsx", storagePath: `hoursExports/${id}/Acme_hours.xlsx`,
    people: 2, totalHours: 40, status: "queued", attempts: 0, createdBy: "u1", createdByName: "Alex", createdAt: Timestamp.now(),
    companyId: "acme", companyName: "Acme Civil", ...over,
  });
  await db.collection("companies").doc("acme").set({ name: "Acme Civil", email: "office@acme.test" });
}

function deps(sent, over = {}) {
  return hoursLiveDeps(db, {
    env: ON,
    download: async () => XLSX,
    send: async (payload, key) => { sent.push({ payload, key }); return { ok: true, id: "msg_emu" }; },
    ...over,
  });
}

test("two racing workers send one email and the doc ends up sent", async () => {
  const id = "hxracerace0000000a";
  await seed(id);
  const sent = [];
  const d = deps(sent);
  const [a, b] = await Promise.all([processHoursExport(id, d), processHoursExport(id, d)]);
  assert.equal(sent.length, 1);
  assert.deepEqual([a.action, b.action].sort(), ["none", "sent"]);
  const snap = (await db.collection("hoursExports").doc(id).get()).data();
  assert.equal(snap.status, "sent");
  assert.equal(snap.via, "resend");
  assert.equal(snap.attempts, 1);
  assert.deepEqual(sent[0].payload.to, ["callup932+hours@gmail.com"]);
  assert.equal((await processHoursExport(id, d)).action, "none");
  assert.equal(sent.length, 1);
});

test("a failure is recorded on the document and a later sweep retries it", async () => {
  const id = "hxfailretry000000b";
  await seed(id);
  const sent = [];
  const bad = deps(sent, { send: async () => ({ ok: false, reason: "resend-500" }) });
  assert.equal((await processHoursExport(id, bad)).action, "failed");
  let snap = (await db.collection("hoursExports").doc(id).get()).data();
  assert.equal(snap.status, "failed");
  assert.equal(snap.attempts, 1);
  const good = deps(sent);
  assert.equal((await processHoursExport(id, good)).action, "sent");
  snap = (await db.collection("hoursExports").doc(id).get()).data();
  assert.equal(snap.status, "sent");
  assert.equal(snap.attempts, 2);
});

test("a test company is held in Firestore and nothing is downloaded or sent", async () => {
  const id = "hxtestco000000000c";
  await seed(id, { companyId: "tco", companyName: "Test Co" });
  await db.collection("companies").doc("tco").set({ name: "Test Co", isTest: true });
  const sent = [];
  let downloads = 0;
  const d = deps(sent, { download: async () => { downloads += 1; return XLSX; } });
  assert.equal((await processHoursExport(id, d)).action, "held");
  assert.equal(sent.length, 0);
  assert.equal(downloads, 0);
  const snap = (await db.collection("hoursExports").doc(id).get()).data();
  assert.equal(snap.status, "failed");
  assert.match(snap.error, /test company/i);
});
