import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { saveGuard, settleOrQueue } from "../../app/features/pending-write.js";

test("a write that answers quickly is not reported as queued", async () => {
  assert.deepEqual(await settleOrQueue(Promise.resolve(7), 50), { queued: false, value: 7 });
});

test("a write with no answer (no signal) is reported as queued so the form can close", async () => {
  const r = await settleOrQueue(new Promise(() => {}), 30);
  assert.equal(r.queued, true);
});

test("a rejected write still throws to the form", async () => {
  await assert.rejects(settleOrQueue(Promise.reject(new Error("permission-denied")), 50), /permission-denied/);
});

test("only one save runs at a time", () => {
  const g = saveGuard();
  assert.equal(g.start(), true);
  assert.equal(g.start(), false);
  g.end();
  assert.equal(g.start(), true);
});

test("the New Job form uses one job id per form and a save guard", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.match(app, /const newRef = n \? doc\(collection\(db, "jobs"\)\) : null, guard = saveGuard\(\);/);
  assert.match(app, /if \(!guard\.start\(\)\) return;/);
  assert.match(app, /write = setDoc\(newRef, scopeRecord\(/);
  assert.doesNotMatch(app, /await addDoc\(collection\(db, "jobs"\), scopeRecord\(\{ \.\.\.data, \.\.\.extra/);
});
