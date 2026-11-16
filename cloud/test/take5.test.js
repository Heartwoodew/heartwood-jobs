import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TAKE5_STEPS, canViewTake5, hasTake5, newTake5Id, shouldPromptTake5, take5Enabled, take5FormHtml, take5IdFor, take5Payload, take5PhotoPath,
} from "../../app/features/take5.js";

const job = { id: "job-1", sm8JobNo: "18" };
const steps = { stop: true, look: true, assess: true, control: true, proceed: true };

test("a Take 5 needs all five steps and a hazard note", () => {
  assert.deepEqual(TAKE5_STEPS.map(([id]) => id), ["stop", "look", "assess", "control", "proceed"]);
  const id = newTake5Id();
  assert.match(id, /^t5[a-z0-9]{16}$/);
  const missing = take5Payload({ id, uid: "u1", name: "Ada", companyId: "bravo", job, note: "", steps, day: "2026-11-15" });
  assert.equal(missing.ok, false);
  const partial = take5Payload({ id, uid: "u1", name: "Ada", companyId: "bravo", job, note: "Wet floor", steps: { ...steps, proceed: false }, day: "2026-11-15" });
  assert.match(partial.reason, /five steps/);
  const built = take5Payload({ id, uid: "u1", name: "Ada", companyId: "bravo", job, note: "Wet floor. Cones out.", steps, day: "2026-11-15", photoPath: "" });
  assert.equal(built.ok, true);
  assert.equal(built.data.jobNo, "18");
  assert.equal(built.data.photoPath, "");
  assert.equal(take5Payload({ ...built.data, id, uid: "u1", name: "Ada", companyId: "bravo", job, note: "Wet floor", steps, day: "2026-11-15", photoPath: "take5Photos/other/u1_" + id + ".jpg" }).ok, false);
  assert.equal(take5Payload({ id, uid: "u1", name: "Ada", companyId: "bravo", job, note: "Wet floor", steps, day: "2026-11-15", photoPath: take5PhotoPath("bravo", "u1", id) }).ok, true);
});

test("the same person and job always get the same Take 5 id", () => {
  assert.equal(take5IdFor("ada", "job-1"), take5IdFor("ada", "job-1"));
  assert.notEqual(take5IdFor("ada", "job-1"), take5IdFor("ben", "job-1"));
  assert.match(take5IdFor("ada", "job-1"), /^t5[a-z0-9]{16}$/);
});

test("field crew are prompted only while Take 5s are on, and supervisors can view them", () => {
  assert.equal(take5Enabled(undefined), true);
  assert.equal(take5Enabled(null), true);
  assert.equal(take5Enabled({}), true);
  assert.equal(take5Enabled({ enabled: true }), true);
  assert.equal(take5Enabled({ enabled: false }), false);
  assert.equal(shouldPromptTake5({ role: "operator" }, take5Enabled(null)), true);
  assert.equal(shouldPromptTake5({ role: "operator" }, take5Enabled({ enabled: false })), false);
  assert.equal(shouldPromptTake5({ role: "operator" }, false), false);
  assert.equal(shouldPromptTake5({ role: "operator" }, true), true);
  assert.equal(shouldPromptTake5({ role: "labourer" }, true), true);
  assert.equal(shouldPromptTake5({ role: "supervisor" }, true), false);
  assert.equal(shouldPromptTake5({ role: "manager" }, true), false);
  assert.equal(shouldPromptTake5({ role: "admin", staffRole: "operator" }, true), true);
  assert.equal(canViewTake5({ role: "operator" }), false);
  assert.equal(canViewTake5({ role: "supervisor" }), true);
  assert.equal(canViewTake5({ role: "manager" }), true);
  assert.equal(canViewTake5({ role: "admin", staffRole: "operator" }), true);
  assert.equal(hasTake5([{ uid: "ada", jobId: "job-1" }], "ada", "job-1"), true);
  assert.equal(hasTake5([{ uid: "ada", jobId: "job-1" }], "ben", "job-1"), false);
  const html = take5FormHtml(job, { name: "Ada", day: "2026-11-15" });
  for (const [, label] of TAKE5_STEPS) assert.match(html, new RegExp(label));
  assert.match(html, /Hazards and controls/);
  assert.match(html, /type="file"/);
  assert.doesNotMatch(html, /\$|price|invoice/i);
});

test("the shell caches the Take 5 and performance modules", () => {
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v117-photo-upload/);
  assert.match(sw, /features\/performance\.js/);
  assert.match(sw, /features\/take5\.js/);
  const prod = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const start = "// BEGIN STAFF PERFORMANCE RULES";
  const end = "// END STAFF PERFORMANCE RULES";
  const slice = text => text.slice(text.indexOf(start), text.indexOf(end) + end.length);
  assert.equal(slice(prod), slice(emu));
  assert.match(slice(prod), /match \/take5s\/\{id\}/);
  assert.match(slice(prod), /match \/performanceSettings\/\{companyId\}/);
  assert.match(slice(prod), /match \/take5Settings\/\{companyId\}/);
  assert.match(slice(prod), /companyNotPaused\(companyId\)/);
});
