// Clock On reminder. Every 15 minutes, UTC. clock-on-reminder.js decides which
// companies are at 06:30 on a local weekday. Australia/Brisbane is the default
// zone when the company document has no timezone. The cron is not limited to
// Mon–Fri in Brisbane: a company west of Brisbane can still be on Friday
// morning after Brisbane has reached Saturday. The selector enforces the
// local weekday. One claim per person per local date, so the 06:45 tick
// does not send a second copy.
// Deploy is still blocked by refuse-live-deploy.js. This file does not send
// anything unless Cloud Scheduler invokes clockOnReminderPush.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logPushException } from "./chat-push.js";
import { dispatchClockOnReminders } from "./clock-on-reminder.js";

const REGION = "australia-southeast1";

function hasDefaultApp() { return getApps().some(app => app.name === "[DEFAULT]"); }
function ensureAdmin() {
  if (!hasDefaultApp()) initializeApp();
}

async function runPush(label, fn) {
  try {
    return await fn();
  } catch (err) {
    logPushException(label, err);
    throw err;
  }
}

function personFrom(uid, userSnap, prefsSnap, tokenDocs) {
  const prefs = prefsSnap && prefsSnap.exists ? (prefsSnap.data() || {}) : {};
  return {
    uid,
    profile: userSnap && userSnap.exists ? userSnap.data() : null,
    muteClockOnReminder: prefs.muteClockOnReminder === true,
    tokens: tokenDocs.map(docSnap => {
      const data = docSnap.data() || {};
      return { id: docSnap.id, token: data.token, companyId: data.companyId, origin: data.origin };
    }),
  };
}

async function loadCompanies(db) {
  const snap = await db.collection("companies").get();
  return snap.docs.map(docSnap => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
}

async function loadPeople(db, companyId) {
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

function sheetRef(db, uid, week) {
  if (!/^[A-Za-z0-9]{1,128}$/.test(String(uid || ""))) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(week || ""))) return null;
  return db.collection("timesheets").doc(`${uid}_${week}`);
}

async function loadSheet(db, uid, week) {
  const ref = sheetRef(db, uid, week);
  if (!ref) return null;
  const snap = await ref.get();
  return snap.exists ? snap.data() || null : null;
}

async function loadLive(db, companyId, uid) {
  if (!/^[A-Za-z0-9]{1,128}$/.test(String(uid || ""))) return null;
  const ref = companyId === "heartwood"
    ? db.collection("liveLocations").doc(uid)
    : db.collection("companies").doc(companyId).collection("liveLocations").doc(uid);
  const snap = await ref.get();
  return snap.exists ? snap.data() || null : null;
}

async function loadLeave(db, companyId) {
  const snap = await db.collection("leaveRequests").where("companyId", "==", companyId).get();
  return snap.docs.map(docSnap => docSnap.data() || {});
}

async function claimReminder(db, reminder) {
  try {
    await db.collection("clockOnReminders").doc(reminder.id).create({
      companyId: reminder.companyId,
      date: reminder.date,
      uid: reminder.uid,
      timeZone: reminder.timeZone,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch (err) {
    const code = err && (err.code || err.message);
    if (code === 6 || code === "already-exists" || code === "ALREADY_EXISTS") return false;
    throw err;
  }
}

function deleteToken(db, target) {
  return db.collection("users").doc(target.uid).collection("fcmTokens").doc(target.tokenId).delete();
}

export const clockOnReminderPush = onSchedule(
  {
    schedule: "*/15 * * * *",
    timeZone: "UTC",
    region: REGION,
    timeoutSeconds: 300,
    memory: "256MiB",
  },
  async () => {
    if (process.env.NODE_TEST_CONTEXT) return;
    await runPush("clock on", async () => {
      ensureAdmin();
      const db = getFirestore();
      const now = new Date();
      const result = await dispatchClockOnReminders({
        now,
        loadCompanies: () => loadCompanies(db),
        loadPeople: companyId => loadPeople(db, companyId),
        loadSheet: (uid, week) => loadSheet(db, uid, week),
        loadLive: (companyId, uid) => loadLive(db, companyId, uid),
        loadLeave: companyId => loadLeave(db, companyId),
        claim: reminder => claimReminder(db, reminder),
        sendEach: messages => getMessaging().sendEach(messages),
        deleteToken: target => deleteToken(db, target),
      });
      console.log("clock on", "sent", result.sent, "skipped", result.skipped, "dropped", result.dropped, "companies", result.companies.join(","));
    });
  },
);
