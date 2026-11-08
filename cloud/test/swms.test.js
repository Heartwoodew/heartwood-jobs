import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCHEDULING_APPROVED } from "../../app/features/cloud-retention.js";
import {
  SWMS, SWMS_VERSION, SWMS_VALID_MONTHS, SWMS_DUE_DAYS, addMonths, statusOf, latestSig,
  swmsSignatureData, placeholderLines,
} from "../../app/features/swms-sign.js";
const NOW = Date.parse("2026-11-06T10:00:00+10:00");
const day = 86400000;

function rulesSlice(text) {
  const start = text.indexOf("// BEGIN SWMS SIGNATURE RULES");
  const end = text.indexOf("// END SWMS SIGNATURE RULES");
  assert.ok(start >= 0 && end > start);
  return text.slice(start, end + "// END SWMS SIGNATURE RULES".length);
}

test("SWMS signatures last 12 months and come due inside 30 days", () => {
  assert.equal(SWMS_VALID_MONTHS, 12);
  assert.equal(SWMS_DUE_DAYS, 30);
  assert.deepEqual(SWMS.map(row => row[0]), [
    "working-near-roads", "mobile-plant", "working-with-silica", "hazardous-substances", "electrical",
  ]);
  assert.equal(SWMS_VERSION, "2026-07");
  const base = { uid: "p", swmsId: "electrical", version: SWMS_VERSION };
  assert.equal(statusOf(null, NOW).k, "none");
  assert.equal(statusOf({ ...base, signedAtMs: Date.parse("2026-06-01T10:00:00+10:00") }, NOW).k, "ok");
  assert.equal(statusOf({ ...base, signedAtMs: Date.parse("2025-11-20T10:00:00+10:00") }, NOW).k, "due");
  assert.equal(statusOf({ ...base, signedAtMs: Date.parse("2025-10-01T10:00:00+10:00") }, NOW).k, "exp");
  assert.equal(statusOf({ ...base, signedAtMs: Date.parse("2026-08-01T10:00:00+10:00"), version: "2025-07" }, NOW).k, "old");
  const dueSigned = addMonths(NOW + 30 * day, -12);
  const okSigned = addMonths(NOW + 31 * day, -12);
  assert.equal(statusOf({ ...base, signedAtMs: dueSigned }, NOW).k, "due");
  assert.equal(statusOf({ ...base, signedAtMs: okSigned }, NOW).k, "ok");
  assert.equal(statusOf({ ...base, signedAtMs: addMonths(NOW, -12) }, NOW).k, "exp");
  const older = { ...base, signedAtMs: Date.parse("2026-01-01T10:00:00+10:00") };
  const newer = { ...base, signedAtMs: Date.parse("2026-06-01T10:00:00+10:00") };
  assert.equal(latestSig([older, newer], "p", "electrical"), newer);
  assert.equal(latestSig([newer], "sam", "electrical"), null);
});

test("a signature records the signer, the typed name, and the job only when one was chosen", () => {
  const now = Date.parse("2026-11-06T10:00:00+10:00");
  const general = swmsSignatureData({
    uid: "patrick", name: "  Patrick  ", swmsId: "electrical", sig: "data:image/png;base64,AAAA", now, device: "phone",
  });
  assert.equal(general.uid, "patrick");
  assert.equal(general.name, "Patrick");
  assert.equal(general.jobId, "");
  assert.equal(general.jobLabel, "");
  assert.equal(general.version, "2026-07");
  assert.equal(general.swmsTitle, "Electrical & underground services");
  assert.equal(general.expiresAtMs, addMonths(now, 12));
  const onJob = swmsSignatureData({
    uid: "patrick", name: "Patrick", swmsId: "working-near-roads",
    jobId: "j2", jobLabel: "#2402 · Lot 88", sig: "data:image/png;base64,AAAA", now,
  });
  assert.equal(onJob.jobId, "j2");
  assert.equal(onJob.jobLabel, "#2402 · Lot 88");
  const span = onJob.expiresAtMs - onJob.signedAtMs;
  assert.ok(span >= 364 * day && span <= 367 * day);
});

test("a missing official PDF stays a placeholder and does not invent SWMS content", async () => {
  const lines = placeholderLines("Working near roads").join("\n");
  assert.match(lines, /PLACEHOLDER - not a SWMS/);
  assert.match(lines, /not a Safe Work Method Statement/);
  assert.match(lines, /Working near roads/);
  assert.match(lines, /Do not send this file to a client as the SWMS/);
  assert.doesNotMatch(lines, /hard hat|exclusion zone|respirator|control measure|hierarchy of control|PPE/i);
});

test("SWMS signature rules are an additive block and do not touch receipts, finance, or scheduling", () => {
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const frag = readFileSync(new URL("../production/firestore.swms.rules", import.meta.url), "utf8");
  assert.equal(rulesSlice(emu), rulesSlice(frag));
  assert.match(emu, /match \/receipts\/\{id\}/);
  assert.match(emu, /match \/xeroQueue\/\{id\}/);
  assert.match(rulesSlice(frag), /match \/swmsSignatures\/\{id\}/);
  assert.match(rulesSlice(frag), /request\.resource\.data\.uid == request\.auth\.uid/);
  assert.match(rulesSlice(frag), /signedAt == request\.time/);
  assert.match(rulesSlice(frag), /allow update, delete: if false/);
  assert.doesNotMatch(rulesSlice(frag), /match \/receipts\/|match \/xeroQueue\/|match \/jobs\/|finance|SCHEDULING_APPROVED/);
  assert.doesNotMatch(rulesSlice(frag), /match \/b\/\{bucket\}/);
  const storage = readFileSync(new URL("../emulator/storage.rules", import.meta.url), "utf8");
  assert.doesNotMatch(storage, /swmsSignatures|swms-signature/);
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.match(app, /uid: me\.uid/);
  assert.match(app, /signedAt: serverTimestamp\(\)/);
  assert.doesNotMatch(app, /SCHEDULING_APPROVED\s*=\s*true/);
  assert.equal(SCHEDULING_APPROVED, false);
});
