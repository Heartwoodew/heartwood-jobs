// Firestore writes for a confirmed Helper action.
// No deletes, no email, no Xero, no price fields, no Storage.

import { FieldValue } from "firebase-admin/firestore";
import { timesheetHours } from "./actions.js";
import { adminReader } from "./reader.js";

export function firestoreHelperStore(db) {
  return {
    reader: adminReader(db),
    async saveProposal(proposal) {
      await db.collection("helperProposals").doc(proposal.id).set(proposal);
    },
    async getProposal(id) {
      const snap = await db.collection("helperProposals").doc(String(id || "")).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    },
    async markProposal(id, patch) {
      await db.collection("helperProposals").doc(id).set(patch, { merge: true });
    },
    async audit(entry) {
      await db.collection("helperAudit").add(entry);
    },
    async apply(action) {
      if (action.type === "job-note") {
        await db.collection("jobs").doc(action.jobId).update({
          log: FieldValue.arrayUnion({ text: action.text, by: action.by, byName: action.byName, at: action.at }),
          updatedBy: action.by,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return;
      }
      if (action.type === "job-status") {
        const patch = {
          status: action.status,
          updatedBy: action.updatedBy,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (action.status === "In progress") patch.startedAt = FieldValue.serverTimestamp();
        if (action.status === "Done") {
          patch.completedAt = FieldValue.serverTimestamp();
          patch.completedBy = action.updatedBy;
          patch.completedByName = action.updatedByName;
        }
        await db.collection("jobs").doc(action.jobId).update(patch);
        return;
      }
      if (action.type === "job-draft") {
        await db.collection("jobs").add({
          client: action.client,
          address: action.address,
          type: action.jobType,
          description: action.description || "",
          status: "Scheduled",
          date: "",
          time: "",
          assigned: [],
          assignedNames: [],
          tenantId: action.tenantId,
          source: "app",
          log: [],
          editedInApp: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: action.createdBy,
        });
        return;
      }
      if (action.type === "quote-draft") {
        await db.collection("quotes").add({
          client: action.client,
          address: action.address,
          type: action.jobType,
          description: action.description || "",
          quoteStatus: "Draft",
          totalEx: null,
          lines: [],
          tenantId: action.tenantId,
          source: "app",
          createdBy: action.createdBy,
          createdByName: action.createdByName,
          createdAt: FieldValue.serverTimestamp(),
        });
        return;
      }
      if (action.type === "timesheet") {
        const ref = db.collection("timesheets").doc(`${action.uid}_${action.weekStart}`);
        const snap = await ref.get();
        const prev = snap.exists && snap.data().days ? snap.data().days : {};
        const days = {
          ...prev,
          [action.date]: { start: action.start, finish: action.finish, note: action.note || "" },
        };
        let total = 0;
        for (const day of Object.values(days)) total += timesheetHours(day.start, day.finish);
        await ref.set({
          uid: action.uid,
          weekStart: action.weekStart,
          weekEnd: action.weekEnd,
          days,
          totalHrs: Math.round(total * 100) / 100,
          updatedAtIso: new Date().toISOString(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return;
      }
      if (action.type === "chat") {
        const thread = db.collection("tenants").doc(action.tenantId).collection("chats").doc(action.threadId);
        await thread.collection("messages").add({
          senderUid: action.senderUid,
          senderName: action.senderName,
          text: action.text,
          createdAt: FieldValue.serverTimestamp(),
        });
        await thread.set({
          lastSenderUid: action.senderUid,
          lastSenderName: action.senderName,
          preview: String(action.text || "").slice(0, 140),
          lastAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return;
      }
      const err = new Error("not-allowed");
      err.code = "not-allowed";
      throw err;
    },
  };
}
