import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveMembership } from "../../app/features/cloud-storage.js";
import {
  CALLUP_BASE,
} from "../../app/features/cloud-storage.js";
import {
  acceptScreenModel, acceptStaffInvite, acceptViewHtml, buildInviteDraft, buildInviteEmail,
  canManageInvites, displayStatus, inviteEmailConfig, inviteLink, newInviteToken, pendingInviteForEmail,
  planInviteDelivery, previewStaffInvite, profileFromInvite, queueInviteEmail, shouldQueueInviteEmail,
  staffViewHtml, tokenOk,
} from "../../app/features/staff-invites.js";

const NOW = new Date("2026-11-08T02:00:00.000Z");
const TOKEN = "a".repeat(43);
const SUPER_TOKEN = "b".repeat(43);

function draft(extra = {}) {
  return buildInviteDraft({
    name: "Casey Nguyen",
    email: "Casey.Nguyen@Example.com",
    role: "operator",
    createdBy: "admin-1",
    now: NOW,
    token: TOKEN,
    tenantId: "heartwood",
    ...extra,
  });
}

function memory(seed = []) {
  const invites = new Map(seed.map(row => [row.id, { ...row }]));
  const users = new Map();
  const profiles = new Map();
  const calls = { createUser: [], setProfile: [], deleted: [] };
  return {
    calls,
    invites,
    profiles,
    deps: {
      now: () => NOW,
      async findByToken(token) {
        return [...invites.values()].filter(row => row.token === token);
      },
      async getUserByEmail(email) {
        const uid = users.get(email);
        return uid ? { uid, email } : null;
      },
      async createUser({ email, password, displayName }) {
        calls.createUser.push({ email, password, displayName });
        const uid = "uid-" + users.size;
        users.set(email, uid);
        return { uid };
      },
      async deleteUser(uid) {
        calls.deleted.push(uid);
        for (const [email, id] of users) if (id === uid) users.delete(email);
      },
      async setProfile(uid, profile) {
        calls.setProfile.push({ uid, profile });
        profiles.set(uid, { ...profile });
      },
      async deleteProfile(uid) {
        profiles.delete(uid);
      },
      async getInviter(uid) {
        return { uid, profile: { role: "supervisor", name: "Sue" } };
      },
      async claimInvite(id, uid) {
        const row = invites.get(id);
        if (!row || displayStatus(row, NOW) !== "pending") return { ok: false, reason: displayStatus(row, NOW) };
        row.status = "accepted";
        row.acceptedUid = uid;
        return { ok: true };
      },
    },
  };
}

test("CallUp Base includes staff invites and still has no Xero", () => {
  assert.equal(CALLUP_BASE.staffInvites, true);
  assert.equal(CALLUP_BASE.staffPermissions, true);
  assert.equal(CALLUP_BASE.xero, false);
  assert.equal(CALLUP_BASE.invoicing, false);
  assert.equal(CALLUP_BASE.plan, "callup");
});

test("supervisors and admins can manage invites; operators cannot", () => {
  const admin = resolveMembership({ uid: "1JKLsoxkQNfkphBBO0vDz2ziEyj2", profile: null });
  const patrick = resolveMembership({ uid: "R7t41e54Ykcdk9WPdVZnDd697iI2", profile: { role: "operator", name: "Patrick" } });
  const supervisor = resolveMembership({ uid: "sup1", profile: { role: "supervisor", name: "Sue" } });
  const operator = resolveMembership({ uid: "op1", profile: { role: "operator", name: "Sam" } });
  assert.equal(canManageInvites(admin), true);
  assert.equal(canManageInvites(patrick), true);
  assert.equal(canManageInvites(supervisor), true);
  assert.equal(canManageInvites(operator), false);
});

