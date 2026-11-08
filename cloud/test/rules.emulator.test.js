// Runs only under `firebase emulators:exec` (Auth, Firestore, Storage).
// Project id is demo-heartwood. This does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, serverTimestamp, Timestamp, runTransaction, query, where } from "firebase/firestore";
import { swmsSignatureData } from "../../app/features/swms-sign.js";
import { ref, uploadBytes, getBytes, list, listAll, getMetadata, deleteObject } from "firebase/storage";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const PATRICK = "R7t41e54Ykcdk9WPdVZnDd697iI2";
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-heartwood",
    firestore: { rules: readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8") },
    storage: { rules: readFileSync(new URL("../emulator/storage.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/op1"), { role: "operator", name: "Sam" });
    await setDoc(doc(db, "users/idle"), { role: "operator", name: "Idle" });
    await setDoc(doc(db, "users/op2"), { role: "operator", name: "Other", tenantId: "otherco" });
    await setDoc(doc(db, "users/sup1"), { role: "supervisor", name: "Sue" });
    await setDoc(doc(db, "users/scoped"), { role: "operator", name: "Scope", customerIds: ["Orbit Homes (Qld) Pty Ltd"] });
    await setDoc(doc(db, "users/finOther"), { role: "admin", name: "Fin", tenantId: "otherco" });
    await setDoc(doc(db, "users/patrick"), { role: "operator", name: "Patrick" });
    await setDoc(doc(db, "jobs/job1"), { client: "Orbit Homes (Qld) Pty Ltd", assigned: ["op1", "sup1", "scoped"], address: "1 Creek Rd" });
    await setDoc(doc(db, "jobs/silk"), { client: "Silkwood Homes", assigned: ["scoped", "op1"] });
    await setDoc(doc(db, "jobs/other"), { tenantId: "otherco", client: "Silkwood Homes", assigned: ["op2"] });
    await setDoc(doc(db, "receipts/rOp"), { uid: "op1", amountInc: 10, status: "queued" });
    await setDoc(doc(db, "receipts/rSup"), { uid: "sup1", amountInc: 20, status: "queued" });
    await setDoc(doc(db, "tenants/otherco"), { financeUids: ["finOther"] });
    const storage = ctx.storage();
    await uploadBytes(ref(storage, "tenants/heartwood/finance/xero/keep.csv"), new Uint8Array([1]), { contentType: "text/csv" });
    await uploadBytes(ref(storage, "tenants/otherco/finance/xero/keep.csv"), new Uint8Array([1]), { contentType: "text/csv" });
    await uploadBytes(ref(storage, "tenants/heartwood/_exports/job1.zip"), new Uint8Array([1, 2]), { contentType: "application/zip" });
  });
});

test.after(async () => { if (env) await env.cleanup(); });

function storageOf(uid) { return env.authenticatedContext(uid).storage(); }
function photoMeta(uid, jobId = "job1", tenantId = "heartwood") {
  return {
    contentType: "image/jpeg",
    customMetadata: { tenantId, jobId, uploaderUid: uid, purpose: "job-photo", batchCount: "1" },
  };
}

test("auth emulator accepts a sign-up without the live project", async () => {
  const res = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "cloud-test@example.com", password: "not-a-real-password", returnSecureToken: true }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.localId);
  assert.equal(body.email, "cloud-test@example.com");
});

test("assigned Heartwood operator uploads a job photo and cannot use another tenant path", async () => {
  const storage = storageOf("op1");
  await assertSucceeds(uploadBytes(ref(storage, "tenants/heartwood/jobs/job1/photos/p1.jpg"), jpeg, photoMeta("op1")));
  await assertSucceeds(getBytes(ref(storage, "tenants/heartwood/jobs/job1/photos/p1.jpg")));
  await assertFails(uploadBytes(ref(storage, "tenants/otherco/jobs/other/photos/p1.jpg"), jpeg, photoMeta("op1", "other", "otherco")));
  await assertFails(getBytes(ref(storageOf("op2"), "tenants/heartwood/jobs/job1/photos/p1.jpg")));
});

