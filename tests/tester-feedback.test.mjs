// Tester feedback, 12 Nov 2026: decimal hours, invite email status, no ServiceM8 wording for CallUp companies, no prices for crew.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHoursInput } from "../app/features/job-window.js";
import { inviteEmailLine, staffViewHtml } from "../app/features/staff-invites.js";
import { noDollars } from "../app/features/quotes.js";

const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const quotes = readFileSync(new URL("../app/features/quotes.js", import.meta.url), "utf8");

test("hours: 7.6 and other decimals are accepted and saved as typed", () => {
  assert.equal(parseHoursInput("7.6"), 7.6);
  assert.equal(parseHoursInput(" 7,6 "), 7.6);
  assert.equal(parseHoursInput("0.1"), 0.1);
  assert.equal(parseHoursInput("8"), 8);
  assert.equal(parseHoursInput("7.666"), 7.67);
  assert.equal(parseHoursInput(""), null);
  assert.equal(parseHoursInput("-1"), null);
  assert.equal(parseHoursInput("abc"), null);
  assert.equal(parseHoursInput("1000"), null);
});

test("hours inputs use step any (7.6 is not rejected by the browser)", () => {
  assert.match(app, /<label>Hours<input type="number" step="any" min="0" max="999" inputmode="decimal" name="durationHrs"/);
  assert.match(app, /durationHrs: parseHoursInput\(f\.durationHrs\.value\)/);
  assert.match(quotes, /name="hoursOnSite" type="number" min="0" step="any"/);
  assert.doesNotMatch(app, /name="durationHrs"[^>]*step="0\.5"/);
  assert.doesNotMatch(quotes, /name="hoursOnSite"[^>]*step="0\.25"/);
});

test("invite email line: sent, held, failed and still checking", () => {
  assert.match(inviteEmailLine({ delivery: "sent" }), /email sent/i);
  assert.match(inviteEmailLine({ delivery: "held", reason: "recipient-not-allowed" }), /Not emailed\. Copy the link/);
  assert.match(inviteEmailLine({ delivery: "failed", reason: "resend-422" }), /didn't go through/);
  assert.match(inviteEmailLine({ delivery: "error" }), /didn't go through/);
  assert.match(inviteEmailLine({ delivery: "received" }), /Sending/);
  assert.match(inviteEmailLine(null), /Checking/);
});

test("staff view shows the email line for pending CallUp invites only, and never the reason code", () => {
  const now = new Date("2026-11-12T05:00:00Z");
  const exp = new Date("2026-11-19T05:00:00Z");
  const invites = [
    { id: "a", name: "Sam", email: "sam@example.com", role: "operator", status: "pending", token: "t".repeat(32), expiresAt: exp },
    { id: "b", name: "Jo", email: "jo@example.com", role: "operator", status: "accepted", token: "u".repeat(32), expiresAt: exp },
  ];
  const html = staffViewHtml(invites, { now, origin: "https://app.callupapp.com.au", emailStatus: { a: { delivery: "held", reason: "recipient-not-allowed" } } });
  assert.match(html, /data-invite-mail="held"/);
  assert.match(html, /Not emailed/);
  assert.doesNotMatch(html, /recipient-not-allowed/);
  assert.equal((html.match(/data-invite-mail=/g) || []).length, 1);
  const heartwood = staffViewHtml(invites, { now });
  assert.doesNotMatch(heartwood, /invite-mail/);
});

test("invite toasts no longer say mail was not sent for CallUp companies", () => {
  assert.match(app, /toast\(inviteMailShown\(\) \? "Invite saved\. The list shows whether it was emailed\." : "Invite saved\. Copy the link\. Mail was not sent\."\)/);
  assert.match(app, /getDoc\(doc\(db, "inviteStatus", r\.id\)\)/);
  assert.match(app, /emailStatus: inviteMailMap\(\)/);
});

test("no ServiceM8 wording for anyone, Heartwood included (12 Nov 2026); field names unchanged", () => {
  assert.match(app, /const usesSm8Sync = \(\) => myCompanyId\(\) === "heartwood";/);
  // Full string scan of shipped code: cloud/test/brand-text.test.js. Here: no non-comment line names ServiceM8.
  const lines = app.split("\n").filter(l => /ServiceM8/.test(l) && !/^\s*\/\//.test(l) && !/\/\/ Firestore only; nothing goes to ServiceM8/.test(l));
  assert.deepEqual(lines.map(l => l.trim().slice(0, 120)), []);
  assert.match(app, /j\.sm8JobNo/);
});

test("crew job text drops prices; office text is unchanged", () => {
  assert.match(app, /const crewText = t => canSeeMoney\(\) \? String\(t \?\? ""\) : noDollars\(t\);/);
  assert.match(app, /<dd>\$\{esc\(crewText\(j\.description\) \|\| "—"\)\}<\/dd>/);
  assert.match(app, /mdc-desc">\$\{esc\(firstLine\(crewText\(j\.description\)\)\)\}/);
  assert.equal(noDollars("Spoil removal $1,250.00 ex GST, 6 loads"), "Spoil removal [price removed], 6 loads");
});