test("draft lowercases email, expires in 7 days, and rejects admin", () => {
  const ok = draft();
  assert.equal(ok.ok, true);
  assert.equal(ok.invite.email, "casey.nguyen@example.com");
  assert.equal(ok.invite.status, "pending");
  assert.equal(ok.invite.role, "operator");
  assert.equal(ok.invite.expiresAt.getTime() - NOW.getTime(), 7 * 24 * 60 * 60 * 1000);
  assert.equal(draft({ role: "admin" }).reason, "role");
  assert.equal(draft({ role: "owner" }).reason, "role");
  assert.equal(draft({ email: "not-an-email" }).reason, "email");
  assert.equal(draft({ name: "Casey\nNguyen" }).reason, "name");
  assert.equal(draft({ token: "short" }).reason, "token");
  assert.equal(tokenOk(newInviteToken(bytes => bytes.fill(7))), true);
});

test("pending blocks a second invite for that email until it is no longer pending", () => {
  const email = "casey.nguyen@example.com";
  const pending = { id: "i1", email, status: "pending", expiresAt: "2026-11-01T00:00:00.000Z" };
  assert.equal(pendingInviteForEmail([pending], "Casey.Nguyen@Example.com").id, "i1");
  assert.equal(displayStatus(pending, NOW), "expired");
  assert.equal(pendingInviteForEmail([{ ...pending, status: "cancelled" }], email), null);
  assert.equal(pendingInviteForEmail([{ ...pending, status: "accepted" }], email), null);
});

test("profile role is the invited role and heartwood omits tenantId", () => {
  const operator = profileFromInvite(draft().invite);
  assert.deepEqual(operator, { name: "Casey Nguyen", role: "operator", email: "casey.nguyen@example.com" });
  const supervisor = profileFromInvite({ ...draft({ role: "supervisor", token: SUPER_TOKEN }).invite });
  assert.equal(supervisor.role, "supervisor");
  const other = profileFromInvite({ ...draft({ tenantId: "otherco" }).invite });
  assert.equal(other.tenantId, "otherco");
  assert.equal(profileFromInvite({ ...draft().invite, role: "admin" }), null);
});

test("an operator cannot be the inviter, and a requested admin role is ignored", async () => {
  const store = memory([{ id: "i1", ...draft().invite }]);
  store.deps.getInviter = async () => ({ uid: "op1", profile: { role: "operator", name: "Sam" } });
  const denied = await acceptStaffInvite({ token: TOKEN, password: "choose-a-password", role: "admin" }, store.deps);
  assert.equal(denied.reason, "invalid");
  assert.equal(store.calls.createUser.length, 0);
  store.deps.getInviter = async () => ({ uid: "1JKLsoxkQNfkphBBO0vDz2ziEyj2", profile: null });
  const allowed = await acceptStaffInvite({ token: TOKEN, password: "choose-a-password", role: "admin" }, store.deps);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.role, "operator");
});

test("accept ignores a requested admin role and creates the invited profile", async () => {
  const store = memory([{ id: "i1", ...draft().invite }]);
  const result = await acceptStaffInvite({
    token: TOKEN, password: "choose-a-password", role: "admin", name: "Hacker", email: "other@example.com",
  }, store.deps);
  assert.equal(result.ok, true);
  assert.equal(result.role, "operator");
  assert.equal(store.calls.createUser[0].email, "casey.nguyen@example.com");
  assert.equal(store.calls.createUser[0].displayName, "Casey Nguyen");
  assert.deepEqual(store.calls.setProfile[0].profile, {
    name: "Casey Nguyen", role: "operator", email: "casey.nguyen@example.com",
  });
  assert.equal(store.invites.get("i1").status, "accepted");
  assert.equal(store.profiles.get(result.uid).role, "operator");
});

