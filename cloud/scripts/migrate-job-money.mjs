// Round 3 (Q6): move money off job documents, which assigned crew can read (and keep in their phone's offline cache).
// For every job it copies poAmount / poAmountBasis / poAmountSource / quoteAmount and the Find PO suggestions list
// (poLookupCandidates, it carries PO amounts; added Nov 2026) into jobMoney/{jobId} (office only),
// then removes them from the job. It also drops quote prices from the job's quote copy (totalEx, gst, totalInc, lines,
// priceOverrides, ratesSnapshot, extraItems[].unitPrice; quote.totalEx is kept as quoteAmount when that is missing)
// and moves splitUndo.poAmount to jobMoney.splitUndoPoAmount. Values already in jobMoney are never overwritten.
// Invoice fields (invoiceNo, invoiceAmount, ...) are NOT touched: the box invoicing workers still use them on the job.
// Dry run is the default and writes nothing.
//
// Emulator (fake data):
//   firebase emulators:exec --only firestore --project demo-heartwood "node scripts/migrate-job-money.mjs"
//   firebase emulators:exec --only firestore --project demo-heartwood "node scripts/migrate-job-money.mjs --commit"
//
// Production: admin-run only, after the PR is merged, the new rules are live and the app update is out.
// Without --commit this reads heartwood-9f37f and writes nothing.
//   node scripts/migrate-job-money.mjs --project heartwood-9f37f
//   node scripts/migrate-job-money.mjs --project heartwood-9f37f --commit
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteField, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { JOB_MONEY_KEYS } from "../../app/features/job-money.js";
import { parseMigrateArgs, LIVE_PROJECT } from "./migrate-company-id.mjs";

export const QUOTE_PRICE_KEYS = Object.freeze(["totalEx", "gst", "totalInc", "lines", "priceOverrides", "ratesSnapshot"]);

const companyOf = data => (typeof data.companyId === "string" && data.companyId) || (typeof data.tenantId === "string" && data.tenantId) || "heartwood";

/** Plan one job: what goes to jobMoney and what is removed or rewritten on the job. Pure. */
export function planJobMoney(id, job, existingMoney = null) {
  const have = existingMoney || {};
  const money = {}, remove = [], set = {};
  for (const key of JOB_MONEY_KEYS) {
    if (!(key in job)) continue;
    remove.push(key);
    if (!(key in have)) money[key] = job[key] ?? null;
  }
  const quote = job.quote && typeof job.quote === "object" && !Array.isArray(job.quote) ? job.quote : null;
  if (quote) {
    const priced = QUOTE_PRICE_KEYS.filter(k => k in quote);
    const items = Array.isArray(quote.extraItems) ? quote.extraItems : null;
    const pricedItems = items && items.some(it => it && typeof it === "object" && "unitPrice" in it);
    if (priced.length || pricedItems) {
      const next = { ...quote };
      for (const k of priced) delete next[k];
      if (pricedItems) next.extraItems = items.map(it => (it && typeof it === "object") ? (({ unitPrice, ...rest }) => rest)(it) : it);
      set.quote = next;
      if (quote.totalEx != null && !("quoteAmount" in job) && !("quoteAmount" in have) && !("quoteAmount" in money)) money.quoteAmount = quote.totalEx;
    }
  }
  const undo = job.splitUndo && typeof job.splitUndo === "object" ? job.splitUndo : null;
  if (undo && "poAmount" in undo) {
    const { poAmount, ...rest } = undo;
    set.splitUndo = rest;
    if (!("splitUndoPoAmount" in have) && typeof poAmount === "number") money.splitUndoPoAmount = poAmount;
  }
  const changes = remove.length > 0 || Object.keys(set).length > 0;
  const companyId = companyOf(job);
  return {
    id, companyId, changes, remove, set,
    money: Object.keys(money).length ? { jobId: id, companyId, ...(companyId !== "heartwood" ? { tenantId: companyId } : {}), ...money } : null,
  };
}