test("job photo list follows job access and a private receipt stays unread", async () => {
  const path = "tenants/heartwood/jobs/job1/photos/pgallery.jpg";
  const meta = {
    contentType: "image/jpeg",
    customMetadata: { tenantId: "heartwood", jobId: "job1", uploaderUid: "op1", purpose: "job-photo", batchCount: "1", expiresAfter: "2026-11-06" },
  };
  await assertSucceeds(uploadBytes(ref(storageOf("op1"), path), jpeg, meta));
  await uploadBytes(ref(storageOf("op1"), "tenants/heartwood/jobs/job1/photos/pgallery2.jpg"), jpeg, meta);
  await uploadBytes(ref(storageOf("op1"), "tenants/heartwood/jobs/job1/photos/pgallery3.jpg"), jpeg, meta);
  const page = await assertSucceeds(list(ref(storageOf(ALEX), "tenants/heartwood/jobs/job1/photos"), { maxResults: 100 }));
  assert.ok(page.items.length >= 3);
  await assertSucceeds(listAll(ref(storageOf("op1"), "tenants/heartwood/jobs/job1/photos")));
  await assertSucceeds(listAll(ref(storageOf(ALEX), "tenants/heartwood/jobs/job1/photos")));
  await assertSucceeds(getBytes(ref(storageOf("sup1"), path)));
  const readBack = await assertSucceeds(getMetadata(ref(storageOf(ALEX), path)));
  assert.equal(readBack.customMetadata.expiresAfter, "2026-11-06");
  assert.equal(readBack.customMetadata.purpose, "job-photo");
  await assertSucceeds(getBytes(ref(storageOf(ALEX), path)));
  await assertSucceeds(getMetadata(ref(storageOf(PATRICK), path)));
  const afterView = await assertSucceeds(getMetadata(ref(storageOf("op1"), path)));
  assert.equal(afterView.customMetadata.expiresAfter, "2026-11-06");
  await assertFails(listAll(ref(storageOf("idle"), "tenants/heartwood/jobs/job1/photos")));
  await assertFails(getBytes(ref(storageOf("idle"), path)));
  await assertFails(listAll(ref(storageOf("op2"), "tenants/heartwood/jobs/job1/photos")));
  await assertFails(getBytes(ref(storageOf("op2"), path)));
  const signedOut = env.unauthenticatedContext().storage();
  await assertFails(listAll(ref(signedOut, "tenants/heartwood/jobs/job1/photos")));
  await assertFails(getBytes(ref(signedOut, path)));
  await assertFails(deleteObject(ref(storageOf("op1"), path)));
  await assertFails(deleteObject(ref(storageOf(ALEX), path)));
  const receiptMeta = { contentType: "image/jpeg", customMetadata: { tenantId: "heartwood", receiptId: "rOp", uploaderUid: "op1", purpose: "receipt" } };
  await assertSucceeds(uploadBytes(ref(storageOf("op1"), "tenants/heartwood/receipts/rOp/original"), jpeg, receiptMeta));
  await assertFails(getBytes(ref(storageOf("op1"), "tenants/heartwood/receipts/rOp/original")));
  await assertFails(getMetadata(ref(storageOf("op1"), "tenants/heartwood/receipts/rOp/original")));
  await assertFails(listAll(ref(storageOf("op1"), "tenants/heartwood/receipts")));
  await assertFails(listAll(ref(storageOf(ALEX), "tenants/heartwood/receipts")));
});

test("customer scope, metadata and file type are enforced", async () => {
  const scoped = storageOf("scoped");
  await assertFails(uploadBytes(ref(scoped, "tenants/heartwood/jobs/silk/photos/p1.jpg"), jpeg, photoMeta("scoped", "silk")));
  await assertFails(uploadBytes(ref(storageOf("op1"), "tenants/heartwood/jobs/job1/photos/bad.txt"), new Uint8Array([1]), {
    contentType: "text/plain",
    customMetadata: { tenantId: "heartwood", jobId: "job1", uploaderUid: "op1", purpose: "job-photo", batchCount: "1" },
  }));
  await assertFails(uploadBytes(ref(storageOf("op1"), "tenants/heartwood/jobs/job1/photos/spoof.jpg"), jpeg, photoMeta("op1", "job1", "otherco")));
  await assertFails(uploadBytes(ref(storageOf("op1"), "tenants/heartwood/jobs/job1/photos/batch.jpg"), jpeg, {
    contentType: "image/jpeg",
    customMetadata: { tenantId: "heartwood", jobId: "job1", uploaderUid: "op1", purpose: "job-photo", batchCount: "11" },
  }));
  await assertFails(uploadBytes(ref(storageOf("stranger"), "tenants/heartwood/jobs/job1/photos/nope.jpg"), jpeg, photoMeta("stranger")));
});

