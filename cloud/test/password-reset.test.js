import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canSendPasswordReset, forgotPasswordMessage, GOOGLE_ONLY_RESET, PASSWORD_RESET_NEUTRAL, staffViewHtml,
} from "../../app/features/staff-invites.js";
import {
  ALEX_UID, PATRICK_UID, adminSendPasswordReset, buildPasswordResetEmail, googleOnlyAccount,
  queuePasswordResetEmail, rateDecision, resetFailureText,
} from "../functions/password-reset.js";

const NOW = new Date("2026-11-15T01:00:00.000Z");
const LINK = "https://heartwood-9f37f.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=SECRETCODE";
const TOKEN = "a".repeat(43);

function person(uid, profile, grant = false) {
  return { profile: profile || null, heartwoodGrant: grant };
}

function harness({ users, authUsers, companies, env, allowLiveMail = true } = {}) {
  const calls = { auth: [], link: [], send: [], mail: [] };
  const stamps = new Map();
  let now = NOW;
  const deps = {
    now: () => now,
    env: env || { INVITE_EMAIL_ENABLED: "true" },
    allowLiveMail,
    async getUser(uid) { return users[uid] || { profile: null, heartwoodGrant: false }; },
    async getAuthUser(uid) {
      calls.auth.push(uid);
      return Object.prototype.hasOwnProperty.call(authUsers, uid) ? authUsers[uid] : null;
    },
    async getCompany(id) { return (companies && companies[id]) || null; },
    async generateLink(email, settings) {
      calls.link.push({ email, settings });
      return LINK;
    },
    async claimRate({ uid, now: at }) {
      const decision = rateDecision(stamps.get(uid) || [], at);
      if (!decision.ok) return { ok: false };
      stamps.set(uid, decision.stamps);
      return { ok: true };
    },
    async sendResend(payload, key) {
      calls.send.push({ payload, key });
      return { ok: true, id: "em_1" };
    },
    async writeMail(col, doc) { calls.mail.push({ col, doc }); },
  };
  return { deps, calls, setNow(d) { now = d; } };
}

const passwordUser = (email, extra = []) => ({
  email,
  displayName: "",
  providerData: [{ providerId: "password" }, ...extra],
});

function world() {
  return harness({
    users: {
      [ALEX_UID]: person(ALEX_UID, null),
      [PATRICK_UID]: person(PATRICK_UID, { role: "operator", companyId: "heartwood", name: "Patrick" }),
      hwGrant: person("hwGrant", { role: "admin", companyId: "heartwood", name: "Hana" }, true),
      hwBare: person("hwBare", { role: "admin", companyId: "heartwood", name: "Nora" }, false),
      hwOp: person("hwOp", { role: "operator", companyId: "heartwood", name: "Sam", email: "sam.profile@example.com" }),
      hwAdmin2: person("hwAdmin2", { role: "admin", companyId: "heartwood", name: "Pat Admin" }, true),
      hwSup: person("hwSup", { role: "supervisor", companyId: "heartwood", name: "Sue" }),
      bravoAdmin: person("bravoAdmin", { role: "admin", companyId: "bravo", name: "Bea" }),
      bravoAdmin2: person("bravoAdmin2", { role: "admin", companyId: "bravo", tenantId: "bravo", name: "Bo" }),
      bravoOp: person("bravoOp", { role: "operator", companyId: "bravo", name: "Riley" }),
      bravoSup: person("bravoSup", { role: "supervisor", companyId: "bravo", name: "Sid" }),
      charlieAdmin: person("charlieAdmin", { role: "admin", companyId: "charlie", name: "Cy" }),
    },
    authUsers: {
      [ALEX_UID]: passwordUser("alex@heartwoodew.com"),
      [PATRICK_UID]: passwordUser("patrick@heartwoodew.com"),
      hwOp: passwordUser("sam.login@example.com"),
      hwAdmin2: passwordUser("hana.other@example.com"),
      hwGrant: passwordUser("hana@example.com"),
      bravoOp: passwordUser("riley@bravo.test"),
      bravoAdmin2: passwordUser("bo@bravo.test"),
      googleOnly: { email: "gee@bravo.test", providerData: [{ providerId: "google.com" }] },
      both: passwordUser("both@bravo.test", [{ providerId: "google.com" }]),
      phoneOnly: { email: "ph@bravo.test", providerData: [{ providerId: "phone" }] },
    },
    companies: { bravo: { name: "Bravo Civil", email: "office@bravo.test" } },
  });
}

