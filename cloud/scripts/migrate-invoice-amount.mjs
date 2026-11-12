// 12 Nov 2026: move the invoice price (invoiceAmount, ex GST) off job documents, which assigned crew can read (and keep
// in their phone's offline cache), into the office-only jobMoney/{jobId}. The other invoice fields (invoiceNo,
// invoiceDescription, invoiceDate, invoiced, ...) stay on the job.
//
// For every job that still has invoiceAmount:
//   * jobMoney has no invoiceAmount yet -> copy it to jobMoney (merge), then delete it from the job;
//   * jobMoney already has the same value -> just delete it from the job;
//   * jobMoney has a DIFFERENT value -> conflict: nothing is written for that job, it is listed for a person to check.
// Values already in jobMoney are never overwritten.
//
// Dry run is the default and writes nothing (no backup file either: the backup holds amounts).
// --apply first writes a JSON backup (mode 600) of every job it will change (job value and the jobMoney value before),
// then writes jobMoney before it removes the field from the job, then re-reads every changed job to verify.
// The printed report has paths, counts and companies, never amounts.
//
// Emulator (fake data):
//   firebase emulators:exec --only firestore --project demo-heartwood "node scripts/migrate-invoice-amount.mjs"
//   firebase emulators:exec --only firestore --project demo-heartwood "node scripts/migrate-invoice-amount.mjs --apply"
//
// Production: admin-run only, after the PR is merged, the new rules are live, the app update is out and the box
// worker tools/export_completed.py writes invoiceAmount to jobMoney. Without --apply this only reads heartwood-9f37f.
//   node scripts/migrate-invoice-amount.mjs --project heartwood-9f37f
//   node scripts/migrate-invoice-amount.mjs --project heartwood-9f37f --apply --backup /path/backup.json
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteField, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { LIVE_PROJECT } from "./migrate-company-id.mjs";

export const FIELD = "invoiceAmount";
const companyOf = data => (typeof data.companyId === "string" && data.companyId) || (typeof data.tenantId === "string" && data.tenantId) || "heartwood";
const same = (a, b) => (a ?? null) === (b ?? null) || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 0.005);

/** Arguments: --project, --apply, --backup <file>. Same production guards as the other migrations. */
export function parseInvoiceArgs(argv = [], env = {}) {
  let project = "", backup = "";
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || "");
    if (a === "--project" && argv[i + 1]) project = project || String(argv[++i]);
    else if (a.startsWith("--project=")) project = project || a.slice(10);
    else if (a === "--backup" && argv[i + 1]) backup = String(argv[++i]);
    else if (a.startsWith("--backup=")) backup = a.slice(9);
  }
  if (env.GCLOUD_PROJECT === LIVE_PROJECT && project !== LIVE_PROJECT) return { ok: false, reason: "explicit-project" };
  project = project || "demo-heartwood";
  const apply = argv.includes("--apply");
  if (argv.includes("--commit")) return { ok: false, reason: "use --apply (not --commit) to write" };
  const live = project === LIVE_PROJECT;
  if (live && env.FIRESTORE_EMULATOR_HOST) return { ok: false, reason: "emulator-host" };
  if (!live && !env.FIRESTORE_EMULATOR_HOST) return { ok: false, reason: "emulator-required" };
  if (live && apply && !backup) return { ok: false, reason: "backup-required" };
  return { ok: true, project, apply, live, backup, mode: apply ? "apply" : "dry-run" };
}

/** Plan one job. Pure. action: "skip" | "copy-and-remove" | "remove" | "conflict". */
export function planInvoiceAmount(id, job, existingMoney = null) {
  const companyId = companyOf(job || {});
  if (!job || !(FIELD in job)) return { id, companyId, action: "skip" };
  const have = existingMoney || {};
  if (FIELD in have) {
    if (same(have[FIELD], job[FIELD])) return { id, companyId, action: "remove" };
    return { id, companyId, action: "conflict" };
  }
  const raw = job[FIELD] ?? null, amount = raw == null ? null : (typeof raw === "number" ? raw : Number(raw));
  if (amount != null && !Number.isFinite(amount)) return { id, companyId, action: "conflict", reason: "not-a-number" };
  return {
    id, companyId, action: "copy-and-remove",
    money: { jobId: id, companyId, ...(companyId !== "heartwood" ? { tenantId: companyId } : {}), [FIELD]: amount },
  };
}

function clientStore(db) {
  return {
    async jobs() { return (await getDocs(collection(db, "jobs"))).docs.map(d => ({ id: d.id, data: d.data() })); },
    async money(id) { const s = await getDoc(doc(db, "jobMoney", id)); return s.exists() ? s.data() : null; },
    async job(id) { const s = await getDoc(doc(db, "jobs", id)); return s.exists() ? s.data() : null; },
    async setMoney(id, data) { await setDoc(doc(db, "jobMoney", id), data, { merge: true }); },
    async updateJob(id, data) { await updateDoc(doc(db, "jobs", id), data); },
    removeField: () => deleteField(),
    now: () => new Date().toISOString(),
  };
}

