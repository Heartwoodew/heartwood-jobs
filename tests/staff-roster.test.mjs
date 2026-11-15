import test from "node:test";
import assert from "node:assert/strict";
import { mergeStaffRoster, staffViewHtml } from "../app/features/staff-invites.js";

const NOW = new Date("2026-11-08T02:00:00.000Z");
const TOKEN = "a".repeat(43);

function invite(extra) {
  return {
    id: "inv",
    name: "Casey Nguyen",
    email: "casey.nguyen@example.com",
    role: "operator",
    status: "pending",
    token: TOKEN,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    expiresAt: new Date("2026-11-15T00:00:00.000Z"),
    tenantId: "heartwood",
    ...extra,
  };
}

test("merge keeps a login with no invite, and an invite with no login, each once", () => {
  const rows = mergeStaffRoster(
    [{ uid: "jordan", name: "Jordan Blake", email: "jordan.blake@example.com", role: "operator", jobTitle: "Excavator operator", skills: ["Excavator"], companyId: "heartwood" }],
    [invite(), invite({ id: "old", email: "riley.chen@example.com", name: "Riley Chen", expiresAt: new Date("2026-11-01T00:00:00.000Z") })],
    { now: NOW, companyId: "heartwood" },
  );
  assert.deepEqual(rows.map(r => r.status), ["pending", "expired", "active"]);
  assert.equal(rows.find(r => r.email === "casey.nguyen@example.com").status, "pending");
  assert.equal(rows.find(r => r.status === "pending").sentAt.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(rows.find(r => r.name === "Riley Chen").status, "expired");
  const jordan = rows.find(r => r.uid === "jordan");
  assert.equal(jordan.status, "active");
  assert.equal(jordan.jobTitle, "Excavator operator");
  assert.deepEqual(jordan.tags, ["Excavator"]);
  assert.equal(jordan.inviteId, "");
  assert.equal(jordan.token, "");
});

test("the same person is one row when uid or email matches, ignoring email case", () => {
  const rows = mergeStaffRoster(
    [
      { uid: "sam", name: "Sam Lee", email: "sam.lee@example.com", role: "supervisor", jobTitle: "Supervisor", skills: ["White card"], companyId: "heartwood", hourlyRate: "$65" },
      { uid: "pat", name: "Pat", email: "pat@heartwood.test", role: "manager", jobTitle: "Operations manager", companyId: "heartwood" },
    ],
    [
      invite({ id: "acc", name: "Sam", email: "SAM.LEE@example.com", role: "operator", status: "accepted", acceptedUid: "sam", jobTitle: "Old title", token: "b".repeat(43) }),
      invite({ id: "pat-mail", name: "Patrick", email: "other.pat@heartwood.test", role: "operator", status: "accepted", acceptedUid: "pat" }),
      invite({ id: "open", name: "Sam Lee", email: "sam.lee@example.com", status: "pending", role: "labourer" }),
    ],
    { now: NOW, companyId: "heartwood" },
  );
  assert.equal(rows.length, 2);
  const sam = rows.find(r => r.uid === "sam");
  assert.equal(sam.status, "active");
  assert.equal(sam.role, "supervisor");
  assert.equal(sam.jobTitle, "Supervisor");
  assert.deepEqual(sam.tags, ["White card"]);
  assert.equal(sam.email, "sam.lee@example.com");
  assert.equal(sam.inviteId, "");
  assert.equal(sam.token, "");
  assert.equal(rows.find(r => r.uid === "pat").status, "active");
  assert.equal(rows.find(r => r.uid === "pat").jobTitle, "Operations manager");
});

test("a resent invite shows the resend date, and a second invite for that email is not a second person", () => {
  const rows = mergeStaffRoster([], [
    invite({ id: "first", createdAt: new Date("2026-10-01T00:00:00.000Z") }),
    invite({ id: "again", createdAt: new Date("2026-10-01T00:00:00.000Z"), resentAt: new Date("2026-11-06T00:00:00.000Z"), token: "c".repeat(43) }),
  ], { now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].inviteId, "again");
  assert.equal(rows[0].sentAt.toISOString(), "2026-11-06T00:00:00.000Z");
});

test("cancelled invites are left out, sent and stored-expired invites stay, other companies stay out", () => {
  const rows = mergeStaffRoster(
    [
      { uid: "legacy", name: "Lee", role: "labourer" },
      { uid: "bo", name: "Bo", email: "bo@bravo.test", role: "operator", companyId: "bravo" },
    ],
    [
      invite({ id: "gone", status: "cancelled" }),
      invite({ id: "mailed", status: "sent", email: "mailed@example.com", name: "Mailed" }),
      invite({ id: "lapsed", status: "expired", email: "lapsed@example.com", name: "Lapsed" }),
      invite({ id: "bravo", email: "bo@bravo.test", companyId: "bravo", tenantId: "bravo", name: "Bo" }),
    ],
    { now: NOW, companyId: "heartwood" },
  );
  assert.deepEqual(rows.map(r => r.name).sort(), ["Lapsed", "Lee", "Mailed"]);
  assert.equal(rows.find(r => r.name === "Lee").status, "active");
  assert.equal(rows.find(r => r.name === "Mailed").status, "pending");
  assert.equal(rows.find(r => r.name === "Lapsed").status, "expired");
  assert.equal(rows.some(r => r.email === "bo@bravo.test"), false);
});

test("the staff screen shows status, sent date and details, and does not show rates or invite actions for someone who already has a login", () => {
  const html = staffViewHtml([
    invite({ id: "p", jobTitle: "Operator" }),
    invite({ id: "acc", name: "Sam Lee", email: "sam.lee@example.com", status: "accepted", acceptedUid: "sam", role: "supervisor" }),
    invite({ id: "e", name: "Riley Chen", email: "riley.chen@example.com", expiresAt: new Date("2026-11-01T00:00:00.000Z") }),
  ], {
    now: NOW,
    companyId: "heartwood",
    logins: [{
      uid: "sam", name: "Sam Lee", email: "sam.lee@example.com", role: "supervisor",
      jobTitle: "Supervisor", skills: ["White card"], hourlyRate: "$65", poAmount: 900,
    }],
  });
  assert.match(html, /Invite pending · sent 1 Nov 2026/);
  assert.match(html, /data-staff-status="active"/);
  assert.match(html, /White card/);
  assert.match(html, /Supervisor/);
  assert.match(html, /data-invite-resend="p"/);
  assert.match(html, /data-invite-cancel="e"/);
  const active = html.slice(html.indexOf('data-staff-status="active"'));
  assert.match(active, /Sam Lee/);
  assert.doesNotMatch(active, /data-invite-resend|data-invite-cancel|invite=/);
  assert.doesNotMatch(html, /hourlyRate|\$65|poAmount|900/);
  assert.equal(html.match(/data-staff-email="sam.lee@example.com"/g).length, 1);
});