test("accept can create a supervisor and will not take over an existing login", async () => {
  const invite = draft({ role: "supervisor", token: SUPER_TOKEN, email: "sue@example.com" }).invite;
  const store = memory([{ id: "i2", ...invite }]);
  const created = await acceptStaffInvite({ token: SUPER_TOKEN, password: "supervisor-pass" }, store.deps);
  assert.equal(created.role, "supervisor");
  const again = await acceptStaffInvite({ token: SUPER_TOKEN, password: "supervisor-pass" }, store.deps);
  assert.equal(again.reason, "accepted");
  store.invites.get("i2").status = "pending";
  const taken = await acceptStaffInvite({ token: SUPER_TOKEN, password: "supervisor-pass" }, store.deps);
  assert.equal(taken.reason, "email-in-use");
  assert.equal(store.calls.setProfile.length, 1);
  assert.equal(store.profiles.get(created.uid).role, "supervisor");
});

test("accept rejects weak passwords, expired invites, and a failed claim", async () => {
  const invite = draft().invite;
  const store = memory([{ id: "i1", ...invite }]);
  const weak = await acceptStaffInvite({ token: TOKEN, password: "short" }, store.deps);
  assert.equal(weak.reason, "weak-password");
  assert.equal(store.calls.createUser.length, 0);
  store.invites.get("i1").expiresAt = new Date("2026-11-01T00:00:00.000Z");
  const expired = await acceptStaffInvite({ token: TOKEN, password: "long-enough" }, store.deps);
  assert.equal(expired.reason, "expired");
  assert.equal(store.calls.createUser.length, 0);
  store.invites.get("i1").expiresAt = invite.expiresAt;
  store.deps.claimInvite = async () => ({ ok: false, reason: "expired" });
  const rolled = await acceptStaffInvite({ token: TOKEN, password: "long-enough" }, store.deps);
  assert.equal(rolled.reason, "expired");
  assert.equal(store.profiles.size, 0);
  assert.deepEqual(store.calls.deleted, ["uid-0"]);
});

test("preview does not return the token and will not offer an admin role", async () => {
  const store = memory([{ id: "i1", ...draft().invite }]);
  const preview = await previewStaffInvite({ token: TOKEN }, store.deps);
  assert.equal(preview.ok, true);
  assert.equal(preview.role, "operator");
  assert.equal(preview.token, undefined);
  assert.equal("password" in preview, false);
  const bad = memory([{ id: "i9", ...draft().invite, role: "admin" }]);
  assert.equal((await previewStaffInvite({ token: TOKEN }, bad.deps)).reason, "invalid");
  const html = acceptViewHtml(acceptScreenModel(preview, NOW));
  assert.match(html, /Set your password/);
  assert.match(html, /Casey Nguyen/);
  assert.match(html, /Operator/);
  assert.doesNotMatch(html, /<select|value="admin"|name="role"/);
});

test("staff screen lists pending, accepted and expired with resend and cancel, and no admin role", () => {
  const html = staffViewHtml([
    { id: "p", name: "Casey Nguyen", email: "casey.nguyen@example.com", role: "operator", status: "pending", token: TOKEN, expiresAt: "2026-11-14T00:00:00.000Z" },
    { id: "a", name: "Sam Lee", email: "sam.lee@example.com", role: "supervisor", status: "accepted", token: SUPER_TOKEN, expiresAt: "2026-11-01T00:00:00.000Z" },
    { id: "e", name: "Riley Chen", email: "riley.chen@example.com", role: "operator", status: "pending", token: "c".repeat(43), expiresAt: "2026-11-01T00:00:00.000Z" },
  ], { now: NOW });
  assert.match(html, /Invite staff/);
  assert.match(html, /value="operator"/);
  assert.match(html, /value="supervisor"/);
  assert.doesNotMatch(html, /value="admin"/);
  assert.match(html, /data-invite-status="pending"/);
  assert.match(html, /data-invite-status="accepted"/);
  assert.match(html, /data-invite-status="expired"/);
  assert.match(html, /Resend/);
  assert.match(html, /Cancel/);
  assert.match(html, /jobs\.heartwoodew\.com\/app\?invite=/);
  assert.match(html, /Mail is not sent from this screen/);
  const accepted = html.slice(html.indexOf('data-invite-status="accepted"'));
  assert.doesNotMatch(accepted, /data-invite-resend|data-invite-cancel/);
});