test("rate limit keeps three stamps inside the hour and drops older ones", () => {
  const first = rateDecision([], NOW);
  assert.equal(first.ok, true);
  const second = rateDecision(first.stamps, new Date(NOW.getTime() + 1000));
  const third = rateDecision(second.stamps, new Date(NOW.getTime() + 2000));
  const fourth = rateDecision(third.stamps, new Date(NOW.getTime() + 3000));
  assert.equal(fourth.ok, false);
  assert.equal(fourth.stamps.length, 3);
  const later = rateDecision(third.stamps, new Date(NOW.getTime() + 60 * 60 * 1000 + 2001));
  assert.equal(later.ok, true);
  assert.equal(later.stamps.length, 1);
});

test("authorisation: same company admin only, including other admins, never self, never another company", async () => {
  const { deps, calls } = world();
  const ok = await adminSendPasswordReset({ callerUid: "bravoAdmin", targetUid: "bravoOp" }, deps);
  assert.deepEqual(ok, { ok: true });
  assert.equal(calls.link.length, 1);
  assert.equal(calls.link[0].email, "riley@bravo.test");
  assert.equal(calls.link[0].settings.url, "https://app.callupapp.com.au/app/");
  assert.equal(calls.link[0].settings.handleCodeInApp, false);
  assert.equal(JSON.stringify(ok).includes("SECRET"), false);
  assert.equal(JSON.stringify(calls.mail).includes("SECRET"), false);
  assert.match(calls.send[0].payload.text, /SECRETCODE/);
  assert.equal(calls.send[0].payload.to[0], "riley@bravo.test");
  assert.match(calls.send[0].payload.subject, /Bravo Civil/);
  assert.equal(calls.send[0].payload.from, "CallUp <noreply@callupapp.com.au>");
  const prose = calls.send[0].payload.subject + "\n" + calls.send[0].payload.text.replace(/https:\S+/g, "");
  assert.doesNotMatch(prose, /heartwood|heartwoodew/i);

  const otherAdmin = await adminSendPasswordReset({ callerUid: "bravoAdmin", targetUid: "bravoAdmin2", companyId: "heartwood", email: "attacker@example.com" }, deps);
  assert.deepEqual(otherAdmin, { ok: true });
  assert.equal(calls.send.at(-1).payload.to[0], "bo@bravo.test");

  const self = await adminSendPasswordReset({ callerUid: "bravoAdmin", targetUid: "bravoAdmin" }, deps);
  assert.deepEqual(self, { ok: false, reason: "self" });

  const cross = await adminSendPasswordReset({ callerUid: "bravoAdmin", targetUid: "hwOp" }, deps);
  assert.deepEqual(cross, { ok: false, reason: "permission-denied" });
  const owner = await adminSendPasswordReset({ callerUid: "charlieAdmin", targetUid: ALEX_UID }, deps);
  assert.deepEqual(owner, { ok: false, reason: "permission-denied" });
  const sup = await adminSendPasswordReset({ callerUid: "bravoSup", targetUid: "bravoOp" }, deps);
  assert.deepEqual(sup, { ok: false, reason: "permission-denied" });
  const supAdmin = await adminSendPasswordReset({ callerUid: "hwSup", targetUid: "hwAdmin2" }, deps);
  assert.deepEqual(supAdmin, { ok: false, reason: "permission-denied" });
  const supOwner = await adminSendPasswordReset({ callerUid: "hwSup", targetUid: ALEX_UID }, deps);
  assert.deepEqual(supOwner, { ok: false, reason: "permission-denied" });
  const bare = await adminSendPasswordReset({ callerUid: "hwBare", targetUid: "hwOp" }, deps);
  assert.deepEqual(bare, { ok: false, reason: "permission-denied" });
  const anon = await adminSendPasswordReset({ targetUid: "bravoOp" }, deps);
  assert.deepEqual(anon, { ok: false, reason: "unauthenticated" });

  assert.ok(calls.auth.includes("bravoOp"));
  assert.equal(calls.auth.includes("hwOp"), false);
  assert.equal(calls.auth.includes(ALEX_UID), false);
});

test("a Heartwood admin can reset Heartwood staff and the owner, and the mail is branded Heartwood", async () => {
  const { deps, calls } = world();
  const staff = await adminSendPasswordReset({ callerUid: "hwGrant", targetUid: "hwOp" }, deps);
  assert.deepEqual(staff, { ok: true });
  assert.equal(calls.link[0].settings.url, "https://jobs.heartwoodew.com/app/");
  assert.match(calls.send[0].payload.subject, /Heartwood Jobs/);
  assert.match(calls.send[0].payload.text, /Heartwood Jobs/);
  assert.equal(calls.send[0].payload.to[0], "sam.login@example.com");

  const byPatrick = await adminSendPasswordReset({ callerUid: PATRICK_UID, targetUid: ALEX_UID }, deps);
  assert.deepEqual(byPatrick, { ok: true });
  const byAlex = await adminSendPasswordReset({ callerUid: ALEX_UID, targetUid: "hwOp" }, deps);
  assert.deepEqual(byAlex, { ok: true });
  const alexSelf = await adminSendPasswordReset({ callerUid: ALEX_UID, targetUid: ALEX_UID }, deps);
  assert.equal(alexSelf.reason, "self");
});

