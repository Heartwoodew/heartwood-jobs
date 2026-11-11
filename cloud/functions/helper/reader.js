// Admin SDK reads. Firestore rules do not apply here.
// This module only exposes get/query. It has no write method.

// Job money (PO value, accepted-quote total) lives in jobMoney/{jobId} (round 3, Q6); merge it over the job
// so office answers keep working. projectJob still drops it for logins that may not see money.
const JOB_MONEY_KEYS = ["poAmount", "poAmountBasis", "poAmountSource", "quoteAmount"];
async function withMoney(db, jobs) {
  if (!jobs.length || typeof db.getAll !== "function") return jobs;
  const snaps = await db.getAll(...jobs.map(job => db.collection("jobMoney").doc(job.id)));
  return jobs.map((job, i) => {
    const money = snaps[i] && snaps[i].exists ? snaps[i].data() : null;
    if (!money) return job;
    const out = { ...job };
    for (const key of JOB_MONEY_KEYS) if (key in money) out[key] = money[key];
    return out;
  });
}

export function adminReader(db) {
  const rows = (snap) => snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return {
    async user(uid) {
      const snap = await db.collection("users").doc(uid).get();
      return snap.exists ? snap.data() : null;
    },
    async jobs({ assignedUid, limit }) {
      let query = db.collection("jobs");
      if (assignedUid) query = query.where("assigned", "array-contains", assignedUid);
      const snap = await query.limit(limit).get();
      return withMoney(db, rows(snap));
    },
    async job(id) {
      const snap = await db.collection("jobs").doc(id).get();
      return snap.exists ? (await withMoney(db, [{ id: snap.id, ...snap.data() }]))[0] : null;
    },
    async quotes({ limit }) {
      const snap = await db.collection("quotes").limit(limit).get();
      return rows(snap);
    },
    async receipts({ limit }) {
      const snap = await db.collection("receipts").limit(limit).get();
      return rows(snap);
    },
    async meta(id) {
      const snap = await db.collection("meta").doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    async runSheets({ limit }) {
      const snap = await db.collection("runSheets").limit(limit).get();
      return rows(snap);
    },
    async fleet({ limit }) {
      const snap = await db.collectionGroup("fleet").limit(limit).get();
      return rows(snap);
    },
    async servicing({ limit }) {
      const snap = await db.collectionGroup("servicing").limit(limit).get();
      return rows(snap);
    },
    async serviceCosts({ limit }) {
      const snap = await db.collectionGroup("serviceCosts").limit(limit).get();
      return rows(snap);
    },
    async timesheets({ limit }) {
      const snap = await db.collection("timesheets").limit(limit).get();
      return rows(snap);
    },
    async leaveRequests({ limit }) {
      const snap = await db.collection("leaveRequests").limit(limit).get();
      return rows(snap);
    },
    async prestarts({ limit }) {
      const snap = await db.collectionGroup("prestarts").limit(limit).get();
      return rows(snap);
    },
    async invites({ limit }) {
      const snap = await db.collection("invites").limit(limit).get();
      return rows(snap);
    },
  };
}
