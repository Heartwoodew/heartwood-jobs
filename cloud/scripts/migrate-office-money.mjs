// 12 Nov 2026: move the invoice price (invoiceAmount, ex GST) and the Xero match (xeroCheck: totalEx, amountDue) off job documents, which assigned crew can read (and keep
// in their phone's offline cache), into the office-only jobMoney/{jobId}. The other invoice fields (invoiceNo,
// invoiceDescription, invoiceDate, invoiced, ...) stay on the job.
//
// For every job that still has invoiceAmount or xeroCheck (each field on its own):
//   * jobMoney has no value yet -> copy it to jobMoney (merge), then delete it from the job;
//   * jobMoney already has the same value -> just delete it from the job;
//   * jobMoney has a DIFFERENT value -> conflict: that field is left on the job and listed for a person to check.
// Values already in jobMoney are never overwritten.
//
// Dry run is the default and writes nothing (no backup file either: the backup holds amounts).
// --apply first writes a JSON backup (mode 600) of every job it will change (job value and the jobMoney value before),
// then writes jobMoney before it removes the field from the job, then re-reads every changed job to verify.
// The printed report has paths, counts and companies, never amounts.
//
// Emulator (fake data):
//   firebase emulators:exec --only firestore --project demo-heartwood "node scripts/migrate-office-money.mjs"
//   firebase emulators:exec --only firestore --project demo-heartwood "node scripts/migrate-office-money.mjs --apply"
//
// Production: admin-run only, after the PR is merged, the new rules are live, the app update is out and the box
// workers tools/export_completed.py and tools/xero_queue.py write invoiceAmount / xeroCheck to jobMoney. Without --apply this only reads heartwood-9f37f.
//   node scripts/migrate-office-money.mjs --project heartwood-9f37f
//   node scripts/migrate-office-money.mjs --project heartwood-9f37f --apply --backup /path/backup.json
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteField, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { LIVE_PROJECT } from "./migrate-company-id.mjs";

export const FIELDS = Object.freeze(["invoiceAmount", "xeroCheck"]);
export const FIELD = "invoiceAmount";
const companyOf = data => (typeof data.companyId === "string" && data.companyId) || (typeof data.tenantId === "string" && data.tenantId) || "heartwood";
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x)) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x);
const same = (a, b) => (a ?? null) === (b ?? null) || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 0.005)
  || (a && b && typeof a === "object" && typeof b === "object" && canon(a) === canon(b));

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

function planField(field, job, have) {
  if (!(field in job)) return null;
  if (field in have) return same(have[field], job[field]) ? { field, action: "remove" } : { field, action: "conflict" };
  if (field === "invoiceAmount") {
    const raw = job[field] ?? null, amount = raw == null ? null : (typeof raw === "number" ? raw : Number(raw));
    if (amount != null && !Number.isFinite(amount)) return { field, action: "conflict", reason: "not-a-number" };
    return { field, action: "copy-and-remove", value: amount };
  }
  const v = job[field] ?? null;
  if (v != null && (typeof v !== "object" || Array.isArray(v))) return { field, action: "conflict", reason: "not-a-map" };
  return { field, action: "copy-and-remove", value: v };
}

/** Plan one job. Pure. fields[]: per field action "copy-and-remove" | "remove" | "conflict"; conflicts are left on the job. */
export function planOfficeMoney(id, job, existingMoney = null) {
  const companyId = companyOf(job || {});
  const have = existingMoney || {};
  const fields = job ? FIELDS.map(f => planField(f, job, have)).filter(Boolean) : [];
  const copy = fields.filter(f => f.action === "copy-and-remove");
  return {
    id, companyId, fields,
    remove: fields.filter(f => f.action !== "conflict").map(f => f.field),
    conflicts: fields.filter(f => f.action === "conflict").map(f => f.field),
    money: copy.length ? { jobId: id, companyId, ...(companyId !== "heartwood" ? { tenantId: companyId } : {}), ...Object.fromEntries(copy.map(f => [f.field, f.value])) } : null,
  };
}

