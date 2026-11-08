// Backfill companyId. Adds fields only. Never deletes. Never overwrites companyId.
// Default is dry-run. Refuses the live project heartwood-9f37f.
// Requires the Firestore emulator. Do not point this at production.
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { heartwoodSeed, planCompanyField } from "../../app/features/company.js";

const LIVE_PROJECT = "heartwood-9f37f";
const ROOTS = [
  "users", "jobs", "receipts", "receiptChunks", "reimbursements", "reimbursementClaims",
  "timesheets", "leaveRequests", "swmsSignatures", "swmsChunks", "incidents", "invites",
  "inviteEmails", "inviteMail", "hoursExports", "xeroQueue", "runSheets", "photoInbox",
  "clients", "inbox", "quotes", "poLookups", "meta", "ownerSettings",
];
const TENANT_SUBS = ["chats", "fleet", "policies", "servicing", "servicePlans", "serviceCosts", "prestarts", "prestartTemplates", "chatSeen"];

function projectId() {
  const fromArg = process.argv.find(a => a.startsWith("--project="));
  return (fromArg && fromArg.slice("--project=".length)) || process.env.GCLOUD_PROJECT || "demo-heartwood";
}

export async function migrateCompanyIds(db, { commit = false, now = new Date() } = {}) {
  const report = { commit: !!commit, add: [], keep: [], company: "unchanged", counts: { users: 0, jobs: 0 } };
  async function walk(colRef, pathCompany = "") {
    let snap;
    try { snap = await getDocs(colRef); } catch { return; }
    for (const item of snap.docs) {
      const plan = planCompanyField(item.data(), pathCompany);
      if (plan.action === "add") {
        report.add.push({ path: item.ref.path, companyId: plan.companyId });
        if (commit) await updateDoc(item.ref, { companyId: plan.companyId });
      } else if (plan.action === "keep") {
        report.keep.push(item.ref.path);
      }
      if (colRef.path === "users" && plan.companyId === "heartwood") report.counts.users += 1;
      if (colRef.path === "jobs" && (plan.companyId === "heartwood" || plan.action === "keep" && plan.companyId === "heartwood" || plan.action === "add" && plan.companyId === "heartwood")) {
        report.counts.jobs += 1;
      }
    }
    return snap;
  }
  for (const name of ROOTS) await walk(collection(db, name));
  const tenants = await getDocs(collection(db, "tenants")).catch(() => null);
  if (tenants) {
    for (const tenant of tenants.docs) {
      const plan = planCompanyField(tenant.data(), tenant.id);
      if (plan.action === "add") {
        report.add.push({ path: tenant.ref.path, companyId: plan.companyId });
        if (commit) await updateDoc(tenant.ref, { companyId: plan.companyId });
      }
    }
  }
  // Subcollections exist even when the parent tenant document does not.
  for (const name of [...TENANT_SUBS, "messages"]) {
    let snap;
    try { snap = await getDocs(collectionGroup(db, name)); } catch { continue; }
    for (const item of snap.docs) {
      const parts = item.ref.path.split("/");
      const pathCompany = parts[0] === "tenants" ? parts[1] : "";
      const plan = planCompanyField(item.data(), pathCompany);
      if (plan.action === "add") {
        report.add.push({ path: item.ref.path, companyId: plan.companyId });
        if (commit) await updateDoc(item.ref, { companyId: plan.companyId });
      } else if (plan.action === "keep") report.keep.push(item.ref.path);
    }
  }
  const heartwoodUsers = report.add.filter(r => r.path.startsWith("users/") && r.companyId === "heartwood").length
    + report.keep.filter(p => p.startsWith("users/")).length;
  const heartwoodJobs = report.add.filter(r => r.path.startsWith("jobs/") && r.companyId === "heartwood").length
    + report.keep.filter(p => p.startsWith("jobs/")).length;
  const seed = heartwoodSeed(now);
  seed.staffCount = heartwoodUsers;
  seed.jobCount = heartwoodJobs;
  const ref = doc(db, "companies/heartwood");
  const existing = await getDoc(ref);
  if (!existing.exists()) {
    report.company = "create";
    report.companyFields = Object.keys(seed);
    if (commit) await setDoc(ref, seed);
  } else {
    const patch = {};
    for (const [key, value] of Object.entries(seed)) {
      if (!(key in existing.data())) patch[key] = value;
    }
    report.company = Object.keys(patch).length ? "fill-missing" : "present";
    report.companyFields = Object.keys(patch);
    if (commit && Object.keys(patch).length) await updateDoc(ref, patch);
  }
  return report;
}

async function main() {
  const project = projectId();
  if (project === LIVE_PROJECT || process.argv.includes("--project") && process.argv.includes(LIVE_PROJECT)) {
    console.error("Refusing to run against " + LIVE_PROJECT + ". Use the emulator only.");
    process.exit(1);
  }
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.error("Refusing: FIRESTORE_EMULATOR_HOST is not set. This script never touches production.");
    process.exit(1);
  }
  const commit = process.argv.includes("--commit");
  const env = await initializeTestEnvironment({
    projectId: project,
    firestore: { rules: readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8") },
  });
  let report;
  await env.withSecurityRulesDisabled(async ctx => {
    report = await migrateCompanyIds(ctx.firestore(), { commit });
  });
  console.log(JSON.stringify({ ...report, mode: commit ? "commit" : "dry-run", project }, null, 2));
  await env.cleanup();
}

const isMain = process.argv[1] && process.argv[1].endsWith("migrate-company-id.mjs");
if (isMain) main().catch(err => { console.error(err); process.exit(1); });
