// Claims an accepted staff invite and marks its lock accepted.
// Every read in the transaction runs before any write. Firestore rejects a read after a write.
import { FieldValue } from "firebase-admin/firestore";
import { displayStatus, inviteLockId, profileFromInvite } from "./shared/staff-invites.js";

export async function claimInviteDocument(db, id, uid, now) {
  return db.runTransaction(async tx => {
    const ref = db.collection("invites").doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "invalid" };
    const invite = snap.data() || {};
    const status = displayStatus(invite, now);
    if (status !== "pending") return { ok: false, reason: status === "invalid" ? "invalid" : status };
    if (!profileFromInvite(invite)) return { ok: false, reason: "invalid" };
    const company = invite.tenantId || invite.companyId || "heartwood";
    const legacyRef = db.collection("inviteEmails").doc(invite.email);
    const legacy = await tx.get(legacyRef);
    tx.update(ref, {
      status: "accepted",
      acceptedUid: uid,
      acceptedAt: FieldValue.serverTimestamp(),
    });
    const lock = {
      email: invite.email,
      status: "accepted",
      inviteId: id,
      role: invite.role,
      expiresAt: invite.expiresAt,
    };
    if (invite.tenantId) lock.tenantId = invite.tenantId;
    tx.set(db.collection("inviteEmails").doc(inviteLockId(company, invite.email)), lock, { merge: true });
    if (legacy.exists && (legacy.data() || {}).inviteId === id) tx.set(legacyRef, lock, { merge: true });
    return { ok: true };
  });
}
