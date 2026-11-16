// Selection logic for paused-company deletion. No emulator, no Stripe, no email send.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PAUSE_GRACE_DAYS, authUserDeletable, backupObjectPath, pauseDeleteIsDryRun, pauseRetentionPlan,
  pauseWarningMail, retentionEligible, runPauseRetention, storagePrefixes,
} from "../functions/billing/pause-retention.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-12-15T00:00:00Z").getTime();

function trial(daysAgo, extra = {}) {
  return {
    name: "Acme Civil", email: "office@acme.test", plan: "trial", status: "active", isTest: false,
    trialEndsAt: new Date(NOW - daysAgo * DAY).toISOString(),
    billing: { provider: null, status: "not-configured", stripeCustomerId: null, stripeSubscriptionId: null },
    ...extra,
  };
}

test("only an unpaid trial company is eligible, and only after trialEndsAt plus 30 days", () => {
  assert.equal(PAUSE_GRACE_DAYS, 30);
  assert.equal(retentionEligible(trial(31), "acme"), true);
  assert.equal(retentionEligible(trial(31, { ownerPaused: true }), "acme"), false);
  assert.equal(pauseRetentionPlan(trial(40, { ownerPaused: true }), "acme", NOW).action, "skip");
  assert.equal(retentionEligible(trial(31), "heartwood"), false);
  assert.equal(retentionEligible(trial(31, { isTest: true }), "yard"), false);
  assert.equal(retentionEligible(trial(31, { plan: "friend" }), "mate"), false);
  assert.equal(retentionEligible(trial(31, { plan: "paid" }), "paidco"), false);
  assert.equal(retentionEligible(trial(31, { billing: { status: "active" } }), "acme"), false);
  assert.equal(retentionEligible(trial(31, { billing: { status: "trialing", stripeCustomerId: "cus" } }), "acme"), false);
  assert.equal(retentionEligible(trial(31, { plan: "paid", billing: { status: "canceled", stripeCustomerId: "cus" } }), "acme"), false);
  assert.equal(retentionEligible(trial(10), "acme"), true);
  assert.equal(pauseRetentionPlan(trial(10), "acme", NOW).action, "keep");
  assert.equal(pauseRetentionPlan(trial(31), "acme", NOW).action, "delete");
  assert.equal(pauseRetentionPlan(trial(29), "acme", NOW).action, "warn");
  assert.equal(pauseRetentionPlan(trial(29), "acme", NOW).days, 1);
  assert.equal(pauseRetentionPlan(trial(23), "acme", NOW).days, 7);
  assert.equal(pauseRetentionPlan(trial(23, { pauseWarning7At: new Date(NOW - DAY).toISOString() }), "acme", NOW).action, "keep");
  assert.equal(pauseRetentionPlan(trial(29, { pauseWarning1At: new Date(NOW - 3600000).toISOString() }), "acme", NOW).action, "keep");
  assert.equal(pauseRetentionPlan({ name: "H", plan: "paid" }, "heartwood", NOW).action, "skip");
  assert.equal(pauseDeleteIsDryRun({}), true);
  assert.equal(pauseDeleteIsDryRun({ PAUSE_DELETE_DRY_RUN: "true" }), true);
  assert.equal(pauseDeleteIsDryRun({ PAUSE_DELETE_DRY_RUN: "false" }), false);
});

