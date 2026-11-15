// Daily sweep for paused CallUp companies. DRY_RUN defaults to true: it logs what it would
// delete and does not write mail, backups, or deletions until PAUSE_DELETE_DRY_RUN=false.
// Does not call Stripe. Warning email is a mail/{id} queue document only.
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import {
  authUserDeletable, pauseDeleteIsDryRun, runPauseRetention, storagePrefixes,
} from "./billing/pause-retention.js";

const REGION = "australia-southeast1";
const TOP_LEVEL = [
  "jobs", "jobMoney", "quotes", "timesheets", "leaveRequests", "reimbursementClaims",
  "receipts", "incidents", "swmsSignatures", "invites", "hoursExports", "liveLocations",
  "runSheets", "clients", "inbox",
];
const COMPANY_SUBS = ["leaveRequests", "reimbursementClaims", "liveLocations"];

function ensureAdmin() {
  if (!getApps().some(a => a.name === "[DEFAULT]")) initializeApp();
}

function plain(data) {
  if (data == null || typeof data !== "object") return data;
  const out = Array.isArray(data) ? [] : {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value.toDate === "function") out[key] = value.toDate().toISOString();
    else if (value && typeof value === "object" && !Array.isArray(value)) out[key] = plain(value);
    else out[key] = value;
  }
  return out;
}

async function docsOf(querySnap) {
  const rows = [];
  querySnap.forEach(docSnap => rows.push({ path: docSnap.ref.path, data: plain(docSnap.data()) }));
  return rows;
}

export async function collectPausedCompany(db, companyId, company) {
  const groups = { company: plain(company) };
  for (const name of TOP_LEVEL) {
    const snap = await db.collection(name).where("companyId", "==", companyId).get();
    groups[name] = await docsOf(snap);
  }
  const users = await db.collection("users").where("companyId", "==", companyId).get();
  groups.users = await docsOf(users);
  groups.companySubs = {};
  for (const sub of COMPANY_SUBS) {
    const snap = await db.collection("companies").doc(companyId).collection(sub).get();
    groups.companySubs[sub] = await docsOf(snap);
  }
  groups.tenantSubs = {};
  const tenantCols = await db.collection("tenants").doc(companyId).listCollections();
  for (const col of tenantCols) {
    const snap = await col.get();
    groups.tenantSubs[col.id] = await docsOf(snap);
  }
  return { companyId, collectedAt: new Date().toISOString(), groups };
}

async function deleteDocs(db, rows) {
  for (const row of rows || []) {
    if (row && row.path) await db.doc(row.path).delete().catch(() => {});
  }
}

export async function deletePausedCompany({ db, auth, bucket, companyId, snapshot }) {
  const groups = (snapshot && snapshot.groups) || {};
  const users = groups.users || [];
  for (const row of users) {
    const uid = row.path && row.path.startsWith("users/") ? row.path.slice("users/".length) : "";
    if (!authUserDeletable(uid, row.data, companyId)) continue;
    await auth.deleteUser(uid).catch(err => console.warn("pause auth delete", uid, err && err.message));
  }
  for (const name of TOP_LEVEL) await deleteDocs(db, groups[name]);
  await deleteDocs(db, users);
  for (const rows of Object.values(groups.companySubs || {})) await deleteDocs(db, rows);
  for (const rows of Object.values(groups.tenantSubs || {})) await deleteDocs(db, rows);
  if (bucket) {
    for (const prefix of storagePrefixes(companyId)) {
      const [files] = await bucket.getFiles({ prefix });
      for (const file of files || []) {
        if (String(file.name || "").startsWith("pauseBackups/")) continue;
        await file.delete().catch(err => console.warn("pause storage delete", file.name, err && err.message));
      }
    }
  }
  await db.collection("companies").doc(companyId).delete();
}

export function buildPauseRetentionDeps({ db, auth, bucket, log, dryRun, now }) {
  return {
    now,
    dryRun,
    log,
    listCompanies: async () => {
      const snap = await db.collection("companies").get();
      return snap.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() || {} }));
    },
    loadCompany: async id => {
      const snap = await db.collection("companies").doc(id).get();
      return { id, data: snap.exists ? (snap.data() || {}) : null };
    },
    queueMail: async mail => {
      await db.collection(mail.collection || "mail").add({
        ...mail.doc,
        createdAt: FieldValue.serverTimestamp(),
      });
    },
    markWarning: async (id, days, at) => {
      const field = days === 1 ? "pauseWarning1At" : "pauseWarning7At";
      await db.collection("companies").doc(id).update({ [field]: new Date(at).toISOString() });
    },
    collect: (id, company) => collectPausedCompany(db, id, company),
    writeBackup: async (path, snapshot) => {
      await bucket.file(path).save(JSON.stringify(snapshot), {
        contentType: "application/json",
        resumable: false,
        metadata: { metadata: { purpose: "pause-backup", companyId: snapshot.companyId || "" } },
      });
    },
    deleteCompany: (id, snapshot) => deletePausedCompany({ db, auth, bucket, companyId: id, snapshot }),
  };
}

export const pauseRetentionSweep = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "Australia/Brisbane",
    region: REGION,
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    if (process.env.NODE_TEST_CONTEXT) return;
    ensureAdmin();
    const dryRun = pauseDeleteIsDryRun(process.env);
    const db = getFirestore();
    const deps = buildPauseRetentionDeps({
      db,
      auth: getAuth(),
      bucket: getStorage().bucket(),
      log: line => console.log(line),
      dryRun,
      now: Date.now(),
    });
    const results = await runPauseRetention(deps);
    console.log("pause-retention", dryRun ? "dry-run" : "live", results.length);
  },
);
