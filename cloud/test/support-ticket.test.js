// Support tickets: form, mail plan, push plan. No network. No production data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pushTargetFromUrl } from "../../app/features/push-logic.js";
import { pausedStaffHtml } from "../../app/features/company-ui.js";
import {
  SHELL_VERSION, masterTicketsHtml, newTicketId, prepareTicket, supportShotPath, ticketDialogHtml, ticketPage,
} from "../../app/features/support-ticket.js";
import {
  DEFAULT_SUPPORT_TICKET_EMAIL, deliverSupportTicket, notifyPatch, supportEmailMessage, supportMailGate,
  supportPushMessages, supportTicketRecipients,
} from "../functions/support-ticket.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("a ticket records the person, company and this service worker, and no prices", () => {
  const id = newTicketId(bytes => bytes.fill(7));
  assert.match(id, /^[A-Za-z0-9]{20}$/);
  const prepared = prepareTicket({
    id,
    subject: "  Pin missing\n",
    description: "Today's job has no map pin.",
    uid: "crew1",
    name: "Sam Crew",
    email: "sam@acme.test",
    staffRole: "labourer",
    role: "operator",
    companyId: "acme",
    companyName: "Acme Civil",
    userAgent: "TestAgent",
    page: ticketPage({ pathname: "/app/", search: "?x=1" }, "more"),
    file: { type: "image/png", size: 1200 },
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.doc.subject, "Pin missing");
  assert.equal(prepared.doc.role, "labourer");
  assert.equal(prepared.doc.status, "open");
  assert.equal(prepared.doc.appVersion, SHELL_VERSION);
  assert.equal(prepared.doc.swVersion, SHELL_VERSION);
  assert.equal(prepared.doc.page, "/app/?x=1 more");
  assert.equal(prepared.screenshotPath, supportShotPath("acme", "crew1", id));
  assert.equal(prepared.doc.screenshotPath, prepared.screenshotPath);
  for (const key of ["poAmount", "quoteAmount", "invoiceAmount", "price", "rate"]) {
    assert.equal(Object.hasOwn(prepared.doc, key), false);
  }
  assert.equal(prepareTicket({ id, subject: "", description: "x", uid: "crew1", companyId: "acme" }).reason, "subject");
  assert.equal(prepareTicket({ id, subject: "x", description: "", uid: "crew1", companyId: "acme" }).reason, "description");
  assert.equal(prepareTicket({ id, subject: "x", description: "y", uid: "crew1", companyId: "acme", file: { type: "application/pdf", size: 10 } }).reason, "type");
});

test("the raise-ticket form is on Help, More, settings and the header, and crew copy has no prices", () => {
  const dialog = ticketDialogHtml();
  assert.match(dialog, /id="ticketform"/);
  assert.match(dialog, /name="subject"/);
  assert.match(dialog, /name="description"/);
  assert.match(dialog, /name="shot"/);
  assert.doesNotMatch(dialog, /\$|price|quote rate|poAmount|invoiceAmount/i);
  const list = masterTicketsHtml([
    { id: "bbbbbbbbbbbbbbbbbbbb", subject: "Older", description: "Second", status: "open", createdAt: "2026-11-01T00:00:00Z", companyId: "acme", companyName: "Acme" },
    { id: "aaaaaaaaaaaaaaaaaaaa", subject: "Newer", description: "First", status: "closed", createdAt: "2026-11-02T00:00:00Z", screenshotPath: "supportTickets/acme/crew1/aaaaaaaaaaaaaaaaaaaa/shot.jpg", companyId: "acme" },
  ], { focusId: "aaaaaaaaaaaaaaaaaaaa" });
  assert.ok(list.indexOf("Newer") < list.indexOf("Older"));
  assert.match(list, /Close ticket/);
  assert.match(list, /Reopen ticket/);
  assert.match(list, /data-ticket-shot="supportTickets\/acme\/crew1\/aaaaaaaaaaaaaaaaaaaa\/shot.jpg"/);
  assert.match(list, /ticket-focus/);
  assert.doesNotMatch(list, /\$|poAmount|quoteAmount|invoiceAmount/);
  const staff = pausedStaffHtml();
  assert.match(staff, /data-raise-ticket/);
  assert.doesNotMatch(staff, /A\$20|A\$50|poAmount/);
  const app = read("../../app/app.js");
  assert.match(app, /data-raise-ticket/);
  assert.match(app, /Tell CallUp support what went wrong/);
  assert.match(app, /Anyone signed in can raise a ticket/);
  assert.match(app, /supportTickets/);
  const html = read("../../app/index.html");
  assert.match(html, /id="ticketbtn"/);
  const sw = read("../../app/sw.js");
  assert.match(sw, /callup-shell-v164/);
  assert.match(sw, /features\/support-ticket\.js/);
  assert.equal(SHELL_VERSION, "callup-shell-v164");
  assert.equal(pushTargetFromUrl("https://app.callupapp.com.au/app/?ticket=aaaaaaaaaaaaaaaaaaaa").kind, "ticket");
  assert.equal(pushTargetFromUrl("https://app.callupapp.com.au/app/?ticket=short"), null);
});

