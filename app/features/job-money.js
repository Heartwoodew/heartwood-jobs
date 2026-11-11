// Job money (round 3, Q6): the PO value and accepted-quote total live in jobMoney/{jobId}, office only.
// Assigned crew can read the whole job document (and their phone keeps an offline copy of it), so the
// job itself carries no dollar amounts. Office screens read jobs merged with their jobMoney doc.
// Legacy jobs (and the box workers that still write poAmount onto the job) fall back to the job's own field
// until cloud/scripts/migrate-job-money.mjs moves it.

export const JOB_MONEY_KEYS = Object.freeze(["poAmount", "poAmountBasis", "poAmountSource", "quoteAmount"]);
export const JOB_MONEY_COLLECTION = "jobMoney";

/** Split a job write into the crew-readable job part and the office-only money part. */
export function splitJobMoney(patch, removeField) {
  const job = { ...(patch || {}) }, money = {};
  for (const key of JOB_MONEY_KEYS) {
    if (!(key in job)) continue;
    money[key] = job[key] === undefined ? null : job[key];
    // A money key written by the office also clears any legacy copy on the job (rules allow removal only).
    if (removeField) job[key] = removeField(); else delete job[key];
  }
  return { job, money, hasMoney: Object.keys(money).length > 0 };
}

/** Build the jobMoney document body for one job. */
export function jobMoneyDoc(jobId, companyId, money, extra = {}) {
  const out = { jobId: String(jobId), companyId: String(companyId || "heartwood") };
  for (const key of JOB_MONEY_KEYS) if (key in (money || {})) out[key] = money[key] ?? null;
  return { ...out, ...extra };
}

/** Office view of a job: jobMoney wins over any legacy field still on the job. */
export function mergeJobMoney(job, money) {
  if (!job) return job;
  if (!money) return job;
  const out = { ...job };
  for (const key of JOB_MONEY_KEYS) if (key in money) out[key] = money[key];
  return out;
}

/** Strip money from a job record (crew copies, exports to crew, tests). */
export function stripJobMoney(job) {
  const out = { ...(job || {}) };
  for (const key of JOB_MONEY_KEYS) delete out[key];
  return out;
}