test("google-only sign-in is refused before a link is minted; a password plus Google still resets", async () => {
  const base = world();
  base.deps.getUser = async uid => {
    if (uid === "bravoAdmin") return person("bravoAdmin", { role: "admin", companyId: "bravo", name: "Bea" });
    if (uid === "googleOnly" || uid === "both" || uid === "phoneOnly") {
      return person(uid, { role: "operator", companyId: "bravo", name: "Gee" });
    }
    return { profile: null, heartwoodGrant: false };
  };
  const google = await adminSendPasswordReset({ callerUid: "bravoAdmin", targetUid: "googleOnly" }, base.deps);
  assert.deepEqual(google, { ok: false, reason: "google-only" });
  assert.equal(googleOnlyAccount({ providerData: [{ providerId: "google.com" }] }), true);
  assert.equal(googleOnlyAccount({ providerData: [{ providerId: "password" }, { providerId: "google.com" }] }), false);
  assert.equal(base.calls.link.length, 0);
  assert.equal(base.calls.send.length, 0);
  assert.equal(GOOGLE_ONLY_RESET, "This person signs in with Google, so there's no password to reset.");

  const both = await adminSendPasswordReset({ callerUid: "bravoAdmin", targetUid: "both" }, base.deps);
  assert.deepEqual(both, { ok: true });
  const phone = await adminSendPasswordReset({ callerUid: "bravoAdmin", targetUid: "phoneOnly" }, base.deps);
  assert.equal(phone.reason, "not-sent");
  assert.equal(base.calls.link.length, 1);
});

test("at most three reset emails per person per hour", async () => {
  const h = world();
  for (let i = 0; i < 3; i++) {
    const result = await adminSendPasswordReset({ callerUid: "bravoAdmin", targetUid: "bravoOp" }, h.deps);
    assert.equal(result.ok, true, String(i));
  }
  const blocked = await adminSendPasswordReset({ callerUid: "bravoAdmin", targetUid: "bravoOp" }, h.deps);
  assert.deepEqual(blocked, { ok: false, reason: "rate-limited" });
  assert.equal(h.calls.link.length, 3);
  h.setNow(new Date(NOW.getTime() + 60 * 60 * 1000));
  const again = await adminSendPasswordReset({ callerUid: "bravoAdmin", targetUid: "bravoOp" }, h.deps);
  assert.equal(again.ok, true);
  assert.equal(h.calls.link.length, 4);
});

test("mail stays off unless invite email is enabled, and the link is not stored", async () => {
  const held = world();
  held.deps.env = {};
  held.deps.allowLiveMail = false;
  const quiet = await adminSendPasswordReset({ callerUid: "bravoAdmin", targetUid: "bravoOp" }, held.deps);
  assert.deepEqual(quiet, { ok: false, reason: "not-sent" });
  assert.equal(held.calls.link.length, 0);
  assert.equal(held.calls.send.length, 0);

  const direct = await queuePasswordResetEmail({
    name: "Riley", email: "riley@bravo.test", link: LINK, companyId: "bravo",
    company: { name: "Bravo Civil", email: "office@bravo.test" },
    env: {}, allowLiveMail: false, writeMail: held.deps.writeMail,
  });
  assert.equal(direct.sent, false);
  assert.equal(JSON.stringify(held.calls.mail).includes("SECRET"), false);

  await assert.rejects(() => queuePasswordResetEmail({
    name: "Riley", email: "riley@bravo.test", link: LINK, companyId: "bravo",
    env: { NODE_TEST_CONTEXT: "child", INVITE_EMAIL_ENABLED: "true" },
    allowLiveMail: true,
    sendResend: () => { throw new Error("should not send"); },
  }), /refusing live password reset email under test/);

  const branded = buildPasswordResetEmail({
    name: "Riley", email: "riley@bravo.test", link: "https://app.callupapp.com.au/__/auth/action?mode=resetPassword&oobCode=CODE",
    companyId: "bravo", companyName: "Bravo Civil", companyEmail: "office@bravo.test",
    config: { enabled: true, provider: "resend", neutralFrom: "CallUp <noreply@callupapp.com.au>" },
  });
  assert.equal(branded.subject, "Reset your Bravo Civil password");
  assert.doesNotMatch(JSON.stringify(branded), /heartwood|heartwoodew/i);
  assert.match(resetFailureText("rate-limited"), /Wait an hour/);
  assert.doesNotMatch(resetFailureText("permission-denied"), /https?:/);
});