test("receipt upload hides the file from operators and from other staff", async () => {
  const op = storageOf("op1");
  const meta = { contentType: "image/jpeg", customMetadata: { tenantId: "heartwood", receiptId: "rOp", uploaderUid: "op1", purpose: "receipt" } };
  await assertSucceeds(uploadBytes(ref(op, "tenants/heartwood/receipts/rOp/original"), jpeg, meta));
  await assertFails(getBytes(ref(op, "tenants/heartwood/receipts/rOp/original")));
  await assertFails(getBytes(ref(storageOf("scoped"), "tenants/heartwood/receipts/rOp/original")));
  const sup = storageOf("sup1");
  await assertSucceeds(uploadBytes(ref(sup, "tenants/heartwood/receipts/rSup/original"), jpeg, {
    contentType: "image/jpeg",
    customMetadata: { tenantId: "heartwood", receiptId: "rSup", uploaderUid: "sup1", purpose: "receipt" },
  }));
  await assertSucceeds(getBytes(ref(sup, "tenants/heartwood/receipts/rSup/original")));
  await assertFails(getBytes(ref(sup, "tenants/heartwood/receipts/rOp/original")));
  await assertSucceeds(getBytes(ref(storageOf(ALEX), "tenants/heartwood/receipts/rOp/original")));
  await assertFails(getBytes(ref(storageOf(ALEX), "tenants/otherco/finance/xero/keep.csv")));
});

test("finance files and export objects stay off limits for ordinary roles", async () => {
  await assertFails(getBytes(ref(storageOf("op1"), "tenants/heartwood/finance/xero/keep.csv")));
  await assertFails(getBytes(ref(storageOf("sup1"), "tenants/heartwood/finance/xero/keep.csv")));
  await assertSucceeds(getBytes(ref(storageOf(ALEX), "tenants/heartwood/finance/xero/keep.csv")));
  await assertSucceeds(getBytes(ref(storageOf(PATRICK), "tenants/heartwood/finance/xero/keep.csv")));
  await assertFails(getBytes(ref(storageOf(PATRICK), "tenants/otherco/finance/xero/keep.csv")));
  await assertSucceeds(getBytes(ref(storageOf("finOther"), "tenants/otherco/finance/xero/keep.csv")));
  await assertFails(getBytes(ref(storageOf("finOther"), "tenants/heartwood/finance/xero/keep.csv")));
  await assertFails(uploadBytes(ref(storageOf(ALEX), "tenants/heartwood/finance/xero/new.csv"), new Uint8Array([1]), { contentType: "text/csv" }));
  await assertFails(getBytes(ref(storageOf("op1"), "tenants/heartwood/_exports/job1.zip")));
  await assertSucceeds(getBytes(ref(storageOf(ALEX), "tenants/heartwood/_exports/job1.zip")));
  await assertFails(uploadBytes(ref(storageOf(ALEX), "tenants/heartwood/_exports/public.zip"), new Uint8Array([1]), { contentType: "application/zip" }));
});

test("ordinary roles cannot read the Xero queue or rewrite their tenant", async () => {
  const op = env.authenticatedContext("op1").firestore();
  const sup = env.authenticatedContext("sup1").firestore();
  const alex = env.authenticatedContext(ALEX).firestore();
  await assertFails(getDoc(doc(op, "xeroQueue/one")));
  await assertFails(getDoc(doc(sup, "xeroQueue/one")));
  await assertFails(setDoc(doc(op, "xeroQueue/one"), { status: "queued", by: "op1", tenantId: "otherco" }));
  await assertSucceeds(setDoc(doc(alex, "xeroQueue/one"), { status: "queued", by: ALEX, jobId: "job1" }));
  await assertFails(updateDoc(doc(op, "users/op1"), { tenantId: "otherco" }));
  await assertFails(updateDoc(doc(op, "users/op1"), { role: "admin" }));
  await assertSucceeds(updateDoc(doc(op, "users/op1"), { name: "Sam K" }));
  const still = await assertSucceeds(getDoc(doc(op, "users/op1")));
  assert.equal(still.data().role, "operator");
  assert.equal(still.data().tenantId, undefined);
});

function db(uid) { return env.authenticatedContext(uid).firestore(); }
function messages(uid, tenant, thread) {
  return collection(db(uid), "tenants", tenant, "chats", thread, "messages");
}
function chatMsg(uid, text, extra = {}) {
  return { senderName: "Sam", text, createdAt: serverTimestamp(), ...extra, senderUid: uid };
}