test("SUPPORT_TICKET_EMAIL is a comma-separated list and defaults to the CallUp admin inbox", () => {
  assert.equal(DEFAULT_SUPPORT_TICKET_EMAIL, "admin@callupapp.com.au");
  assert.deepEqual(supportTicketRecipients({}), ["admin@callupapp.com.au"]);
  assert.deepEqual(supportTicketRecipients({ SUPPORT_TICKET_EMAIL: "  " }), ["admin@callupapp.com.au"]);
  assert.equal(supportTicketRecipients({}).includes("alex@heartwoodew.com"), false);
  assert.deepEqual(
    supportTicketRecipients({ SUPPORT_TICKET_EMAIL: " callup932+one@example.com, callup932+two@example.com, not-an-email, callup932+one@example.com " }),
    ["callup932+one@example.com", "callup932+two@example.com"],
  );
});

test("live mail stays off for the kill switch, the allow list and a TEST company", async () => {
  const ticket = {
    id: "aaaaaaaaaaaaaaaaaaaa",
    subject: "Pin missing",
    description: "No pin on the job.",
    uid: "crew1",
    name: "Sam",
    email: "sam@acme.test",
    role: "labourer",
    companyId: "acme",
    companyName: "Acme",
    appVersion: SHELL_VERSION,
    swVersion: SHELL_VERSION,
    userAgent: "Test",
    page: "/app/ more",
    screenshotPath: "supportTickets/acme/crew1/aaaaaaaaaaaaaaaaaaaa/shot.jpg",
  };
  const live = { INVITE_EMAIL_ENABLED: "true", INVITE_EMAIL_ALLOW_TO: "callup932+" };
  assert.equal(supportMailGate(supportTicketRecipients({}), live, { allowLiveMail: true }).reason, "allow-list");
  assert.equal(supportMailGate(["callup932+ticket@example.com"], { INVITE_EMAIL_ENABLED: "false" }, { allowLiveMail: true }).reason, "email-disabled");
  assert.equal(supportMailGate(["callup932+ticket@example.com"], live, { allowLiveMail: false }).reason, "email-disabled");
  assert.equal(supportMailGate(["callup932+ticket@example.com"], live, { allowLiveMail: true, isTest: true }).reason, "test-company");
  const sent = [];
  const pushed = [];
  const held = await deliverSupportTicket(ticket, {
    company: { isTest: true, name: "Yard demo" },
    tokens: [{ id: "tok1", token: "fcm-" + "x".repeat(40), origin: "https://app.callupapp.com.au" }],
    env: { ...live, SUPPORT_TICKET_EMAIL: "callup932+ticket@example.com", NODE_TEST_CONTEXT: "child" },
    allowLiveMail: true,
    sendResend: async payload => { sent.push(payload); return { ok: true, id: "re_test" }; },
    sendEach: async messages => { pushed.push(messages); return { responses: messages.map(() => ({ success: true })) }; },
    signScreenshot: async () => "https://storage.example/shot",
    now: () => "2026-11-23T00:00:00.000Z",
  });
  assert.equal(held.emailReason, "test-company");
  assert.equal(sent.length, 0);
  assert.equal(held.pushReason, "sent");
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0][0].data.kind, "support");
  assert.match(pushed[0][0].data.url, /ticket=aaaaaaaaaaaaaaaaaaaa/);
  assert.doesNotMatch(JSON.stringify(pushed[0]), /poAmount|quoteAmount|invoiceAmount/);
  await assert.rejects(() => deliverSupportTicket(ticket, {
    company: { isTest: false },
    env: { INVITE_EMAIL_ENABLED: "true", NODE_TEST_CONTEXT: "child" },
    allowLiveMail: true,
    sendResend: async () => ({ ok: true }),
  }), /callup932/);
  const payloads = [];
  const dropped = [];
  const ok = await deliverSupportTicket(ticket, {
    company: { isTest: false },
    tokens: [
      { id: "good", token: "fcm-" + "y".repeat(40), origin: "https://jobs.heartwoodew.com" },
      { id: "dead", token: "fcm-" + "z".repeat(40), origin: "https://app.callupapp.com.au" },
    ],
    env: { ...live, SUPPORT_TICKET_EMAIL: "callup932+a@example.com, callup932+b@example.com", NODE_TEST_CONTEXT: "child" },
    allowLiveMail: true,
    sendResend: async payload => { payloads.push(payload); return { ok: true, id: "re_ok" }; },
    sendEach: async () => ({ responses: [{ success: true }, { success: false, error: { code: "messaging/registration-token-not-registered" } }] }),
    deleteToken: async target => { dropped.push(target.tokenId); },
    signScreenshot: async () => "https://storage.example/private-shot",
    now: () => "2026-11-23T01:00:00.000Z",
  });
  assert.equal(ok.emailReason, "sent");
  assert.deepEqual(ok.sent, ["callup932+a@example.com", "callup932+b@example.com"]);
  assert.deepEqual(payloads[0].to, ["callup932+a@example.com", "callup932+b@example.com"]);
  assert.doesNotMatch(payloads[0].text, /admin@callupapp.com.au|alex@heartwoodew.com/);
  assert.match(payloads[0].text, /Pin missing/);
  assert.match(payloads[0].text, /No pin on the job/);
  assert.match(payloads[0].text, /Acme/);
  assert.match(payloads[0].text, /https:\/\/app\.callupapp\.com\.au\/app\/\?ticket=aaaaaaaaaaaaaaaaaaaa/);
  assert.match(payloads[0].text, /https:\/\/storage\.example\/private-shot/);
  assert.equal(dropped[0], "dead");
  assert.deepEqual(notifyPatch(ok), { email: "sent", push: "sent", at: "2026-11-23T01:00:00.000Z" });
  const quiet = supportPushMessages([], ticket);
  assert.equal(quiet.length, 0);
  const note = supportEmailMessage(ticket, { to: ["callup932+a@example.com"] });
  assert.doesNotMatch(note.payload.text, /poAmount|quoteAmount|\$\d/);
  const index = read("../functions/index.js");
  assert.match(index, /supportTicketCreated/);
  assert.match(index, /SUPPORT_TICKET_EMAIL/);
  assert.match(index, /NODE_TEST_CONTEXT/);
  const rules = read("../firestore.production.rules");
  assert.match(rules, /match \/supportTickets\/\{ticketId\}/);
  assert.match(rules, /platformOwner\(\) \|\| ticketOwn\(\)/);
  const block = rules.slice(rules.indexOf("match /supportTickets/"), rules.indexOf("match /{document=**}"));
  assert.doesNotMatch(block, /poAmount|invoiceAmount|quoteAmount/);
  const storage = read("../production/storage.rules");
  const emu = read("../emulator/storage.rules");
  assert.equal(storage, emu);
  assert.match(storage, /match \/supportTickets\/\{companyId\}\/\{uid\}\/\{ticketId\}\/\{file\}/);
  assert.match(storage, /storagePlatformOwner\(\)/);
});
