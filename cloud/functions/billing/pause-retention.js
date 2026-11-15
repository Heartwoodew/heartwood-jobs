// Paused CallUp companies are kept for 30 days after trialEndsAt, then deleted.
// Heartwood, test companies, friend plans and any company that has subscribed (plan paid,
// or billing active/trialing) are never selected. The same checks run again immediately
// before a delete. This file does not call Stripe and does not send email itself:
// a warning is a mail-queue document for the existing email worker.

export const PAUSE_GRACE_DAYS = 30;
export const PAUSE_GRACE_MS = PAUSE_GRACE_DAYS * 24 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const CARD_SETUP_LATER = "Card setup isn't available yet, you can add it later in Settings";

const PROTECTED_UIDS = new Set([
  "1JKLsoxkQNfkphBBO0vDz2ziEyj2",
  "38SU5waAy4f9UI9N6JTqDMaYpQg2",
  "R7t41e54Ykcdk9WPdVZnDd697iI2",
]);

export function pauseDeleteIsDryRun(env = {}) {
  return env.PAUSE_DELETE_DRY_RUN !== "false";
}

export function millisOf(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const n = new Date(value).getTime();
  return Number.isNaN(n) ? null : n;
}

function billingStatus(company) {
  return (company && company.billing && company.billing.status) || "";
}

// True only for a trial company that never became a paying customer.
export function retentionEligible(company, companyId) {
  if (!company || typeof company !== "object") return false;
  if (!companyId || companyId === "heartwood") return false;
  if (company.isTest === true) return false;
  if (company.plan === "friend" || company.plan === "paid") return false;
  const status = billingStatus(company);
  if (status === "active" || status === "trialing") return false;
  return millisOf(company.trialEndsAt) != null;
}

export function deletionAt(company) {
  const end = millisOf(company && company.trialEndsAt);
  return end == null ? null : end + PAUSE_GRACE_MS;
}

// skip: never touch. keep: eligible but not in a warning or delete window.
// warn: 7 days or 1 day before deletion, once each. delete: trialEndsAt + 30 days is past.
export function pauseRetentionPlan(company, companyId, now = Date.now()) {
  const at = now instanceof Date ? now.getTime() : Number(now);
  if (!retentionEligible(company, companyId)) return { action: "skip", companyId: companyId || "" };
  const deleteAt = deletionAt(company);
  if (!(deleteAt > 0)) return { action: "skip", companyId };
  if (deleteAt < at) return { action: "delete", companyId, deleteAt };
  const warned1 = millisOf(company.pauseWarning1At) != null;
  const warned7 = millisOf(company.pauseWarning7At) != null;
  if (at >= deleteAt - DAY_MS && !warned1) return { action: "warn", companyId, deleteAt, days: 1 };
  if (at >= deleteAt - 7 * DAY_MS && at < deleteAt - DAY_MS && !warned7) return { action: "warn", companyId, deleteAt, days: 7 };
  return { action: "keep", companyId, deleteAt };
}

function when(ms) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Brisbane",
  }).format(new Date(ms));
}

// Queue document for the Trigger Email worker (collection "mail"). Nothing is sent here.
export function pauseWarningMail(company, companyId, plan) {
  const to = String((company && (company.email || company.accountsEmail)) || "").trim();
  const days = plan && plan.days === 1 ? 1 : 7;
  const date = when(plan.deleteAt);
  const subject = days === 1
    ? "Your CallUp account will be deleted tomorrow"
    : "Your CallUp account will be deleted in 7 days";
  const name = (company && company.name) || "Your company";
  const text = [
    `Hello,`,
    "",
    `${name}'s free trial has ended and the CallUp account is paused.`,
    `CallUp will delete this company's data on ${date} unless an admin subscribes before then.`,
    "Sign in as the company admin and choose Subscribe. A subscription brings the jobs, quotes and timesheets back straight away.",
    "",
    "CallUp",
  ].join("\n");
  return {
    collection: "mail",
    doc: {
      to,
      from: "CallUp <noreply@callupapp.com.au>",
      replyTo: "",
      message: { subject, text },
      delivery: "queued",
      purpose: "pause-deletion-warning",
      companyId,
      days,
    },
  };
}

export function authUserDeletable(uid, profile, companyId) {
  if (!uid || !profile || !companyId || companyId === "heartwood") return false;
  if (PROTECTED_UIDS.has(uid)) return false;
  const home = profile.companyId || profile.tenantId || "";
  return home === companyId;
}

export function storagePrefixes(companyId) {
  if (!companyId || companyId === "heartwood" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(companyId)) return [];
  return [`companies/${companyId}/`, `tenants/${companyId}/`];
}

export function backupObjectPath(companyId, now = Date.now()) {
  const at = now instanceof Date ? now.getTime() : Number(now);
  const stamp = new Date(at).toISOString().replace(/[:.]/g, "-");
  return `pauseBackups/${companyId}/${stamp}.json`;
}

export async function runPauseRetention(deps) {
  const now = deps.now != null ? (deps.now instanceof Date ? deps.now.getTime() : Number(deps.now)) : Date.now();
  const dryRun = deps.dryRun !== false;
  const log = typeof deps.log === "function" ? deps.log : () => {};
  const companies = await deps.listCompanies();
  const results = [];
  for (const row of companies || []) {
    const plan = pauseRetentionPlan(row.data, row.id, now);
    if (plan.action === "skip" || plan.action === "keep") continue;
    if (dryRun) {
      const line = `pause-retention dry-run ${plan.action} ${row.id} deleteAt=${new Date(plan.deleteAt).toISOString()}${plan.days ? " days=" + plan.days : ""}`;
      log(line);
      results.push({ ...plan, dryRun: true });
      continue;
    }
    const fresh = await deps.loadCompany(row.id);
    const again = pauseRetentionPlan(fresh && fresh.data, row.id, now);
    if (again.action !== plan.action || (plan.action === "warn" && again.days !== plan.days)) {
      results.push({ action: "skip", companyId: row.id, reason: "recheck" });
      continue;
    }
    if (again.action === "warn") {
      const mail = pauseWarningMail(fresh.data, row.id, again);
      if (mail.doc.to) await deps.queueMail(mail);
      else log(`pause-retention warn skipped, no email ${row.id}`);
      if (typeof deps.markWarning === "function") await deps.markWarning(row.id, again.days, now);
      results.push(again);
      continue;
    }
    const path = backupObjectPath(row.id, now);
    const snapshot = await deps.collect(row.id, fresh.data);
    await deps.writeBackup(path, snapshot);
    await deps.deleteCompany(row.id, snapshot);
    log(`pause-retention deleted ${row.id} backup=${path}`);
    results.push({ ...again, backup: path });
  }
  return results;
}