/** Back-compat single-field view (invoiceAmount). */
export function planInvoiceAmount(id, job, existingMoney = null) {
  const p = planOfficeMoney(id, job, existingMoney);
  const f = p.fields.find(x => x.field === FIELD);
  if (!f) return { id, companyId: p.companyId, action: "skip" };
  return { id, companyId: p.companyId, action: f.action, ...(f.reason ? { reason: f.reason } : {}),
    ...(f.action === "copy-and-remove" ? { money: { jobId: id, companyId: p.companyId, ...(p.companyId !== "heartwood" ? { tenantId: p.companyId } : {}), [FIELD]: f.value } } : {}) };
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
    apply: !!apply, scanned: 0, withInvoiceAmount: 0, withXeroCheck: 0, copyAndRemove: 0, removeOnly: 0, conflicts: [], nullValues: 0,
    perField: {}, byCompany: {}, crewAssigned: 0, done: 0, invoiced: 0, written: 0, verified: 0, verifyFailed: [], rows: [],
  };
  const plans = [];
  for (const { id, data } of await io.jobs()) {
    report.scanned += 1;
    if (!FIELDS.some(f => f in data)) continue;
    const money = await io.money(id);
    const plan = planOfficeMoney(id, data, money);
    if (FIELD in data) report.withInvoiceAmount += 1;
    if ("xeroCheck" in data) report.withXeroCheck += 1;
    report.byCompany[plan.companyId] = (report.byCompany[plan.companyId] || 0) + 1;
    if (FIELD in data && data[FIELD] == null) report.nullValues += 1;
    if (Array.isArray(data.assigned) && data.assigned.length) report.crewAssigned += 1;
    if (data.status === "Done") report.done += 1;
    if (data.invoiced === true) report.invoiced += 1;
    for (const f of plan.fields) {
      const pf = (report.perField[f.field] ||= { copyAndRemove: 0, removeOnly: 0, conflicts: 0 });
      if (f.action === "copy-and-remove") pf.copyAndRemove += 1; else if (f.action === "remove") pf.removeOnly += 1; else pf.conflicts += 1;
    }
    for (const c of plan.conflicts) report.conflicts.push("jobs/" + id + (c === FIELD ? "" : "#" + c));
    if (!plan.remove.length) continue;
    if (plan.money) report.copyAndRemove += 1; else report.removeOnly += 1;
    report.rows.push({ path: "jobs/" + id, companyId: plan.companyId, move: plan.fields.filter(f => f.action === "copy-and-remove").map(f => f.field),
      removeOnly: plan.fields.filter(f => f.action === "remove").map(f => f.field), conflicts: plan.conflicts });
    plans.push({ plan, job: data, money });
  }
  if (!apply || !plans.length) return report;
  // Backup first (amounts included), before any write.
  const backup = { createdAt: io.now(), fields: [...FIELDS], rows: plans.map(({ plan, job, money }) => ({
    path: "jobs/" + plan.id, companyId: plan.companyId,
    job: Object.fromEntries(plan.remove.map(f => [f, job[f] ?? null])),
    jobMoneyBefore: Object.fromEntries(plan.remove.map(f => [f, money && f in money ? money[f] : "(missing)"])),
    actions: Object.fromEntries(plan.fields.map(f => [f.field, f.action])) })) };
  if (writeBackup) await writeBackup(backup);
  else {
    if (!backupPath) throw new Error("backup path required for --apply");
    if (existsSync(backupPath)) throw new Error("backup file already exists: " + backupPath);
    writeFileSync(backupPath, JSON.stringify(backup, null, 2), { mode: 0o600 });
  }
  report.backup = backupPath || "(custom)";
  for (const { plan } of plans) {
    if (plan.money) await io.setMoney(plan.id, { ...plan.money, migratedAt: io.now() });
    await io.updateJob(plan.id, Object.fromEntries(plan.remove.map(f => [f, io.removeField()])));
    report.written += 1;
  }
  for (const { plan, job } of plans) {
    const [j, m] = [await io.job(plan.id), await io.money(plan.id)];
    const ok = j && m && plan.remove.every(f => !(f in j) && f in m && same(m[f], job[f]));
    if (ok) report.verified += 1; else report.verifyFailed.push("jobs/" + plan.id);
  }
  return report;
}
export const migrateOfficeMoney = migrateInvoiceAmount;

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
    console.error((parsed.apply ? "PRODUCTION WRITE" : "PRODUCTION DRY RUN (read only)") + " " + LIVE_PROJECT + ". Moves invoiceAmount and xeroCheck to jobMoney/{jobId}.");
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

const isMain = process.argv[1] && process.argv[1].endsWith("migrate-office-money.mjs");
if (isMain) main().catch(err => { console.error(err && err.message ? err.message : err); process.exit(1); });
