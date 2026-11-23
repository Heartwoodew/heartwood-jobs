// Upcoming visits for a repeating job. Runs when the template is saved and once
// a day, for a rolling 60 days. The occurrence id is fixed, so a second run does
// not add a duplicate. Edited and skipped visits are not overwritten.
// Do not deploy from this branch.
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { planSeries } from "./shared/recurrence.js";

const REGION = "australia-southeast1";

function ensureAdmin() {
  if (!getApps().some(app => app.name === "[DEFAULT]")) initializeApp();
}

function brisbaneToday(now = Date.now()) {
  return new Date(now + 10 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function applySeriesPlan(db, template, today) {
  if (!template || !template.seriesId || !template.recurrence || template.seriesRole === "occurrence") return { created: 0, updated: 0 };
  const snap = await db.collection("jobs").where("seriesId", "==", template.seriesId).limit(120).get();
  const existing = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const plan = planSeries({ template, existing, today });
  let created = 0;
  let updated = 0;
  for (const row of plan.creates) {
    const ref = db.collection("jobs").doc(row.id);
    const current = await ref.get();
    if (current.exists) continue;
    await ref.set({
      ...row.data,
      companyId: template.companyId || "heartwood",
      tenantId: template.tenantId || template.companyId || "heartwood",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    created += 1;
  }
  for (const row of plan.updates) {
    await db.collection("jobs").doc(row.id).set({ ...row.data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    updated += 1;
  }
  return { created, updated };
}

export const recurrenceOnSave = onDocumentWritten(
  { document: "jobs/{jobId}", region: REGION },
  async (event) => {
    if (process.env.NODE_TEST_CONTEXT) return;
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    if (!after || after.seriesRole === "occurrence" || !after.recurrence || !after.seriesId) return;
    ensureAdmin();
    await applySeriesPlan(getFirestore(), { id: event.params.jobId, ...after }, brisbaneToday());
  },
);

export const recurrenceSweep = onSchedule(
  { schedule: "every day 02:10", timeZone: "Australia/Brisbane", region: REGION },
  async () => {
    if (process.env.NODE_TEST_CONTEXT) return;
    ensureAdmin();
    const db = getFirestore();
    const snap = await db.collection("jobs").where("seriesRole", "==", "template").limit(200).get();
    const today = brisbaneToday();
    for (const doc of snap.docs) {
      await applySeriesPlan(db, { id: doc.id, ...doc.data() }, today);
    }
  },
);