export async function productionStore() {
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ projectId: LIVE_PROJECT });
  const db = getFirestore();
  return {
    async jobs() { return (await db.collection("jobs").get()).docs.map(d => ({ id: d.id, data: d.data() })); },
    async money(id) { const s = await db.collection("jobMoney").doc(id).get(); return s.exists ? s.data() : null; },
    async job(id) { const s = await db.collection("jobs").doc(id).get(); return s.exists ? s.data() : null; },
    async setMoney(id, data) { await db.collection("jobMoney").doc(id).set(data, { merge: true }); },
    async updateJob(id, data) { await db.collection("jobs").doc(id).update(data); },
    removeField: () => FieldValue.delete(),
    now: () => new Date().toISOString(),
  };
}

/** Plan (and with apply, run) the move. The report holds paths and counts, no amounts. */
export async function migrateInvoiceAmount(db, { apply = false, store = null, backupPath = "", writeBackup = null } = {}) {
  const io = store || clientStore(db);
  const report = {
    apply: !!apply, scanned: 0, withInvoiceAmount: 0, copyAndRemove: 0, removeOnly: 0, conflicts: [], nullValues: 0,
    byCompany: {}, crewAssigned: 0, done: 0, invoiced: 0, written: 0, verified: 0, verifyFailed: [], rows: [],
  };
  const plans = [];
  for (const { id, data } of await io.jobs()) {
    report.scanned += 1;
    if (!(FIELD in data)) continue;
    const money = await io.money(id);
    const plan = planInvoiceAmount(id, data, money);
    report.withInvoiceAmount += 1;
    report.byCompany[plan.companyId] = (report.byCompany[plan.companyId] || 0) + 1;
    if (data[FIELD] == null) report.nullValues += 1;
    if (Array.isArray(data.assigned) && data.assigned.length) report.crewAssigned += 1;
    if (data.status === "Done") report.done += 1;
    if (data.invoiced === true) report.invoiced += 1;
    if (plan.action === "conflict") { report.conflicts.push("jobs/" + id); continue; }
    if (plan.action === "copy-and-remove") report.copyAndRemove += 1; else report.removeOnly += 1;
    report.rows.push({ path: "jobs/" + id, companyId: plan.companyId, action: plan.action });
    plans.push({ plan, job: data, money });
  }
  if (!apply || !plans.length) return report;
  // Backup first (amounts included), before any write.
  const backup = { createdAt: io.now(), field: FIELD, rows: plans.map(({ plan, job, money }) => ({
    path: "jobs/" + plan.id, companyId: plan.companyId, jobValue: job[FIELD] ?? null,
    jobMoneyBefore: money && FIELD in money ? money[FIELD] : "(missing)", action: plan.action })) };
  if (writeBackup) await writeBackup(backup);
  else {
    if (!backupPath) throw new Error("backup path required for --apply");
    if (existsSync(backupPath)) throw new Error("backup file already exists: " + backupPath);
    writeFileSync(backupPath, JSON.stringify(backup, null, 2), { mode: 0o600 });
  }
  report.backup = backupPath || "(custom)";
  for (const { plan } of plans) {
    if (plan.money) await io.setMoney(plan.id, { ...plan.money, migratedAt: io.now() });
    await io.updateJob(plan.id, { [FIELD]: io.removeField() });
    report.written += 1;
  }
  for (const { plan, job } of plans) {
    const [j, m] = [await io.job(plan.id), await io.money(plan.id)];
    const ok = j && !(FIELD in j) && m && FIELD in m && (plan.action === "remove" || same(m[FIELD], job[FIELD]));
    if (ok) report.verified += 1; else report.verifyFailed.push("jobs/" + plan.id);
  }
  return report;
}

async function main() {
  const parsed = parseInvoiceArgs(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    const text = {
      "explicit-project": "Refusing " + LIVE_PROJECT + " unless you pass --project " + LIVE_PROJECT + " on the command line.",
      "emulator-host": "Refusing production while FIRESTORE_EMULATOR_HOST is set.",
      "emulator-required": "Refusing: FIRESTORE_EMULATOR_HOST is not set. Production needs --project " + LIVE_PROJECT + ".",
      "backup-required": "Refusing: --apply on production needs --backup <new file> (it holds amounts; written mode 600).",
    }[parsed.reason] || parsed.reason;
    console.error(text);
    process.exit(1);
  }
  let report;
  if (parsed.live) {
    console.error((parsed.apply ? "PRODUCTION WRITE" : "PRODUCTION DRY RUN (read only)") + " " + LIVE_PROJECT + ". Moves invoiceAmount to jobMoney/{jobId}.");
    report = await migrateInvoiceAmount(null, { apply: parsed.apply, store: await productionStore(), backupPath: parsed.backup });
  } else {
    const env = await initializeTestEnvironment({
      projectId: parsed.project,
      firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
    });
    await env.withSecurityRulesDisabled(async ctx => {
      report = await migrateInvoiceAmount(ctx.firestore(), { apply: parsed.apply, backupPath: parsed.backup || `invoice-amount-backup-emulator-${Date.now()}.json` });
    });
    await env.cleanup();
  }
  console.log(JSON.stringify({ ...report, mode: parsed.mode, project: parsed.project }, null, 2));
  if (report.conflicts.length || report.verifyFailed.length) process.exitCode = 2;
}

const isMain = process.argv[1] && process.argv[1].endsWith("migrate-invoice-amount.mjs");
if (isMain) main().catch(err => { console.error(err && err.message ? err.message : err); process.exit(1); });
