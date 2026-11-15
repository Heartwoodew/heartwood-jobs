// Phone notifications for chat and the morning job list.
// Chat: a new message document wakes this. The sender is not notified.
// Jobs: 06:00 Australia/Brisbane, one note per person who has work that day.
// A later change to today's list sends at most one "Your jobs changed".
// Retention is not scheduled here. Deploy is still blocked by refuse-live-deploy.js.
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { dispatchChatPush, jobCompany } from "./chat-push.js";
import {
  affectedUids, brisbaneDate, companySkipped, digestDocId, dispatchDailyChange, dispatchDailyJobs,
  scheduleFieldsChanged,
} from "./daily-jobs.js";

const REGION = "australia-southeast1";

function hasDefaultApp() { return getApps().some(a => a.name === "[DEFAULT]"); }
function ensureAdmin() {
  if (!hasDefaultApp()) initializeApp();
}

function personFrom(uid, userSnap, prefsSnap, tokenDocs) {
  const prefs = prefsSnap && prefsSnap.exists ? (prefsSnap.data() || {}) : {};
  return {
    uid,
    profile: userSnap && userSnap.exists ? userSnap.data() : null,
    muteChat: prefs.muteChat === true,
    muteDaily: prefs.muteDaily === true,
    tokens: tokenDocs.map(docSnap => {
      const data = docSnap.data() || {};
      return { id: docSnap.id, token: data.token, companyId: data.companyId, origin: data.origin };
    }),
  };
}

async function loadChatPeople(db, companyId) {
  const snap = await db.collectionGroup("fcmTokens").where("companyId", "==", companyId).get();
  const grouped = new Map();
  snap.forEach(docSnap => {
    const parent = docSnap.ref.parent && docSnap.ref.parent.parent;
    const uid = parent && parent.id;
    if (!uid) return;
    if (!grouped.has(uid)) grouped.set(uid, []);
    grouped.get(uid).push(docSnap);
  });
  const people = [];
  for (const [uid, docs] of grouped) {
    const userRef = db.collection("users").doc(uid);
    const [userSnap, prefsSnap] = await Promise.all([
      userRef.get(),
      userRef.collection("chatSettings").doc("prefs").get(),
    ]);
    people.push(personFrom(uid, userSnap, prefsSnap, docs));
  }
  return people;
}

async function loadOnePerson(db, uid) {
  const userRef = db.collection("users").doc(uid);
  const [userSnap, prefsSnap, tokenSnap] = await Promise.all([
    userRef.get(),
    userRef.collection("chatSettings").doc("prefs").get(),
    userRef.collection("fcmTokens").get(),
  ]);
  return personFrom(uid, userSnap, prefsSnap, tokenSnap.docs);
}