test("warning mail is a queue document and deletion never touches protected companies or auth users", () => {
  const plan = pauseRetentionPlan(trial(23), "acme", NOW);
  const mail = pauseWarningMail(trial(23), "acme", plan);
  assert.equal(mail.collection, "mail");
  assert.equal(mail.doc.to, "office@acme.test");
  assert.equal(mail.doc.delivery, "queued");
  assert.equal(mail.doc.purpose, "pause-deletion-warning");
  assert.equal(mail.doc.days, 7);
  assert.match(mail.doc.message.subject, /7 days/);
  assert.match(mail.doc.message.text, /subscribe/i);
  assert.equal(mail.send, undefined);
  assert.equal(authUserDeletable("owner1", { companyId: "acme", role: "admin" }, "acme"), true);
  assert.equal(authUserDeletable("1JKLsoxkQNfkphBBO0vDz2ziEyj2", { companyId: "acme" }, "acme"), false);
  assert.equal(authUserDeletable("owner1", { companyId: "heartwood" }, "acme"), false);
  assert.equal(authUserDeletable("owner1", { companyId: "other" }, "acme"), false);
  assert.deepEqual(storagePrefixes("heartwood"), []);
  assert.deepEqual(storagePrefixes("acme"), ["companies/acme/", "tenants/acme/"]);
  assert.match(backupObjectPath("acme", NOW), /^pauseBackups\/acme\/.+\.json$/);
  const rules = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /function companyOpen\(companyId\)/);
  assert.match(rules, /return companyId == "heartwood" \|\| companyNotPaused\(companyId\)/);
  assert.match(rules, /status == "trialing"/);
  assert.match(emu, /function companyOpen\(companyId\)/);
  assert.match(emu, /status == "trialing"/);
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.match(index, /pauseRetentionSweep/);
  const sweep = readFileSync(new URL("../functions/pause-retention.js", import.meta.url), "utf8");
  assert.match(sweep, /PAUSE_DELETE_DRY_RUN/);
  assert.match(sweep, /pauseDeleteIsDryRun/);
});

test("dry-run logs the company and does not queue mail or delete; a live delete rechecks first", async () => {
  const ended = { id: "acme", data: trial(40) };
  const logs = [];
  const calls = [];
  const dry = await runPauseRetention({
    now: NOW, dryRun: true,
    listCompanies: async () => [ended, { id: "heartwood", data: { plan: "paid", name: "Heartwood" } }, { id: "yard", data: trial(40, { isTest: true }) }],
    loadCompany: async () => { throw new Error("dry-run must not reload"); },
    queueMail: async () => calls.push("mail"),
    writeBackup: async () => calls.push("backup"),
    deleteCompany: async () => calls.push("delete"),
    collect: async () => calls.push("collect"),
    log: line => logs.push(line),
  });
  assert.equal(dry.length, 1);
  assert.equal(dry[0].action, "delete");
  assert.equal(dry[0].dryRun, true);
  assert.match(logs[0], /dry-run delete acme/);
  assert.deepEqual(calls, []);

  const liveCalls = [];
  const subscribed = { ...trial(40), billing: { status: "active", stripeCustomerId: "cus" }, plan: "paid" };
  const aborted = await runPauseRetention({
    now: NOW, dryRun: false,
    listCompanies: async () => [ended],
    loadCompany: async () => ({ id: "acme", data: subscribed }),
    queueMail: async () => liveCalls.push("mail"),
    writeBackup: async () => liveCalls.push("backup"),
    deleteCompany: async () => liveCalls.push("delete"),
    collect: async () => liveCalls.push("collect"),
    log: () => {},
  });
  assert.equal(aborted[0].reason, "recheck");
  assert.deepEqual(liveCalls, []);

  const removed = await runPauseRetention({
    now: NOW, dryRun: false,
    listCompanies: async () => [ended],
    loadCompany: async () => ended,
    queueMail: async () => liveCalls.push("mail"),
    collect: async () => ({ companyId: "acme", groups: { users: [{ path: "users/owner1", data: { companyId: "acme", role: "admin" } }] } }),
    writeBackup: async path => liveCalls.push("backup:" + path),
    deleteCompany: async () => liveCalls.push("delete"),
    log: () => {},
  });
  assert.equal(removed[0].action, "delete");
  assert.match(liveCalls[0], /^backup:pauseBackups\/acme\//);
  assert.equal(liveCalls[1], "delete");

  const warned = [];
  const notice = await runPauseRetention({
    now: NOW, dryRun: false,
    listCompanies: async () => [{ id: "acme", data: trial(23) }],
    loadCompany: async () => ({ id: "acme", data: trial(23) }),
    queueMail: async mail => warned.push(mail),
    markWarning: async (id, days) => warned.push("mark:" + days),
    writeBackup: async () => warned.push("backup"),
    deleteCompany: async () => warned.push("delete"),
    log: () => {},
  });
  assert.equal(notice[0].action, "warn");
  assert.equal(notice[0].days, 7);
  assert.equal(warned[0].collection, "mail");
  assert.equal(warned[0].doc.delivery, "queued");
  assert.equal(warned[1], "mark:7");
  assert.equal(warned.includes("delete"), false);
});
