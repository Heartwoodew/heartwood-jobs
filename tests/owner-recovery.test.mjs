// The PR 143 signup recovery must never give Alex (or another fixed Heartwood admin) a profile in a test company,
// and Alex/Patrick must always open Heartwood. Pure checks plus a static check of app.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bootstrapProfile, isHeartwoodBootstrap, ownerRecoveryAllowed } from "../app/features/company.js";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2", PAT = "R7t41e54Ykcdk9WPdVZnDd697iI2", SYNC = "38SU5waAy4f9UI9N6JTqDMaYpQg2";

test("recovery never runs for Heartwood's fixed admins", () => {
  for (const uid of [ALEX, PAT, SYNC]) {
    assert.equal(isHeartwoodBootstrap(uid), true);
    assert.equal(ownerRecoveryAllowed({ uid, profile: null, online: true }), false);
  }
});

test("recovery still runs for an interrupted CallUp signup", () => {
  assert.equal(ownerRecoveryAllowed({ uid: "halfOwner", profile: null, online: true }), true);
  assert.equal(ownerRecoveryAllowed({ uid: "halfOwner", profile: { companyId: "half-co" }, online: true }), false);
  assert.equal(ownerRecoveryAllowed({ uid: "halfOwner", profile: null, online: false }), false);
  assert.equal(ownerRecoveryAllowed({ uid: "", profile: null, online: true }), false);
});

test("a fixed admin's non-Heartwood profile is ignored; Heartwood and ordinary profiles are kept", () => {
  const stray = { name: "CallUp test", role: "admin", companyId: "callup-test-h2vx", tenantId: "callup-test-h2vx", jobTitle: "Admin" };
  assert.equal(bootstrapProfile(ALEX, stray), null);
  assert.equal(bootstrapProfile(PAT, stray), null);
  const pat = { role: "operator", name: "Patrick", companyId: "heartwood" };
  assert.deepEqual(bootstrapProfile(PAT, pat), pat);
  const legacy = { role: "operator", name: "Nick" };
  assert.deepEqual(bootstrapProfile(PAT, legacy), legacy);
  assert.deepEqual(bootstrapProfile("bravoAdm", stray), stray);
  assert.equal(bootstrapProfile(ALEX, null), null);
});

test("app.js boot: prof is reassignable, recovery is gated, Alex/Patrick never get the No company card", () => {
  const src = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /const prof = snap/);
  assert.match(src, /let prof = bootstrapProfile\(user\.uid,/);
  assert.match(src, /if \(ownerRecoveryAllowed\(\{ uid: user\.uid, profile: prof, online: deviceOnline\(\) \}\)\)/);
  assert.match(src, /if \(!prof && !users && !bootstrapAdmin\) \{ renderNoAccess\(user\); return; \}/);
  const boot = src.indexOf("async function bootSignedIn(");
  assert.ok(src.indexOf("const bootstrapAdmin", boot) < src.indexOf("renderNoAccess(user)", boot));
});