test("team chat is limited to tenant members and server timestamps", async () => {
  const thread = messages("op1", "heartwood", "staff");
  await assertSucceeds(addDoc(thread, chatMsg("op1", "On site")));
  await assertSucceeds(getDocs(messages("idle", "heartwood", "staff")));
  await assertSucceeds(addDoc(messages("idle", "heartwood", "staff"), chatMsg("idle", "Copy")));
  await assertFails(addDoc(messages("op2", "heartwood", "staff"), chatMsg("op2", "Other tenant")));
  await assertSucceeds(addDoc(messages("op2", "otherco", "staff"), chatMsg("op2", "Our yard")));
  await assertFails(addDoc(messages("stranger", "heartwood", "staff"), chatMsg("stranger", "No profile")));
  const signedOut = env.unauthenticatedContext().firestore();
  await assertFails(getDocs(collection(signedOut, "tenants", "heartwood", "chats", "staff", "messages")));
  await assertFails(addDoc(thread, { senderName: "Sam", text: "spoof", createdAt: serverTimestamp(), senderUid: "idle" }));
  await assertFails(addDoc(thread, { senderName: "Sam", text: "clock", createdAt: Timestamp.fromDate(new Date()), senderUid: "op1" }));
  await assertFails(addDoc(thread, chatMsg("op1", "")));
  await assertFails(addDoc(thread, chatMsg("op1", "x".repeat(4001))));
  const withPhoto = await assertSucceeds(addDoc(thread, chatMsg("op1", "", {
    photoPath: "tenants/heartwood/chat/staff/photos/c12345678",
    photoType: "image/jpeg",
  })));
  await assertFails(addDoc(thread, chatMsg("op1", "slip", {
    photoPath: "tenants/heartwood/receipts/rOp/original",
    photoType: "image/jpeg",
  })));
  await assertFails(updateDoc(withPhoto, { text: "changed" }));
  await assertSucceeds(deleteDoc(withPhoto));
  const other = await assertSucceeds(addDoc(thread, chatMsg("op1", "keep")));
  await assertFails(deleteDoc(doc(db("idle"), other.path)));
  await assertFails(deleteDoc(doc(db("sup1"), other.path)));
  await assertSucceeds(deleteDoc(doc(db(ALEX), other.path)));
  await assertSucceeds(setDoc(doc(db("op1"), "tenants", "heartwood", "chats", "staff"), {
    lastAt: serverTimestamp(), lastSenderUid: "op1", lastSenderName: "Sam", preview: "keep",
  }));
  await assertFails(setDoc(doc(db("op1"), "tenants", "heartwood", "chats", "staff"), {
    lastAt: serverTimestamp(), lastSenderUid: "idle", lastSenderName: "Sam", preview: "no",
  }));
  await assertSucceeds(setDoc(doc(db("op1"), "tenants", "heartwood", "chatSeen", "op1", "threads", "staff"), { seenAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db("op1"), "tenants", "heartwood", "chatSeen", "idle", "threads", "staff"), { seenAt: serverTimestamp() }));
  await assertFails(getDoc(doc(db("idle"), "tenants", "heartwood", "chatSeen", "op1", "threads", "staff")));
  await assertFails(setDoc(doc(db("op1"), "receipts", "from-chat"), { uid: "op1", amountInc: 1 }));
});

test("job chat follows admin and assigned visibility", async () => {
  await assertSucceeds(addDoc(messages("op1", "heartwood", "job_job1"), chatMsg("op1", "Crew note")));
  await assertSucceeds(addDoc(messages("sup1", "heartwood", "job_job1"), chatMsg("sup1", "Supervisor note")));
  await assertSucceeds(addDoc(messages("scoped", "heartwood", "job_job1"), chatMsg("scoped", "Orbit only")));
  await assertSucceeds(getDocs(messages(ALEX, "heartwood", "job_job1")));
  await assertSucceeds(getDocs(messages(PATRICK, "heartwood", "job_job1")));
  await assertFails(getDocs(messages("idle", "heartwood", "job_job1")));
  await assertFails(addDoc(messages("idle", "heartwood", "job_job1"), chatMsg("idle", "Not on this job")));
  await assertFails(addDoc(messages("scoped", "heartwood", "job_silk"), chatMsg("scoped", "Wrong customer")));
  await assertFails(addDoc(messages("op1", "heartwood", "job_other"), chatMsg("op1", "Wrong tenant job")));
  await assertSucceeds(addDoc(messages("op2", "otherco", "job_other"), chatMsg("op2", "Other crew")));
  await assertFails(getDocs(messages("op1", "otherco", "job_other")));
  const note = await assertSucceeds(addDoc(messages("op1", "heartwood", "job_job1"), chatMsg("op1", "Mine")));
  await assertSucceeds(deleteDoc(note));
  const theirs = await assertSucceeds(addDoc(messages("op1", "heartwood", "job_job1"), chatMsg("op1", "Admin can remove")));
  await assertFails(deleteDoc(doc(db("sup1"), theirs.path)));
  await assertSucceeds(deleteDoc(doc(db(PATRICK), theirs.path)));
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "tenants", "heartwood", "chats", "job_silk"), {
      lastAt: new Date(), lastSenderUid: "scoped", lastSenderName: "Scope", preview: "hidden",
    });
  });
  await assertFails(getDocs(collection(db("idle"), "tenants", "heartwood", "chats")));
  await assertFails(getDoc(doc(db("idle"), "tenants", "heartwood", "chats", "job_silk")));
  await assertSucceeds(getDoc(doc(db("op1"), "tenants", "heartwood", "chats", "job_silk")));
  await assertSucceeds(getDoc(doc(db("op1"), "tenants", "heartwood", "chats", "staff")));
});

