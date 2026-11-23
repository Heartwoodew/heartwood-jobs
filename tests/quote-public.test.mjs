import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptCustomerQuote, canSendQuote, newPublicToken, planQuoteEmail, publicQuoteHtml, publicQuoteUrl, tokenOk,
} from "../app/features/quote-public.js";

const company = { name: "Bright Cleans", legalName: "Bright Cleans Pty Ltd", abn: "11 222 333 444", phone: "0400 000 111", email: "office@bright.test", logoUrl: "https://example.com/logo.png" };
const quote = {
  client: "Orbit", address: "9 Lease St", description: "End of lease clean",
  lines: [{ name: "End-of-lease clean", amount: 380 }], totalEx: 380, gst: 38, totalInc: 418,
};

test("the link token is long and not sequential", () => {
  const a = newPublicToken();
  const b = newPublicToken();
  assert.equal(tokenOk(a), true);
  assert.notEqual(a, b);
  assert.ok(a.length >= 42);
  assert.equal(publicQuoteUrl("https://app.callupapp.com.au", a), `https://app.callupapp.com.au/q/${a}`);
});

test("send is admin only and uses the callupapp sender", () => {
  assert.equal(canSendQuote("admin"), true);
  assert.equal(canSendQuote("supervisor"), false);
  assert.equal(canSendQuote("manager"), false);
  const held = planQuoteEmail({ company, quote, to: "someone@example.com", token: newPublicToken(), env: {}, allowLiveMail: false });
  assert.equal(held.ok, true);
  assert.equal(held.held, true);
  assert.match(held.message.from, /noreply@callupapp.com.au/);
  assert.match(held.message.text, /Bright Cleans/);
  assert.doesNotMatch(held.message.text, /Heartwood/);
  const live = planQuoteEmail({
    company, quote, to: "callup932+quote@gmail.com", token: newPublicToken(),
    env: { INVITE_EMAIL_ENABLED: "true", INVITE_EMAIL_ALLOW_TO: "callup932+" }, allowLiveMail: true,
  });
  assert.equal(live.held, false);
  const blocked = planQuoteEmail({
    company, quote, to: "customer@example.com", token: newPublicToken(),
    env: { INVITE_EMAIL_ENABLED: "true", INVITE_EMAIL_ALLOW_TO: "callup932+" }, allowLiveMail: true,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "allow-list");
});

test("the public page is read only, accepts a name, and has no decline or deposit", () => {
  const token = newPublicToken();
  const html = publicQuoteHtml({ company, quote, token });
  assert.match(html, /Bright Cleans Pty Ltd/);
  assert.match(html, /ABN 11 222 333 444/);
  assert.match(html, /End-of-lease clean/);
  assert.match(html, /\$380\.00/);
  assert.match(html, />Accept</);
  assert.match(html, /no decline and no deposit/);
  assert.doesNotMatch(html, /<button[^>]*>\s*Decline|Pay now|deposit due/i);
  const accepted = acceptCustomerQuote({
    quote, name: "  Sam Lee  ", ip: "203.0.113.8", userAgent: "TestBrowser/1", now: "2026-11-23T01:00:00.000Z",
  });
  assert.equal(accepted.customerAccepted.name, "Sam Lee");
  assert.equal(accepted.customerAccepted.acceptedAt, "2026-11-23T01:00:00.000Z");
  assert.equal(accepted.customerAccepted.ip, "203.0.113.8");
  assert.equal(accepted.customerAccepted.userAgent, "TestBrowser/1");
  const again = acceptCustomerQuote({ quote: { ...quote, customerAccepted: accepted.customerAccepted }, name: "Other" });
  assert.equal(again.already, true);
  assert.equal(again.customerAccepted.name, "Sam Lee");
  const page = publicQuoteHtml({ company, quote, token, accepted: accepted.customerAccepted });
  assert.match(page, /Accepted by Sam Lee/);
  assert.doesNotMatch(page, /<form/);
});