test("the staff button is only on an admin's list, only for someone else's login", () => {
  const invites = [
    { id: "p", name: "Casey Nguyen", email: "casey.nguyen@example.com", role: "operator", status: "pending", token: TOKEN, expiresAt: "2026-11-20T00:00:00.000Z", companyId: "bravo" },
  ];
  const logins = [
    { uid: "bravoAdmin", name: "Bea", email: "bea@bravo.test", role: "admin", companyId: "bravo" },
    { uid: "bravoOp", name: "Riley", email: "riley@bravo.test", role: "operator", companyId: "bravo" },
  ];
  const admin = staffViewHtml(invites, {
    now: NOW, companyId: "bravo", origin: "https://app.callupapp.com.au", logins, resetPasswords: true, viewerUid: "bravoAdmin",
  });
  assert.match(admin, /data-password-reset="bravoOp"/);
  assert.match(admin, /Send password reset/);
  assert.doesNotMatch(admin, /data-password-reset="bravoAdmin"/);
  const pending = admin.slice(admin.indexOf('data-staff-status="pending"'), admin.indexOf('data-staff-status="active"'));
  assert.doesNotMatch(pending, /data-password-reset|Send password reset/);
  const supervisor = staffViewHtml(invites, { now: NOW, companyId: "bravo", logins, resetPasswords: false, viewerUid: "bravoSup" });
  assert.doesNotMatch(supervisor, /Send password reset|data-password-reset/);

  assert.equal(canSendPasswordReset({ role: "admin", cloudProfile: { role: "admin" } }), true);
  assert.equal(canSendPasswordReset({ role: "admin" }), true);
  assert.equal(canSendPasswordReset({ uid: PATRICK_UID, role: "admin", staffRole: "operator" }), true);
  assert.equal(canSendPasswordReset({ role: "admin", staffRole: "manager" }), false);
  assert.equal(canSendPasswordReset({ role: "admin", cloudProfile: { role: "supervisor" } }), false);
  assert.equal(canSendPasswordReset({ role: "supervisor", cloudProfile: { role: "supervisor" } }), false);
  assert.equal(canSendPasswordReset({ role: "manager" }), false);
  assert.equal(canSendPasswordReset({ role: "operator" }), false);
});

test("forgot password uses one neutral sentence and gentle errors", () => {
  assert.equal(PASSWORD_RESET_NEUTRAL, "If that email has a CallUp login, a reset link is on its way.");
  assert.equal(forgotPasswordMessage("sent"), PASSWORD_RESET_NEUTRAL);
  assert.equal(forgotPasswordMessage("auth/user-not-found"), PASSWORD_RESET_NEUTRAL);
  assert.equal(forgotPasswordMessage(""), PASSWORD_RESET_NEUTRAL);
  assert.match(forgotPasswordMessage("auth/invalid-email"), /valid email/i);
  assert.match(forgotPasswordMessage("auth/too-many-requests"), /Wait a few minutes/);
  assert.match(forgotPasswordMessage("empty"), /Enter the email/);
  assert.doesNotMatch(forgotPasswordMessage("auth/user-not-found") + forgotPasswordMessage("sent"), /not found|no account|doesn't exist/i);
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.match(app, /id="forgotpw"/);
  assert.match(app, /function renderForgot/);
  assert.match(app, /sendPasswordResetEmail\(auth, address\)/);
  const forgot = app.slice(app.indexOf("function renderLogin"), app.indexOf("function renderSignup"));
  assert.doesNotMatch(forgot, /prompt\(/);
  assert.match(forgot, /renderForgot/);
  assert.match(app, /resetPasswords: canSendPasswordReset\(me\)/);
  assert.match(app, /adminSendPasswordReset/);
  assert.match(app, /Reset link emailed to /);
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.match(index, /export const adminSendPasswordReset = onCall/);
  assert.match(index, /generatePasswordResetLink/);
  assert.match(index, /return \{ ok: true \}/);
  const handler = index.slice(index.indexOf("export const adminSendPasswordReset"), index.indexOf("export const inviteEmailWorker"));
  assert.doesNotMatch(handler, /return \{[^}]*link/);
  const rules = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const prod = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/passwordResetRate\/\{uid\} \{\s*allow read, write: if false;/);
  assert.match(prod, /match \/passwordResetRate\/\{uid\} \{\s*allow read, write: if false;/);
});