async function loadDailyCompanies(db) {
  const snap = await db.collection("companies").get();
  return snap.docs.map(docSnap => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
}

async function loadDailyJobs(db, companyId, date) {
  const snap = await db.collection("jobs").where("companyId", "==", companyId).where("date", "==", date).get();
  const rows = snap.docs.map(docSnap => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
  if (companyId !== "heartwood") return rows;
  // Heartwood jobs written before companyId existed still belong to Heartwood.
  const legacy = await db.collection("jobs").where("date", "==", date).get();
  const seen = new Set(rows.map(job => job.id));
  legacy.forEach(docSnap => {
    if (seen.has(docSnap.id)) return;
    const data = docSnap.data() || {};
    if (data.companyId) return;
    if (data.tenantId && data.tenantId !== "heartwood") return;
    rows.push({ id: docSnap.id, ...data, companyId: "heartwood" });
  });
  return rows;
}

async function loadRunSheet(db, uid, date, companyId) {
  if (!/^[A-Za-z0-9]{1,128}$/.test(String(uid || ""))) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return null;
  const snap = await db.collection("runSheets").doc(`${uid}_${date}`).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const company = typeof data.companyId === "string" ? data.companyId.trim() : "";
  if (company && company !== companyId) return null;
  if (!company && companyId !== "heartwood") return null;
  return data;
}

async function claimDailyDigest(db, digest) {
  try {
    await db.collection("dailyJobDigest").doc(digest.id).create({
      companyId: digest.companyId,
      date: digest.date,
      uid: digest.uid,
      jobIds: digest.jobIds,
      fingerprint: digest.fingerprint,
      updateSent: false,
      sentAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch (err) {
    const code = err && (err.code || err.message);
    if (code === 6 || code === "already-exists" || code === "ALREADY_EXISTS") return false;
    throw err;
  }
}

async function claimDailyUpdate(db, patch) {
  const ref = db.collection("dailyJobDigest").doc(patch.id);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data() || {};
    if (data.updateSent === true) return false;
    if (data.fingerprint === patch.fingerprint) return false;
    tx.set(ref, {
      fingerprint: patch.fingerprint,
      jobIds: patch.jobIds,
      updateSent: true,
      updateAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

function deleteToken(db, target) {
  return db.collection("users").doc(target.uid).collection("fcmTokens").doc(target.tokenId).delete();
}

export const chatMessagePush = onDocumentCreated(
  {
    document: "tenants/{tenantId}/chats/{threadId}/messages/{messageId}",
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    if (process.env.NODE_TEST_CONTEXT) return;
    const snap = event.data;
    if (!snap) return;
    const message = snap.data() || {};
    const { tenantId, threadId } = event.params;
    ensureAdmin();
    const db = getFirestore();
    const result = await dispatchChatPush({
      tenantId,
      threadId,
      message,
      loadJob: async (jobId) => {
        const jobSnap = await db.collection("jobs").doc(jobId).get();
        return jobSnap.exists ? { id: jobSnap.id, ...jobSnap.data() } : null;
      },
      loadPeople: () => loadChatPeople(db, tenantId),
      sendEach: (messages) => getMessaging().sendEach(messages),
      deleteToken: (target) => deleteToken(db, target),
    });
    console.log("chat push", tenantId, threadId, result.sent, result.dropped, result.skipped || "");
  },
);

export const dailyJobPush = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "Australia/Brisbane",
    region: REGION,
    timeoutSeconds: 300,
    memory: "256MiB",
  },
  async () => {
    if (process.env.NODE_TEST_CONTEXT) return;
    ensureAdmin();
    const db = getFirestore();
    const date = brisbaneDate(new Date());
    const result = await dispatchDailyJobs({
      date,
      loadCompanies: () => loadDailyCompanies(db),
      loadJobs: (companyId, day) => loadDailyJobs(db, companyId, day),
      loadPeople: companyId => loadChatPeople(db, companyId),
      loadRunSheet: (uid, day, companyId) => loadRunSheet(db, uid, day, companyId),
      claim: digest => claimDailyDigest(db, digest),
      sendEach: messages => getMessaging().sendEach(messages),
      deleteToken: target => deleteToken(db, target),
    });
    console.log("daily jobs", date, result.sent, result.skipped, result.dropped);
  },
);

export const dailyJobChangePush = onDocumentWritten(
  { document: "jobs/{jobId}", region: REGION, timeoutSeconds: 60, memory: "256MiB" },
  async (event) => {
    if (process.env.NODE_TEST_CONTEXT) return;
    const beforeSnap = event.data && event.data.before;
    const afterSnap = event.data && event.data.after;
    const before = beforeSnap && beforeSnap.exists ? { id: event.params.jobId, ...beforeSnap.data() } : null;
    const after = afterSnap && afterSnap.exists ? { id: event.params.jobId, ...afterSnap.data() } : null;
    if (!scheduleFieldsChanged(before, after)) return;
    const date = brisbaneDate(new Date());
    const companies = new Set();
    if (before && String(before.date || "") === date) companies.add(jobCompany(before));
    if (after && String(after.date || "") === date) companies.add(jobCompany(after));
    if (!companies.size) return;
    ensureAdmin();
    const db = getFirestore();
    for (const companyId of companies) {
      if (!companyId) continue;
      const companySnap = await db.collection("companies").doc(companyId).get();
      if (companySnap.exists && companySkipped(companySnap.data())) continue;
      const uids = affectedUids(before, after, date, companyId);
      if (!uids.length) continue;
      const jobs = await loadDailyJobs(db, companyId, date);
      for (const uid of uids) {
        const person = await loadOnePerson(db, uid);
        person.sheet = await loadRunSheet(db, uid, date, companyId);
        const digestId = digestDocId(companyId, date, uid);
        const existingSnap = await db.collection("dailyJobDigest").doc(digestId).get();
        const result = await dispatchDailyChange({
          companyId,
          date,
          uid,
          jobs,
          person,
          existing: existingSnap.exists ? existingSnap.data() : null,
          claimUpdate: patch => claimDailyUpdate(db, patch),
          sendEach: messages => getMessaging().sendEach(messages),
          deleteToken: target => deleteToken(db, target),
        });
        if (result.sent || result.skipped === "send") console.log("daily change", companyId, result.sent, result.skipped || "");
      }
    }
  },
);