test("chat photos stay private to the thread and are not receipt or finance files", async () => {
  const staffPath = "tenants/heartwood/chat/staff/photos/c12345678";
  const staffMeta = {
    contentType: "image/jpeg",
    customMetadata: { tenantId: "heartwood", threadId: "staff", uploaderUid: "op1", purpose: "chat-photo" },
  };
  await assertSucceeds(uploadBytes(ref(storageOf("op1"), staffPath), jpeg, staffMeta));
  await assertSucceeds(getBytes(ref(storageOf("idle"), staffPath)));
  await assertSucceeds(listAll(ref(storageOf("sup1"), "tenants/heartwood/chat/staff/photos")));
  await assertFails(getBytes(ref(storageOf("op2"), staffPath)));
  await assertFails(listAll(ref(storageOf("op2"), "tenants/heartwood/chat/staff/photos")));
  await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), staffPath)));
  await assertFails(deleteObject(ref(storageOf("idle"), staffPath)));
  await assertSucceeds(deleteObject(ref(storageOf("op1"), staffPath)));
  await assertSucceeds(uploadBytes(ref(storageOf("op1"), staffPath), jpeg, staffMeta));
  await assertSucceeds(deleteObject(ref(storageOf(ALEX), staffPath)));
  await assertFails(uploadBytes(ref(storageOf("op1"), "tenants/heartwood/chat/staff/photos/c12345678"), jpeg, {
    contentType: "text/plain",
    customMetadata: staffMeta.customMetadata,
  }));
  const jobPath = "tenants/heartwood/chat/jobs/job1/photos/c12345678";
  const jobMeta = {
    contentType: "image/jpeg",
    customMetadata: { tenantId: "heartwood", threadId: "job_job1", jobId: "job1", uploaderUid: "op1", purpose: "chat-photo" },
  };
  await assertSucceeds(uploadBytes(ref(storageOf("op1"), jobPath), jpeg, jobMeta));
  await assertSucceeds(getBytes(ref(storageOf("sup1"), jobPath)));
  await assertSucceeds(getBytes(ref(storageOf(PATRICK), jobPath)));
  await assertFails(uploadBytes(ref(storageOf("idle"), jobPath), jpeg, {
    contentType: "image/jpeg",
    customMetadata: { ...jobMeta.customMetadata, uploaderUid: "idle" },
  }));
  await assertFails(getBytes(ref(storageOf("idle"), jobPath)));
  await assertFails(listAll(ref(storageOf("idle"), "tenants/heartwood/chat/jobs/job1/photos")));
  await assertFails(getBytes(ref(storageOf("scoped"), "tenants/heartwood/chat/jobs/silk/photos/c12345678")));
  await assertFails(deleteObject(ref(storageOf("sup1"), jobPath)));
  await assertSucceeds(deleteObject(ref(storageOf(ALEX), jobPath)));
  await assertFails(uploadBytes(ref(storageOf(ALEX), "tenants/heartwood/finance/chat.jpg"), jpeg, staffMeta));
  await assertFails(deleteObject(ref(storageOf(ALEX), "tenants/heartwood/jobs/job1/photos/p1.jpg")));
});