test("email stays held unless explicitly enabled, and tests cannot queue a live send", async () => {
  const invite = draft().invite;
  const held = planInviteDelivery(invite, inviteEmailConfig({}));
  assert.equal(held.sent, false);
  assert.equal(held.collection, "inviteMail");
  assert.equal(held.doc.delivery, "held");
  assert.equal(held.doc.link, inviteLink(TOKEN));
  assert.match(buildInviteEmail(invite).text, /set your own password/);
  const queued = planInviteDelivery(invite, inviteEmailConfig({ INVITE_EMAIL_ENABLED: "true", INVITE_EMAIL_HEARTWOOD: "true", INVITE_EMAIL_PROVIDER: "extension", INVITE_EMAIL_FROM: "Heartwood <jobs@heartwoodew.com>" }));
  assert.equal(queued.sent, false);
  assert.equal(queued.collection, "mail");
  assert.equal(queued.doc.to, "casey.nguyen@example.com");
  assert.equal(queued.doc.message.subject, "You're invited to Heartwood Jobs");
  const writes = [];
  const blocked = await queueInviteEmail(invite, {
    env: { INVITE_EMAIL_ENABLED: "true", INVITE_EMAIL_HEARTWOOD: "true" },
    writeMail: (col, doc) => writes.push({ col, doc }),
  });
  assert.equal(blocked.reason, "live-mail-not-allowed");
  assert.deepEqual(writes, []);
  await assert.rejects(() => queueInviteEmail(invite, {
    env: { NODE_TEST_CONTEXT: "child", INVITE_EMAIL_ENABLED: "true" },
    allowLiveMail: true,
    writeMail: () => { throw new Error("should not write"); },
  }), /refusing live invite email under test/);
  const safe = await queueInviteEmail(invite, {
    env: {},
    writeMail: (col, doc) => writes.push({ col, doc }),
  });
  assert.equal(safe.collection, "inviteMail");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].doc.delivery, "held");
  assert.equal(shouldQueueInviteEmail(null, invite), true);
  assert.equal(shouldQueueInviteEmail(invite, { ...invite, status: "cancelled" }), false);
  assert.equal(shouldQueueInviteEmail(invite, { ...invite, role: "admin" }), false);
  assert.equal(shouldQueueInviteEmail(invite, { ...invite, token: "d".repeat(43) }), true);
});

test("invite rules fragment matches the emulator block and does not open mail", () => {
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const frag = readFileSync(new URL("../production/firestore.invites.rules", import.meta.url), "utf8");
  const slice = text => {
    const start = text.indexOf("// BEGIN INVITE RULES");
    const end = text.indexOf("// END INVITE RULES");
    assert.ok(start >= 0 && end > start);
    return text.slice(start, end + "// END INVITE RULES".length);
  };
  assert.equal(slice(emu), slice(frag));
  assert.match(slice(frag), /role == "operator" \|\| request\.resource\.data\.role == "supervisor"/);
  assert.match(slice(frag), /allow delete: if false/);
  assert.match(slice(frag), /match \/mail\/\{id\}/);
  assert.doesNotMatch(slice(frag), /match \/users\/|match \/jobs\/|match \/xeroQueue\//);
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.match(index, /previewStaffInvite/);
  assert.match(index, /acceptStaffInvite/);
  assert.match(index, /inviteEmailWorker/);
  assert.match(index, /NODE_TEST_CONTEXT/);
  assert.doesNotMatch(index, /onSchedule|nodemailer|smtp|createTransport/);
  assert.match(readFileSync(new URL("../MIGRATION.md", import.meta.url), "utf8"), /Staff invites/);
});
