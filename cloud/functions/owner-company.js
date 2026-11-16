// Admin SDK side of an owner company deletion. The checks live in billing/owner-company.js.
// Clients cannot call Firestore or Storage deletes for this. The callable checks the platform owner.
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import {
  COMPANY_DELETE_COLLECTIONS,
  runOwnerCompanyDeletion,
} from "./billing/owner-company.js";

function singletonPaths(companyId) {
  return [
    `companyTrades/${companyId}`,
    `take5Settings/${companyId}`,
    `performanceSettings/${companyId}`,
    `companyMeta/${companyId}`,
    `companyMeta/${companyId}_dispatch`,
  ];
}

export async function listCandidateDocs(db, companyId) {
  const rows = [];
  const seen = new Set();
  const add = (collection, snap) => {
    snap.forEach(docSnap => {
      if (seen.has(docSnap.ref.path)) return;
      seen.add(docSnap.ref.path);
      rows.push({
        path: docSnap.ref.path,
        id: docSnap.id,
        collection,
        data: docSnap.data() || {},
      });
    });
  };
  for (const name of COMPANY_DELETE_COLLECTIONS) {
    add(name, await db.collection(name).where("companyId", "==", companyId).get());
    add(name, await db.collection(name).where("tenantId", "==", companyId).get());
  }
  for (const path of singletonPaths(companyId)) {
    const snap = await db.doc(path).get();
    if (!snap.exists || seen.has(path)) continue;
    seen.add(path);
    rows.push({
      path,
      id: snap.id,
      collection: path.split("/")[0],
      data: snap.data() || {},
    });
  }
  const company = await db.doc(`companies/${companyId}`).get();
  if (company.exists && !seen.has(company.ref.path)) {
    rows.push({
      path: company.ref.path,
      id: company.id,
      collection: "companies",
      data: company.data() || {},
    });
  }
  const tenant = await db.doc(`tenants/${companyId}`).get();
  if (tenant.exists) {
    rows.push({
      path: tenant.ref.path,
      id: tenant.id,
      collection: "tenants",
      data: tenant.data() || {},
    });
  }
  return rows;
}

async function countTree(ref) {
  let n = 0;
  const cols = await ref.listCollections();
  for (const col of cols) {
    const snap = await col.get();
    n += snap.size;
    for (const docSnap of snap.docs) n += await countTree(docSnap.ref);
  }
  return n;
}

async function deleteStorageObjects(bucket, { prefixes, paths }) {
  if (!bucket) return { deleted: 0, failed: 0 };
  let deleted = 0;
  let failed = 0;
  const seen = new Set();
  const remove = async (file, name) => {
    if (!name || seen.has(name) || name.includes("..")) return;
    seen.add(name);
    try {
      await file.delete();
      deleted += 1;
    } catch (err) {
      if (err && (err.code === 404 || err.code === "404")) deleted += 1;
      else {
        failed += 1;
        console.warn("company delete storage", name, err && err.message);
      }
    }
  };
  for (const prefix of prefixes || []) {
    if (!prefix || prefix.includes("..") || /(^|\/)heartwood(\/|$)/.test(prefix)) continue;
    const [files] = await bucket.getFiles({ prefix });
    for (const file of files || []) {
      const name = String(file.name || "");
      if (!name.startsWith(prefix)) continue;
      await remove(file, name);
    }
  }
  for (const path of paths || []) {
    if (!path || !path.startsWith("hoursExports/") || path.includes("..")) continue;
    await remove(bucket.file(path), path);
  }
  return { deleted, failed };
}

async function removeAuthUser(authApi, uid) {
  try {
    await authApi.deleteUser(uid);
    return "deleted";
  } catch (err) {
    if (err && err.code === "auth/user-not-found") return "deleted";
    try {
      await authApi.updateUser(uid, { disabled: true });
      return "disabled";
    } catch (disableErr) {
      console.warn("company delete auth", uid, disableErr && disableErr.message);
      return "kept";
    }
  }
}

export async function deleteCompanyAccountData({
  db, authApi, bucket, companyId, confirmName, auth, cancelSubscription, now,
}) {
  const database = db || getFirestore();
  const users = authApi || getAuth();
  const store = bucket || getStorage().bucket();
  return runOwnerCompanyDeletion({
    auth,
    companyId,
    confirmName,
    now,
    cancelSubscription,
    loadCompany: async id => {
      const snap = await database.collection("companies").doc(id).get();
      return { id, data: snap.exists ? (snap.data() || {}) : null };
    },
    loadCallerProfile: async uid => {
      if (!uid) return null;
      const snap = await database.collection("users").doc(uid).get();
      return snap.exists ? (snap.data() || {}) : null;
    },
    listCandidateDocs: id => listCandidateDocs(database, id),
    deleteDoc: async path => {
      await database.recursiveDelete(database.doc(path));
    },
    deleteTree: async id => {
      const tenantRef = database.doc(`tenants/${id}`);
      const companyRef = database.doc(`companies/${id}`);
      const tenantSnap = await tenantRef.get();
      const nested = (await countTree(tenantRef)) + (await countTree(companyRef));
      await database.recursiveDelete(tenantRef);
      await database.recursiveDelete(companyRef);
      return nested + 1 + (tenantSnap.exists ? 1 : 0);
    },
    deleteStorage: spec => deleteStorageObjects(store, spec),
    deleteAuthUser: uid => removeAuthUser(users, uid),
    writeAudit: async audit => {
      await database.collection(audit.collection).doc(audit.id).set(audit.data);
    },
  });
}