function inviteExpires(days = 7) {
  return Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function writeInvite(uid, email, fields = {}) {
  const fire = db(uid);
  const inviteRef = doc(collection(fire, "invites"));
  const expiresAt = fields.expiresAt || inviteExpires();
  const data = {
    name: fields.name || "Casey Nguyen",
    email,
    role: fields.role || "operator",
    status: fields.status || "pending",
    createdBy: fields.createdBy || uid,
    createdAt: serverTimestamp(),
    expiresAt,
    token: fields.token || "a".repeat(43),
    tenantId: fields.tenantId || "heartwood",
  };
  await runTransaction(fire, async tx => {
    const lockRef = doc(fire, "inviteEmails", email);
    await tx.get(lockRef);
    tx.set(inviteRef, data);
    tx.set(lockRef, {
      email,
      status: data.status,
      inviteId: inviteRef.id,
      expiresAt,
      role: data.role,
      tenantId: data.tenantId,
    });
  });
  return inviteRef;
}

test("rules-admins create operator invites and staff cannot read or self-assign a role", async () => {
  const email = "casey.rules@example.com";
  const created = await assertSucceeds(writeInvite(ALEX, email, { token: "c".repeat(43) }));
  await assertSucceeds(getDoc(created));
  await assertSucceeds(getDocs(query(collection(db(ALEX), "invites"), where("tenantId", "==", "heartwood"))));
  await assertFails(getDocs(collection(db(ALEX), "invites")));
  await assertSucceeds(getDoc(doc(db(ALEX), "inviteEmails", email)));
  await assertFails(getDocs(collection(db(ALEX), "inviteEmails")));
  await assertFails(getDoc(doc(db("op1"), "inviteEmails", email)));
  await assertFails(getDocs(query(collection(db("op1"), "invites"), where("tenantId", "==", "heartwood"))));
  await assertFails(getDocs(query(collection(env.unauthenticatedContext().firestore(), "invites"), where("tenantId", "==", "heartwood"))));
  await assertFails(writeInvite("op1", "operator.invite@example.com", { token: "d".repeat(43) }));
  await assertSucceeds(writeInvite(PATRICK, "patrick.staff@example.com", { token: "f".repeat(43) }));
  await assertFails(getDoc(doc(db("finOther"), created.path)));
  await assertFails(writeInvite("finOther", "cross.tenant@example.com", { tenantId: "heartwood", token: "g".repeat(43) }));
  const other = await assertSucceeds(writeInvite("finOther", "other.staff@example.com", { tenantId: "otherco", token: "h".repeat(43) }));
  await assertFails(getDoc(doc(db(ALEX), other.path)));
  await assertFails(setDoc(doc(db("newstaff"), "users/newstaff"), { name: "New", role: "operator" }));
  await assertFails(setDoc(doc(db("newstaff"), "users/newstaff"), { name: "New", role: "admin" }));
  await assertSucceeds(setDoc(doc(db("newstaff"), "users/newstaff"), { name: "New" }));
  const profile = await assertSucceeds(getDoc(doc(db("newstaff"), "users/newstaff")));
  assert.equal(profile.data().role, undefined);
  await assertFails(setDoc(doc(db(ALEX), "mail/one"), { to: "casey.rules@example.com", message: { subject: "Hi", text: "link" } }));
  await assertFails(setDoc(doc(db(ALEX), "inviteMail/one"), { to: "casey.rules@example.com", delivery: "held", link: "https://jobs.heartwoodew.com/app?invite=x" }));
  await assertFails(deleteDoc(created));
});

test("invite shape rejects admin, a second pending email, and a client accept", async () => {
  await assertFails(writeInvite(ALEX, "bad.role@example.com", { role: "admin", token: "i".repeat(43) }));
  await assertFails(writeInvite(ALEX, "Casey.Upper@example.com", { token: "j".repeat(43) }));
  await assertFails(writeInvite(ALEX, "soon@example.com", { token: "k".repeat(43), expiresAt: inviteExpires(1) }));
  await assertFails(writeInvite(ALEX, "newline@example.com", { token: "l".repeat(43), name: "Casey\nNguyen" }));
  await assertFails(setDoc(doc(db(ALEX), "invites/solo"), {
    name: "Casey Nguyen", email: "solo@example.com", role: "operator", status: "pending",
    createdBy: ALEX, createdAt: serverTimestamp(), expiresAt: inviteExpires(), token: "m".repeat(43), tenantId: "heartwood",
  }));
  const email = "dup.rules@example.com";
  const first = await assertSucceeds(writeInvite(ALEX, email, { token: "n".repeat(43) }));
  await assertFails(writeInvite(ALEX, email, { token: "o".repeat(43) }));
  await env.withSecurityRulesDisabled(async ctx => {
    const past = Timestamp.fromMillis(Date.now() - 60 * 1000);
    await setDoc(doc(ctx.firestore(), "invites/expired-seed"), {
      name: "Riley Chen", email: "expired.rules@example.com", role: "operator", status: "pending",
      createdBy: ALEX, createdAt: new Date(), expiresAt: past, token: "p".repeat(43), tenantId: "heartwood",
    });
    await setDoc(doc(ctx.firestore(), "inviteEmails/expired.rules@example.com"), {
      email: "expired.rules@example.com", status: "pending", inviteId: "expired-seed",
      expiresAt: past, role: "operator", tenantId: "heartwood",
    });
  });
  await assertFails(writeInvite(ALEX, "expired.rules@example.com", { token: "q".repeat(43) }));
  const alex = db(ALEX);
  const firstRef = doc(alex, first.path);
  const lockRef = doc(alex, "inviteEmails", email);
  await assertFails(updateDoc(firstRef, { status: "accepted", acceptedAt: serverTimestamp(), acceptedUid: "someone" }));
  await assertFails(updateDoc(firstRef, { status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: ALEX }));
  await assertSucceeds(runTransaction(alex, async tx => {
    tx.update(firstRef, { status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: ALEX });
    tx.update(lockRef, { status: "cancelled" });
  }));
  const replacement = await assertSucceeds(writeInvite(ALEX, email, { token: "r".repeat(43) }));
  const nextExpiry = inviteExpires();
  const replaced = doc(alex, replacement.path);
  await assertFails(runTransaction(alex, async tx => {
    tx.update(replaced, {
      role: "supervisor", token: "s".repeat(43), expiresAt: nextExpiry, resentAt: serverTimestamp(), resentBy: ALEX,
    });
    tx.update(lockRef, { role: "supervisor", expiresAt: nextExpiry, status: "pending" });
  }));
  await assertSucceeds(runTransaction(alex, async tx => {
    tx.update(replaced, {
      token: "t".repeat(43), expiresAt: nextExpiry, resentAt: serverTimestamp(), resentBy: ALEX,
    });
    tx.update(lockRef, { expiresAt: nextExpiry, status: "pending" });
  }));
  const after = await assertSucceeds(getDoc(replaced));
  assert.equal(after.data().role, "operator");
  assert.equal(after.data().token, "t".repeat(43));
  assert.equal(after.data().email, email);
});

function fleetBody(uid, extra = {}) {
  return {
    type: "vehicle", name: "Preview tipper", rego: "PRE001", regoExpiry: "2026-10-01",
    coiRequired: true, coiExpiry: "2026-09-15", notes: "", updatedBy: uid, updatedAt: serverTimestamp(),
    ...extra,
  };
}
function policyBody(uid, extra = {}) {
  return {
    type: "workcover", insurer: "WorkCover Queensland", policyNumber: "WC-PREVIEW",
    startDate: "2025-07-01", expiry: "2026-11-25", amount: "Statutory", notes: "", assetId: "",
    updatedBy: uid, updatedAt: serverTimestamp(), ...extra,
  };
}

test("fleet is signed-in read and admin write; policies stay admin-only", async () => {
  await assertSucceeds(setDoc(doc(db(ALEX), "tenants", "heartwood", "fleet", "tipper"), fleetBody(ALEX)));
  await assertSucceeds(getDoc(doc(db("op1"), "tenants", "heartwood", "fleet", "tipper")));
  await assertSucceeds(getDocs(collection(db("sup1"), "tenants", "heartwood", "fleet")));
  await assertFails(setDoc(doc(db("op1"), "tenants", "heartwood", "fleet", "nope"), fleetBody("op1")));
  await assertFails(updateDoc(doc(db("op1"), "tenants", "heartwood", "fleet", "tipper"), { notes: "changed" }));
  await assertFails(getDoc(doc(db("op2"), "tenants", "heartwood", "fleet", "tipper")));
  await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), "tenants", "heartwood", "fleet")));
  await assertFails(setDoc(doc(db(ALEX), "tenants", "heartwood", "fleet", "bad"), fleetBody(ALEX, { type: "insurance" })));

  await assertSucceeds(setDoc(doc(db(ALEX), "tenants", "heartwood", "policies", "wc"), policyBody(ALEX)));
  await assertSucceeds(getDoc(doc(db(PATRICK), "tenants", "heartwood", "policies", "wc")));
  await assertFails(getDoc(doc(db("op1"), "tenants", "heartwood", "policies", "wc")));
  await assertFails(getDocs(collection(db("sup1"), "tenants", "heartwood", "policies")));
  await assertFails(setDoc(doc(db("op1"), "tenants", "heartwood", "policies", "leak"), policyBody("op1")));
  await assertSucceeds(setDoc(doc(db("finOther"), "tenants", "otherco", "policies", "pl"), policyBody("finOther", { type: "public-liability", insurer: "Other Mutual" })));
  await assertFails(getDoc(doc(db("op1"), "tenants", "otherco", "policies", "pl")));
  await assertFails(getDoc(doc(db(ALEX), "tenants", "otherco", "policies", "pl")));
  await assertFails(deleteDoc(doc(db("op1"), "tenants", "heartwood", "policies", "wc")));
  await assertSucceeds(deleteDoc(doc(db(ALEX), "tenants", "heartwood", "policies", "wc")));
  await assertFails(deleteDoc(doc(db("sup1"), "tenants", "heartwood", "fleet", "tipper")));
  await assertSucceeds(deleteDoc(doc(db(PATRICK), "tenants", "heartwood", "fleet", "tipper")));
  await assertFails(setDoc(doc(db(ALEX), "receipts", "from-fleet"), { uid: ALEX, amountInc: 1 }));
});