function clientStore(db) {
  return {
    async jobs() { return (await getDocs(collection(db, "jobs"))).docs.map(d => ({ id: d.id, data: d.data() })); },
    async money(id) { const s = await getDoc(doc(db, "jobMoney", id)); return s.exists() ? s.data() : null; },
    async setMoney(id, data) { await setDoc(doc(db, "jobMoney", id), data, { merge: true }); },
    async updateJob(id, data) { await updateDoc(doc(db, "jobs", id), data); },
    removeField: () => deleteField(),
    now: () => new Date().toISOString(),
  };
}

async function productionStore() {
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ projectId: LIVE_PROJECT });
  const db = getFirestore();
  return {
    async jobs() { return (await db.collection("jobs").get()).docs.map(d => ({ id: d.id, data: d.data() })); },
    async money(id) { const s = await db.collection("jobMoney").doc(id).get(); return s.exists ? s.data() : null; },
    async setMoney(id, data) { await db.collection("jobMoney").doc(id).set(data, { merge: true }); },
    async updateJob(id, data) { await db.collection("jobs").doc(id).update(data); },
    removeField: () => FieldValue.delete(),
    now: () => new Date().toISOString(),
  };
}

/** Run the plan over every job. Money is written before it is removed from the job. Report holds paths and keys, no amounts. */
export async function migrateJobMoney(db, { commit = false, store = null } = {}) {
  const io = store || clientStore(db);
  const report = { commit: !!commit, scanned: 0, jobsChanged: 0, moneyDocs: 0, removedKeys: {}, quoteCopiesCleaned: 0, rows: [] };
  for (const { id, data } of await io.jobs()) {
    report.scanned += 1;
    const plan = planJobMoney(id, data, await io.money(id));
    if (!plan.changes && !plan.money) continue;
    report.jobsChanged += 1;
    if (plan.money) report.moneyDocs += 1;
    if (plan.set.quote) report.quoteCopiesCleaned += 1;
    for (const k of plan.remove) report.removedKeys[k] = (report.removedKeys[k] || 0) + 1;
    report.rows.push({ path: "jobs/" + id, companyId: plan.companyId, remove: plan.remove, rewrite: Object.keys(plan.set), moneyKeys: plan.money ? Object.keys(plan.money).filter(k => !["jobId", "companyId", "tenantId"].includes(k)) : [] });
    if (!commit) continue;
    if (plan.money) await io.setMoney(id, { ...plan.money, migratedAt: io.now() });
    const patch = { ...plan.set };
    for (const k of plan.remove) patch[k] = io.removeField();
    if (Object.keys(patch).length) await io.updateJob(id, patch);
  }
  return report;
}

async function main() {
  const parsed = parseMigrateArgs(process.argv, process.env);
  if (!parsed.ok) {
    const text = {
      "explicit-project": "Refusing " + LIVE_PROJECT + " unless you pass --project " + LIVE_PROJECT + " on the command line.",
      "emulator-host": "Refusing production while FIRESTORE_EMULATOR_HOST is set.",
      "emulator-required": "Refusing: FIRESTORE_EMULATOR_HOST is not set. Production needs --project " + LIVE_PROJECT + ".",
    }[parsed.reason] || parsed.reason;
    console.error(text);
    process.exit(1);
  }
  let report;
  if (parsed.live) {
    console.error((parsed.commit ? "PRODUCTION WRITE" : "PRODUCTION DRY RUN") + " " + LIVE_PROJECT + ". Moves job money to jobMoney/{jobId}.");
    report = await migrateJobMoney(null, { commit: parsed.commit, store: await productionStore() });
  } else {
    const env = await initializeTestEnvironment({
      projectId: parsed.project,
      firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
    });
    await env.withSecurityRulesDisabled(async ctx => {
      report = await migrateJobMoney(ctx.firestore(), { commit: parsed.commit });
    });
    await env.cleanup();
  }
  console.log(JSON.stringify({ ...report, mode: parsed.mode, project: parsed.project }, null, 2));
}

const isMain = process.argv[1] && process.argv[1].endsWith("migrate-job-money.mjs");
if (isMain) main().catch(err => { console.error(err); process.exit(1); });
