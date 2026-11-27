// Real acceptStaffInvite transaction against the Firestore emulator.
// The unit tests use an in-memory claim, which does not enforce read-before-write.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { claimInviteDocument } from "../functions/invite-claim.js";
import { firestoreHelperStore } from "../functions/helper/apply.js";
import { inviteLockId } from "../functions/shared/staff-invites.js";

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "";
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(firestoreHost)) {
  console.error("Refusing invite claim test without the local Firestore emulator. Nothing was sent to a live project.");
  console.error("FIRESTORE_EMULATOR_HOST=" + firestoreHost);
  process.exit(1);
}

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

if (!getApps().length) initializeApp({ projectId: "demo-invite-claim" });
const db = getFirestore();

function pendingInvite(id, email, company) {
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000));
  return {
    id,
    expiresAt,
    invite: {
      name: "Casey Nguyen",
      email,
      role: "operator",
      status: "pending",
      tenantId: company,
      companyId: company,
      token: "a".repeat(43),
      createdBy: "admin-1",
      expiresAt,
    },
    lock: {
      email,
      status: "pending",
      inviteId: id,
      role: "operator",
      tenantId: company,
      expiresAt,
    },
  };
}

test("accept clears a per-company lock and a legacy email lock", async () => {
  const company = "acme";
  const fresh = pendingInvite("claim-new", "new.lock@example.test", company);
  await db.collection("invites").doc(fresh.id).set(fresh.invite);
  await db.collection("inviteEmails").doc(inviteLockId(company, fresh.invite.email)).set(fresh.lock);
  const accepted = await claimInviteDocument(db, fresh.id, "uid-new", new Date());
  assert.equal(accepted.ok, true);
  const next = await db.collection("inviteEmails").doc(inviteLockId(company, fresh.invite.email)).get();
  assert.equal(next.data().status, "accepted");
  assert.equal(next.data().inviteId, fresh.id);
  assert.equal((await db.collection("inviteEmails").doc(fresh.invite.email).get()).exists, false);
  assert.equal((await db.collection("invites").doc(fresh.id).get()).data().acceptedUid, "uid-new");

  const old = pendingInvite("claim-legacy", "legacy.lock@example.test", company);
  await db.collection("invites").doc(old.id).set(old.invite);
  await db.collection("inviteEmails").doc(old.invite.email).set(old.lock);
  const claimed = await claimInviteDocument(db, old.id, "uid-old", new Date());
  assert.equal(claimed.ok, true);
  const legacy = await db.collection("inviteEmails").doc(old.invite.email).get();
  assert.equal(legacy.data().status, "accepted");
  assert.equal(legacy.data().inviteId, old.id);
  const mirrored = await db.collection("inviteEmails").doc(inviteLockId(company, old.invite.email)).get();
  assert.equal(mirrored.data().status, "accepted");
  assert.equal(mirrored.data().inviteId, old.id);

  const otherEmail = "untouched.lock@example.test";
  const kept = pendingInvite("claim-kept", otherEmail, company);
  await db.collection("invites").doc(kept.id).set(kept.invite);
  await db.collection("inviteEmails").doc(inviteLockId(company, otherEmail)).set(kept.lock);
  await db.collection("inviteEmails").doc(otherEmail).set({
    ...kept.lock, inviteId: "someone-else", tenantId: "otherco", status: "pending",
  });
  const left = await claimInviteDocument(db, kept.id, "uid-kept", new Date());
  assert.equal(left.ok, true);
  const untouched = await db.collection("inviteEmails").doc(otherEmail).get();
  assert.equal(untouched.data().inviteId, "someone-else");
  assert.equal(untouched.data().status, "pending");
  assert.equal(untouched.data().tenantId, "otherco");
});

test("helper apply writes the invite on the per-company lock id", async () => {
  const email = "helper.pat@example.test";
  await firestoreHelperStore(db).apply({
    type: "invite", name: "Pat Helper", email, role: "operator",
    token: "b".repeat(43), tenantId: "otherco", createdBy: "sup1",
  });
  const lock = await db.collection("inviteEmails").doc(inviteLockId("otherco", email)).get();
  assert.equal(lock.exists, true);
  assert.equal(lock.data().status, "pending");
  assert.equal(lock.data().email, email);
  assert.equal(lock.data().tenantId, "otherco");
  assert.equal((await db.collection("inviteEmails").doc(email).get()).exists, false);
  const rows = await db.collection("invites").where("email", "==", email).get();
  assert.equal(rows.size, 1);
  assert.equal(lock.data().inviteId, rows.docs[0].id);
  assert.equal(rows.docs[0].data().tenantId, "otherco");
});