const TINY_SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
function swmsPayload(uid, extra = {}) {
  const now = Date.now();
  return {
    ...swmsSignatureData({
      uid, name: extra.name || "Sam", swmsId: extra.swmsId || "electrical",
      jobId: extra.jobId || "", jobLabel: extra.jobLabel || "", sig: TINY_SIG, now, device: "rules-test",
    }),
    signedAt: serverTimestamp(),
  };
}

test("SWMS signatures are self-only for staff and readable by admins", async () => {
  const mine = await assertSucceeds(addDoc(collection(db("op1"), "swmsSignatures"), swmsPayload("op1", {
    jobId: "job1", jobLabel: "#2402 · 14 Brightvale Street",
  })));
  await assertSucceeds(getDoc(mine));
  await assertSucceeds(getDocs(query(collection(db("op1"), "swmsSignatures"), where("uid", "==", "op1"))));
  await assertFails(getDocs(collection(db("op1"), "swmsSignatures")));
  await assertFails(getDoc(doc(db("idle"), mine.path)));
  await assertFails(getDocs(collection(db("sup1"), "swmsSignatures")));
  await assertSucceeds(getDocs(query(collection(db("sup1"), "swmsSignatures"), where("uid", "==", "sup1"))));
  await assertSucceeds(getDocs(collection(db(ALEX), "swmsSignatures")));
  await assertSucceeds(getDocs(collection(db(PATRICK), "swmsSignatures")));
  await assertFails(addDoc(collection(db("op1"), "swmsSignatures"), swmsPayload("idle")));
  await assertFails(addDoc(collection(db("stranger"), "swmsSignatures"), swmsPayload("stranger")));
  await assertFails(addDoc(collection(db("op1"), "swmsSignatures"), { ...swmsPayload("op1"), signedAt: Timestamp.fromDate(new Date()) }));
  await assertFails(addDoc(collection(db("op1"), "swmsSignatures"), { ...swmsPayload("op1"), expiresAtMs: Date.now() + 30 * 86400000 }));
  await assertFails(addDoc(collection(db("op1"), "swmsSignatures"), { ...swmsPayload("op1"), swmsId: "made-up-method" }));
  await assertFails(addDoc(collection(db("op1"), "swmsSignatures"), { ...swmsPayload("op1"), sig: "data:image/jpeg;base64,AAAA" }));
  await assertFails(updateDoc(mine, { name: "Someone else" }));
  await assertFails(deleteDoc(mine));
  await assertFails(deleteDoc(doc(db(ALEX), mine.path)));
  await assertFails(updateDoc(doc(db("op1"), "receipts/rOp"), { amountInc: 99 }));
  await assertFails(setDoc(doc(db("op1"), "xeroQueue/from-swms"), { status: "queued", by: "op1" }));
  const signedOut = env.unauthenticatedContext().firestore();
  await assertFails(getDocs(collection(signedOut, "swmsSignatures")));
});

