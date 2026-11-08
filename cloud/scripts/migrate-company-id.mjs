// Backfill companyId. Adds fields only. Never deletes. Never overwrites companyId.
// Dry run is the default. A missing companyId becomes "heartwood" unless tenantId
// already names another company.
//
// Emulator (fake data):
//   firebase emulators:exec --only firestore --project demo-heartwood "node scripts/migrate-company-id.mjs"
//   firebase emulators:exec --only firestore --project demo-heartwood "node scripts/migrate-company-id.mjs --commit"
//
// Reviewed production mode. Both flags are required before any live write.
// Without --commit this reads heartwood-9f37f and writes nothing.
//   node scripts/migrate-company-id.mjs --project heartwood-9f37f
//   node scripts/migrate-company-id.mjs --project heartwood-9f37f --commit
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { heartwoodSeed, planCompanyField } from "../../app/features/company.js";

export const LIVE_PROJECT = "heartwood-9f37f";
const ROOTS = [
  "users", "jobs", "receipts", "receiptChunks", "reimbursements", "reimbursementClaims",
  "timesheets", "leaveRequests", "swmsSignatures", "swmsChunks", "incidents", "invites",
  "inviteEmails", "inviteMail", "hoursExports", "xeroQueue", "runSheets", "photoInbox",
  "clients", "inbox", "quotes", "poLookups", "meta", "ownerSettings",
];
const TENANT_SUBS = ["chats", "fleet", "policies", "servicing", "servicePlans", "serviceCosts", "prestarts", "prestartTemplates", "chatSeen"];

export function parseMigrateArgs(argv = [], env = {}) {
  const flagged = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project" && argv[i + 1]) flagged.push(argv[++i]);
    else if (String(argv[i] || "").startsWith("--project=")) flagged.push(String(argv[i]).slice("--project=".length));
  }
  const explicit = flagged[0] || "";
  if (env.GCLOUD_PROJECT === LIVE_PROJECT && explicit !== LIVE_PROJECT) {
    return { ok: false, reason: "explicit-project" };
  }
  const project = explicit || "demo-heartwood";
  const commit = argv.includes("--commit");
  const live = project === LIVE_PROJECT;
  if (live && env.FIRESTORE_EMULATOR_HOST) return { ok: false, reason: "emulator-host" };
  if (!live && !env.FIRESTORE_EMULATOR_HOST) return { ok: false, reason: "emulator-required" };
  return { ok: true, project, commit, live, mode: commit ? "commit" : "dry-run" };
}

function clientStore(db) {
  const row = item => ({ path: item.ref.path, id: item.id, data: item.data() });
  return {
    async list(name) {
      const snap = await getDocs(collection(db, name));
      return snap.docs.map(row);
    },
    async listGroup(name) {
      const snap = await getDocs(collectionGroup(db, name));
      return snap.docs.map(row);
    },
    async update(path, data) { await updateDoc(doc(db, path), data); },
    async get(path) {
      const snap = await getDoc(doc(db, path));
      return snap.exists() ? snap.data() : null;
    },
    async set(path, data) { await setDoc(doc(db, path), data); },
  };
}

function adminStore(db) {
  const row = item => ({ path: item.ref.path, id: item.id, data: item.data() });
  return {
    async list(name) {
      const snap = await db.collection(name).get();
      return snap.docs.map(row);
    },
    async listGroup(name) {
      const snap = await db.collectionGroup(name).get();
      return snap.docs.map(row);
    },
    async update(path, data) { await db.doc(path).update(data); },
    async get(path) {
      const snap = await db.doc(path).get();
      return snap.exists ? snap.data() : null;
    },
    async set(path, data) { await db.doc(path).set(data); },
  };
}

export async function migrateCompanyIds(db, { commit = false, now = new Date(), store = null } = {}) {
  const io = store || clientStore(db);
  const report = { commit: !!commit, add: [], keep: [], company: "unchanged", counts: { users: 0, jobs: 0 } };
  async function take(items, pathCompanyOf, collectionName) {
    for (const item of items) {
      const plan = planCompanyField(item.data, pathCompanyOf(item));
      if (plan.action === "add") {
        report.add.push({ path: item.path, companyId: plan.companyId });
        if (commit) await io.update(item.path, { companyId: plan.companyId });
      } else if (plan.action === "keep") {
        report.keep.push(item.path);
      }
      if (collectionName === "users" && plan.companyId === "heartwood") report.counts.users += 1;
      if (collectionName === "jobs" && plan.companyId === "heartwood") report.counts.jobs += 1;
    }
  }
  for (const name of ROOTS) {
    let items = [];
    try { items = await io.list(name); } catch { items = []; }
    await take(items, () => "", name);
  }
  let tenants = [];
  try { tenants = await io.list("tenants"); } catch { tenants = []; }
  for (const tenant of tenants) {
    const plan = planCompanyField(tenant.data, tenant.id);
    if (plan.action === "add") {
      report.add.push({ path: tenant.path, companyId: plan.companyId });
      if (commit) await io.update(tenant.path, { companyId: plan.companyId });
    }
  }
  for (const name of [...TENANT_SUBS, "messages"]) {
    let items = [];
    try { items = await io.listGroup(name); } catch { continue; }
    await take(items, item => {
      const parts = item.path.split("/");
      return parts[0] === "tenants" ? parts[1] : "";
    }, "");
  }
  const heartwoodUsers = report.add.filter(r => r.path.startsWith("users/") && r.companyId === "heartwood").length
    + report.keep.filter(p => p.startsWith("users/")).length;
  const heartwoodJobs = report.add.filter(r => r.path.startsWith("jobs/") && r.companyId === "heartwood").length
    + report.keep.filter(p => p.startsWith("jobs/")).length;
  const seed = heartwoodSeed(now);
  seed.staffCount = heartwoodUsers;
  seed.jobCount = heartwoodJobs;
  const existing = await io.get("companies/heartwood");
  if (!existing) {
    report.company = "create";
    report.companyFields = Object.keys(seed);
    if (commit) await io.set("companies/heartwood", seed);
  } else {
    const patch = {};
    for (const [key, value] of Object.entries(seed)) {
      if (!(key in existing)) patch[key] = value;
    }
    report.company = Object.keys(patch).length ? "fill-missing" : "present";
    report.companyFields = Object.keys(patch);
    if (commit && Object.keys(patch).length) await io.update("companies/heartwood", patch);
  }
  return report;
}

async function productionStore() {
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ projectId: LIVE_PROJECT });
  return adminStore(getFirestore());
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
    console.error((parsed.commit ? "PRODUCTION WRITE" : "PRODUCTION DRY RUN") + " " + LIVE_PROJECT + ". Add-only. companyId is set only where it is missing.");
    const store = await productionStore();
    report = await migrateCompanyIds(null, { commit: parsed.commit, store });
  } else {
    const env = await initializeTestEnvironment({
      projectId: parsed.project,
      firestore: { rules: readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8") },
    });
    await env.withSecurityRulesDisabled(async ctx => {
      report = await migrateCompanyIds(ctx.firestore(), { commit: parsed.commit });
    });
    await env.cleanup();
  }
  console.log(JSON.stringify({ ...report, mode: parsed.mode, project: parsed.project }, null, 2));
}

const isMain = process.argv[1] && process.argv[1].endsWith("migrate-company-id.mjs");
if (isMain) main().catch(err => { console.error(err); process.exit(1); });
