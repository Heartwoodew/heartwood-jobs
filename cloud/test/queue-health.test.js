import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PO_LOOKUP_AUTOMATIC, STALE_MIN, agoText, healthItems, healthLineHtml, hoursExportState, hubdocStale, poLookupState, toMs, xeroCheckState, xeroSendState,
} from "../../app/features/queue-health.js";

const NOW = Date.parse("2026-11-28T10:00:00Z");
const ago = min => new Date(NOW - min * 60000).toISOString();
const ts = min => ({ toMillis: () => NOW - min * 60000 });

test("toMs reads timestamps, ISO strings, numbers and nothing", () => {
  assert.equal(toMs(ts(0)), NOW);
  assert.equal(toMs({ toDate: () => new Date(NOW) }), NOW);
  assert.equal(toMs({ seconds: 10 }), 10000);
  assert.equal(toMs("2026-11-28T10:00:00Z"), NOW);
  assert.equal(toMs(null), null);
  assert.equal(toMs("garbage"), null);
  assert.equal(agoText(ts(5), NOW), "5 minutes ago");
  assert.equal(agoText(ts(3 * 60), NOW), "3 hours ago");
  assert.equal(agoText(ts(3 * 1440), NOW), "3 days ago");
});

test("hours export: waits, then admits it was never emailed, never says queued forever", () => {
  assert.equal(hoursExportState({ status: "queued", createdAt: ts(2) }, NOW).label, "Emailing now…");
  assert.equal(hoursExportState({ status: "queued", createdAt: null }, NOW).stalled, false);
  const stalled = hoursExportState({ status: "queued", createdAt: ts(STALE_MIN.hours + 1) }, NOW);
  assert.equal(stalled.stalled, true);
  assert.equal(stalled.label, "Not emailed yet");
  assert.match(stalled.hint, /Download the spreadsheet/);
  assert.equal(hoursExportState({ status: "sending", createdAt: ts(40) }, NOW).stalled, true);
  assert.equal(hoursExportState({ status: "failed", attempts: 2, createdAt: ts(10) }, NOW).label, "Send failed, trying again");
  assert.equal(hoursExportState({ status: "failed", attempts: 5, createdAt: ts(10) }, NOW).label, "Not emailed, gave up");
  const sent = hoursExportState({ status: "sent", sentAt: "2026-11-27T01:00:00Z", createdAt: ts(9999) }, NOW);
  assert.equal(sent.stalled, false);
  assert.equal(sent.label, "Emailed 27/11/2026");
  assert.doesNotMatch(JSON.stringify([stalled, sent]), /box|within ~15|Heartwood|ServiceM8/i);
});

test("Xero and Find PO waits turn into do-it-by-hand states", () => {
  assert.equal(xeroSendState({ xeroStatus: "draft" }, NOW), null);
  assert.equal(xeroSendState({ xeroStatus: "queued", xeroQueuedAt: ts(5) }, NOW).stalled, false);
  assert.equal(xeroSendState({ xeroStatus: "queued", xeroQueuedAt: ts(45) }, NOW).label, "Not sent to Xero yet");
  assert.equal(xeroCheckState({ xeroCheckPending: true, xeroCheckQueuedAt: ts(45) }, NOW).stalled, true);
  assert.equal(xeroCheckState({}, NOW), null);
  assert.equal(PO_LOOKUP_AUTOMATIC, false);
  assert.equal(poLookupState({ poLookupStatus: "pending", poLookupAt: ago(1) }, NOW).stalled, true);
  assert.equal(poLookupState({ poLookupStatus: "found" }, NOW), null);
  assert.equal(hubdocStale({ hubdocStatus: "queued", paidAt: ts(2000) }, NOW), true);
  assert.equal(hubdocStale({ hubdocStatus: "queued", paidAt: ts(60) }, NOW), false);
  assert.equal(hubdocStale({ hubdocStatus: "sent", paidAt: ts(99999) }, NOW), false);
});

test("health strip: only stalled items, Heartwood-only items only when allowed", () => {
  const exports = [{ status: "queued", createdAt: ts(120) }, { status: "sent", createdAt: ts(120) }, { status: "queued", createdAt: ts(1) }];
  const jobs = [{ xeroStatus: "queued", xeroQueuedAt: ts(90) }, { xeroCheckPending: true, xeroCheckQueuedAt: ts(90) }, { poLookupStatus: "pending", poLookupAt: ago(30) }];
  const other = healthItems({ exports, jobs, now: NOW });
  assert.deepEqual(other.map(i => i.id), ["hours"]);
  assert.doesNotMatch(JSON.stringify(other), /Xero|PO|Heartwood|ServiceM8|box/i);
  const hw = healthItems({ exports, jobs, xero: true, po: true, now: NOW });
  assert.deepEqual(hw.map(i => i.id), ["hours", "xero", "xerocheck", "po"]);
  assert.deepEqual(healthItems({ exports: [{ status: "sent" }], now: NOW }), []);
  assert.equal(healthLineHtml([]), "");
  assert.match(healthLineHtml(other, s => String(s).replace(/</g, "&lt;")), /class="healthline"[^>]*>.*Needs doing by hand.*data-health="hours"/);
});

test("app wiring: no 'waiting for the box' wording, no ServiceM8 text in the new strip, shell and SW version", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /waiting for the box|the box checks every|the box runs it|emails within ~15 min|The box sends them/);
  assert.match(sw, /const VERSION = "callup-shell-v166-hours-mail"/);
  assert.match(sw, /"features\/queue-health\.js"/);
  assert.match(app, /healthLineHtml\(/);
  assert.match(app, /hoursExportState\(/);
  assert.match(app, /PO_LOOKUP_AUTOMATIC/);
});