test("a supervisor can invite, resend and cancel; an operator cannot", async () => {
  const email = "crew.lead@example.com";
  const created = await assertSucceeds(writeInvite("sup1", email, { token: "u".repeat(43), role: "operator" }));
  await assertSucceeds(getDocs(query(collection(db("sup1"), "invites"), where("tenantId", "==", "heartwood"))));
  await assertSucceeds(getDoc(doc(db("sup1"), "inviteEmails", email)));
  await assertFails(writeInvite("op1", "crew.mate@example.com", { token: "v".repeat(43) }));
  await assertFails(getDocs(query(collection(db("op1"), "invites"), where("tenantId", "==", "heartwood"))));
  await assertFails(writeInvite("sup1", "not.admin@example.com", { role: "admin", token: "y".repeat(43) }));
  const sup = db("sup1");
  const ref = doc(sup, created.path);
  const lock = doc(sup, "inviteEmails", email);
  const nextExpiry = inviteExpires();
  await assertSucceeds(runTransaction(sup, async tx => {
    tx.update(ref, { token: "w".repeat(43), expiresAt: nextExpiry, resentAt: serverTimestamp(), resentBy: "sup1" });
    tx.update(lock, { expiresAt: nextExpiry, status: "pending" });
  }));
  const op = db("op1");
  await assertFails(runTransaction(op, async tx => {
    tx.update(doc(op, created.path), { status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: "op1" });
    tx.update(doc(op, "inviteEmails", email), { status: "cancelled" });
  }));
  await assertSucceeds(runTransaction(sup, async tx => {
    tx.update(ref, { status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: "sup1" });
    tx.update(lock, { status: "cancelled" });
  }));
  const after = await assertSucceeds(getDoc(ref));
  assert.equal(after.data().status, "cancelled");
  assert.equal(after.data().role, "operator");
  assert.notEqual(after.data().role, "admin");
});
