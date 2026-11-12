// Runs only under `firebase emulators:exec` (Auth, Firestore, Storage).
// Project id is demo-heartwood. This does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, serverTimestamp, Timestamp, runTransaction, query, where, orderBy } from "firebase/firestore";
import { swmsSignatureData } from "../../app/features/swms-sign.js";
import { itemsFor, prestartPayload, templateSeedDocs } from "../../app/features/prestart.js";
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
  const res = await fetch("http://" + (process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099") + "/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key", {
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

test("company logo is written by that company's admin and readable by its members", async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "users/hwAdmin"), { role: "admin", name: "Ada", companyId: "heartwood" });
  });
  const pathHw = "companies/heartwood/logo/logo.jpg";
  const pathOther = "companies/otherco/logo/logo.jpg";
  const meta = (uid, companyId, contentType = "image/jpeg") => ({
    contentType,
    customMetadata: { purpose: "company-logo", uploaderUid: uid, companyId },
  });
  const hwAdmin = storageOf("hwAdmin");
  await assertSucceeds(uploadBytes(ref(hwAdmin, pathHw), jpeg, meta("hwAdmin", "heartwood")));
  await assertSucceeds(getBytes(ref(hwAdmin, pathHw)));
  await assertSucceeds(getBytes(ref(storageOf("op1"), pathHw)));
  await assertFails(uploadBytes(ref(storageOf("op1"), pathHw), jpeg, meta("op1", "heartwood")));
  await assertFails(uploadBytes(ref(storageOf("sup1"), pathHw), jpeg, meta("sup1", "heartwood")));
  await assertFails(uploadBytes(ref(storageOf("finOther"), pathHw), jpeg, meta("finOther", "heartwood")));
  await assertSucceeds(uploadBytes(ref(storageOf("finOther"), pathOther), jpeg, meta("finOther", "otherco")));
  await assertSucceeds(getBytes(ref(storageOf("op2"), pathOther)));
  await assertFails(getBytes(ref(storageOf("op1"), pathOther)));
  await assertFails(getBytes(ref(storageOf("op2"), pathHw)));
  await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), pathHw)));
  await assertFails(uploadBytes(ref(hwAdmin, "companies/heartwood/logo/logo.webp"), jpeg, meta("hwAdmin", "heartwood")));
  await assertFails(uploadBytes(ref(hwAdmin, "companies/heartwood/logo.jpg"), jpeg, meta("hwAdmin", "heartwood")));
  await assertFails(uploadBytes(ref(hwAdmin, pathHw), jpeg, meta("hwAdmin", "heartwood", "image/gif")));
  await assertFails(uploadBytes(ref(hwAdmin, pathHw), jpeg, { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(hwAdmin, pathHw), new Uint8Array(2 * 1024 * 1024 + 1), meta("hwAdmin", "heartwood")));
  await assertSucceeds(uploadBytes(ref(hwAdmin, "companies/heartwood/logo/logo.png"), jpeg, meta("hwAdmin", "heartwood", "image/png")));
  await assertSucceeds(uploadBytes(ref(hwAdmin, pathHw), jpeg, meta("hwAdmin", "heartwood")));
  await assertFails(deleteObject(ref(storageOf("op1"), pathHw)));
  await assertSucceeds(deleteObject(ref(hwAdmin, pathHw)));
  const alex = env.authenticatedContext(ALEX, { email: "alex@heartwoodew.com", email_verified: true, platformOwner: true }).storage();
  await assertSucceeds(getBytes(ref(alex, pathOther)));
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
  // 12 Nov 2026: only a CallUp company admin reads admin invites, so other invite admins list by role.
  await assertSucceeds(getDocs(query(collection(db(ALEX), "invites"), where("tenantId", "==", "heartwood"), where("role", "in", ["labourer", "operator", "supervisor"]))));
  await assertFails(getDocs(query(collection(db(ALEX), "invites"), where("tenantId", "==", "heartwood"))));
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
  const tip = doc(db("op1"), "tenants", "heartwood", "fleet", "tipper");
  const rd = (n, extra = {}) => ({ reading: n, readingUnit: "km", readingAt: serverTimestamp(), readingBy: "op1", readingByName: "Sam", ...extra });
  await assertSucceeds(updateDoc(tip, rd(84000)));
  await assertSucceeds(updateDoc(tip, rd(84210)));
  await assertFails(updateDoc(tip, rd(84100)));
  await assertFails(updateDoc(tip, rd(84300, { readingBy: "sup1" })));
  await assertFails(updateDoc(tip, rd(84300, { name: "Renamed" })));
  await assertFails(updateDoc(doc(db("op2"), "tenants", "heartwood", "fleet", "tipper"), { ...rd(90000), readingBy: "op2" }));
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
  await assertSucceeds(getDocs(query(collection(db(ALEX), "swmsSignatures"), where("companyId", "==", "heartwood"))));
  await assertSucceeds(getDocs(query(collection(db(PATRICK), "swmsSignatures"), where("companyId", "==", "heartwood"))));
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
  // 12 Nov 2026: only a CallUp company admin reads admin invites, so other invite admins list by role.
  await assertSucceeds(getDocs(query(collection(db("sup1"), "invites"), where("tenantId", "==", "heartwood"), where("role", "in", ["labourer", "operator", "supervisor"]))));
  await assertFails(getDocs(query(collection(db("sup1"), "invites"), where("tenantId", "==", "heartwood"))));
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

function serviceRecord(uid, extra = {}) {
  return {
    assetId: "tipper", doneOn: "2026-05-01", reading: 1000, readingUnit: "hours",
    serviceType: "major", servicedBy: "Chuwar Diesel", notes: "",
    updatedBy: uid, updatedAt: serverTimestamp(), ...extra,
  };
}

test("servicing records are staff-readable and costs stay with admins and supervisors", async () => {
  await assertSucceeds(setDoc(doc(db(ALEX), "tenants", "heartwood", "servicing", "s1"), serviceRecord(ALEX)));
  await assertSucceeds(setDoc(doc(db(ALEX), "tenants", "heartwood", "servicePlans", "tipper"), {
    everyDays: 180, everyReading: 250, readingUnit: "hours", currentReading: 1280,
    updatedBy: ALEX, updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(db(ALEX), "tenants", "heartwood", "serviceCosts", "s1"), {
    amount: "$840", updatedBy: ALEX, updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(getDoc(doc(db("op1"), "tenants", "heartwood", "servicing", "s1")));
  await assertSucceeds(getDoc(doc(db("op1"), "tenants", "heartwood", "servicePlans", "tipper")));
  await assertFails(getDoc(doc(db("op1"), "tenants", "heartwood", "serviceCosts", "s1")));
  await assertFails(getDocs(collection(db("op1"), "tenants", "heartwood", "serviceCosts")));
  await assertFails(setDoc(doc(db("op1"), "tenants", "heartwood", "servicing", "nope"), serviceRecord("op1")));
  await assertFails(deleteDoc(doc(db("op1"), "tenants", "heartwood", "servicing", "s1")));
  await assertSucceeds(setDoc(doc(db("sup1"), "tenants", "heartwood", "servicing", "s2"), serviceRecord("sup1", { serviceType: "repair", reading: 0, readingUnit: "" })));
  await assertSucceeds(setDoc(doc(db("sup1"), "tenants", "heartwood", "serviceCosts", "s2"), {
    amount: "$150", updatedBy: "sup1", updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(getDoc(doc(db("sup1"), "tenants", "heartwood", "serviceCosts", "s1")));
  await assertFails(setDoc(doc(db(ALEX), "tenants", "heartwood", "servicing", "bad"), serviceRecord(ALEX, { serviceType: "oil" })));
  await assertFails(getDoc(doc(db("op2"), "tenants", "heartwood", "servicing", "s1")));
  await assertFails(getDoc(doc(db("op1"), "tenants", "otherco", "servicing", "s9")));
  await assertSucceeds(setDoc(doc(db("finOther"), "tenants", "otherco", "servicing", "s9"), serviceRecord("finOther")));
  await assertFails(getDoc(doc(db(ALEX), "tenants", "otherco", "serviceCosts", "s9")));
  await assertFails(setDoc(doc(db(ALEX), "receipts", "from-service"), { uid: ALEX, amountInc: 1 }));
  await assertSucceeds(deleteDoc(doc(db("sup1"), "tenants", "heartwood", "serviceCosts", "s2")));
  await assertSucceeds(deleteDoc(doc(db(PATRICK), "tenants", "heartwood", "servicing", "s1")));
});

function prestartBody(uid, extra = {}) {
  return {
    assetId: "tipper", assetType: "vehicle", assetName: "Preview tipper", kind: "tip-truck", day: "2026-11-06",
    reading: 1280, readingUnit: "hours", odometer: 84210,
    items: [{ id: "tt-hyd", result: "fail", comment: "Weep at the ram", critical: true }],
    signerUid: uid, signerName: "Sam", signedAt: serverTimestamp(), defect: true, doNotOperate: true, resolved: false,
    ...extra,
  };
}

test("prestarts are create-only for staff and only an admin can resolve a defect", async () => {
  const created = await assertSucceeds(addDoc(collection(db("op1"), "tenants", "heartwood", "prestarts"), prestartBody("op1")));
  await assertSucceeds(getDoc(doc(db("sup1"), created.path)));
  await assertFails(updateDoc(created, { signerName: "Someone else" }));
  await assertFails(deleteDoc(created));
  await assertFails(deleteDoc(doc(db(ALEX), created.path)));
  await assertFails(updateDoc(doc(db("sup1"), created.path), {
    resolved: true, resolvedBy: "sup1", resolvedNote: "No", resolvedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(db(ALEX), created.path), {
    resolved: true, resolvedBy: ALEX, resolvedNote: "Hose replaced", resolvedAt: serverTimestamp(),
  }));
  await assertFails(addDoc(collection(db("op1"), "tenants", "heartwood", "prestarts"), prestartBody("idle")));
  await assertFails(getDoc(doc(db("op2"), created.path)));
  await assertFails(setDoc(doc(db("op1"), "tenants", "heartwood", "prestartTemplates", "tip-truck"), {
    items: [{ id: "tt-tyres", label: "Tyres", critical: true }], updatedBy: "op1", updatedAt: serverTimestamp(),
  }));
  const tip = templateSeedDocs([], ALEX).find(row => row.id === "tip-truck");
  await assertSucceeds(setDoc(doc(db(ALEX), "tenants", "heartwood", "prestartTemplates", "tip-truck"), {
    ...tip.data, updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(db(ALEX), "tenants", "heartwood", "prestartTemplates", "vehicle"), {
    items: [{ id: "tt-tyres", label: "Tyres", critical: true }], updatedBy: ALEX, updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(db("op1"), "receipts", "from-prestart"), { uid: "op1", amountInc: 1 }));
});

test("Test Worker operator can prestart any machine and read the history", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users/testworker"), { role: "operator", name: "Test Worker" });
  });
  const worker = db("testworker");
  const machine = { id: "excavator", type: "plant", name: "Excavator", prestartKind: "excavator" };
  const checks = itemsFor("excavator", []);
  const answers = Object.fromEntries(checks.map(item => [item.id, { result: item.id === "ex-hyd" ? "fail" : "pass", comment: item.id === "ex-hyd" ? "Hose weep" : "" }]));
  const built = prestartPayload({ asset: machine, day: "2026-11-06", reading: "410", readingUnit: "hours", odometer: "", answers, signerName: "Test Worker", items: checks }, "testworker");
  assert.equal(built.ok, true);
  const created = await assertSucceeds(addDoc(collection(worker, "tenants", "heartwood", "prestarts"), { ...built.data, signedAt: serverTimestamp() }));
  const listed = await assertSucceeds(getDocs(collection(worker, "tenants", "heartwood", "prestarts")));
  assert.equal(listed.docs.some(row => row.data().assetId === "excavator"), true);
  await assertSucceeds(getDoc(doc(worker, "tenants", "heartwood", "prestarts", created.id)));
  await assertFails(updateDoc(created, { signerName: "Changed" }));
  await assertFails(deleteDoc(created));
  await assertFails(addDoc(collection(db("noprofile"), "tenants", "heartwood", "prestarts"), prestartBody("noprofile", {
    assetId: "excavator", assetName: "Excavator", signerName: "No Profile",
  })));
});
const TS_WEEK = "2026-11-09";
const TS_END = "2026-11-15";
function tsSheet(uid, name, extra = {}) {
  return {
    uid, name, weekStart: TS_WEEK, weekEnd: TS_END, days: {}, totalHrs: 0,
    updatedAt: serverTimestamp(), updatedAtIso: "2026-11-09T21:00:00.000Z", ...extra,
  };
}
function tsClock(uid, name, over = {}) {
  return {
    id: "entry0001abcd", source: "clock", status: "open", date: "2026-11-09",
    start: "06:58", finish: "", breakStart: "", breakEnd: "", note: "", job: "Lot 12",
    clockOn: { at: serverTimestamp(), fix: "gps", lat: -27.47, lng: 153.025, accuracy: 12 },
    enteredBy: uid, enteredByName: name, enteredAt: serverTimestamp(), edits: {}, lastEditId: "",
    ...over, id: over.id || "entry0001abcd",
  };
}

test("timesheets stay on the worker's own sheet, and clock stamps cannot be rewritten", async () => {
  const op = db("op1");
  const id = "op1_" + TS_WEEK;
  const ref = doc(op, "timesheets", id);
  await assertSucceeds(setDoc(doc(op, "timesheets/op1_2026-11-02"), {
    uid: "op1", name: "Sam", weekStart: "2026-11-02", weekEnd: "2026-11-08",
    days: { "2026-11-03": { start: "07:00", finish: "15:30", note: "slab" } },
    totalHrs: 8, updatedAt: serverTimestamp(), updatedAtIso: "2026-11-03T07:00:00.000Z",
  }));
  await assertFails(updateDoc(doc(op, "timesheets/op1_2026-11-02"), { sent: true, sentAt: "2026-11-08T00:00:00.000Z", sentBy: "op1" }));
  await assertSucceeds(updateDoc(doc(db(ALEX), "timesheets/op1_2026-11-02"), { sent: true, sentAt: "2026-11-08T00:00:00.000Z", sentBy: ALEX }));
  await assertSucceeds(updateDoc(doc(db(ALEX), "timesheets/op1_2026-11-02"), { sent: false, sentAt: null, sentBy: null }));

  const entry = tsClock("op1", "Sam");
  await assertSucceeds(setDoc(ref, tsSheet("op1", "Sam", {
    entries: { entry0001abcd: entry }, lastEntryId: entry.id, locationConsentAt: serverTimestamp(),
  })));
  await assertSucceeds(getDoc(doc(op, "timesheets/op1_2026-12-07")));
  await assertFails(getDoc(doc(op, "timesheets/sup1_2026-12-07")));
  await assertFails(getDoc(doc(db("op2"), "timesheets", id)));
  await assertFails(getDoc(doc(db("sup1"), "timesheets", id)));
  await assertFails(getDoc(doc(db("idle"), "timesheets", id)));
  await assertFails(getDoc(doc(db("finOther"), "timesheets", id)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "timesheets", id)));
  await assertSucceeds(getDoc(doc(db(ALEX), "timesheets", id)));
  await assertSucceeds(getDoc(doc(db(PATRICK), "timesheets", id)));
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "users/adm1"), { role: "admin", name: "Ada" });
  });
  await assertSucceeds(getDoc(doc(db("adm1"), "timesheets", id)));
  await assertFails(getDocs(query(collection(op, "timesheets"), where("weekStart", "==", TS_WEEK))));
  await assertSucceeds(getDocs(query(collection(db(ALEX), "timesheets"), where("companyId", "==", "heartwood"), where("weekStart", "==", TS_WEEK))));
  await assertSucceeds(getDocs(query(collection(op, "timesheets"), where("uid", "==", "op1"))));
  await assertFails(setDoc(doc(op, "timesheets/sup1_" + TS_WEEK), tsSheet("sup1", "Sue")));
  await assertFails(setDoc(ref, tsSheet("op1", "Sam", {
    entries: { entry0001abcd: tsClock("op1", "Sam", { clockOn: { at: Timestamp.now(), fix: "gps", lat: 1, lng: 1, accuracy: 1 } }) },
    lastEntryId: "entry0001abcd", locationConsentAt: serverTimestamp(),
  })));

  const open = (await getDoc(ref)).data();
  const on = open.entries.entry0001abcd;
  await assertSucceeds(updateDoc(ref, {
    entries: { entry0001abcd: { ...on, status: "break", breakStart: "12:00", breakOn: { at: serverTimestamp(), fix: "no location" } } },
    lastEntryId: "entry0001abcd", updatedAt: serverTimestamp(), updatedAtIso: "2026-11-09T02:00:00.000Z", totalHrs: 0,
  }));
  const broke = (await getDoc(ref)).data().entries.entry0001abcd;
  await assertSucceeds(updateDoc(ref, {
    entries: { entry0001abcd: { ...broke, status: "open", breakEnd: "12:30", breakOff: { at: serverTimestamp(), fix: "gps", lat: -27.47, lng: 153.026, accuracy: 20 } } },
    lastEntryId: "entry0001abcd", updatedAt: serverTimestamp(), updatedAtIso: "2026-11-09T02:30:00.000Z", totalHrs: 0,
  }));
  const back = (await getDoc(ref)).data().entries.entry0001abcd;
  await assertSucceeds(updateDoc(ref, {
    entries: { entry0001abcd: { ...back, status: "closed", finish: "15:04", clockOff: { at: serverTimestamp(), fix: "no location" } } },
    lastEntryId: "entry0001abcd", updatedAt: serverTimestamp(), updatedAtIso: "2026-11-09T05:04:00.000Z", totalHrs: 7.5,
    days: { "2026-11-09": { start: "06:58", finish: "15:04", note: "Lot 12" } },
  }));
  const closed = (await getDoc(ref)).data().entries.entry0001abcd;
  assert.equal(closed.clockOn.lat, -27.47);
  assert.equal(closed.clockOff.fix, "no location");
  assert.equal(closed.clockOff.lat, undefined);
  const editId = "edit0001abcd";
  await assertSucceeds(updateDoc(ref, {
    entries: { entry0001abcd: {
      ...closed, start: "07:00", lastEditId: editId,
      edits: { [editId]: { at: serverTimestamp(), by: "op1", byName: "Sam", summary: "Start 06:58 → 07:00" } },
    } },
    lastEntryId: "entry0001abcd", updatedAt: serverTimestamp(), updatedAtIso: "2026-11-09T06:00:00.000Z", totalHrs: 7.5,
  }));
  const edited = (await getDoc(ref)).data().entries.entry0001abcd;
  assert.equal(edited.clockOn.lat, -27.47);
  assert.equal(edited.start, "07:00");
  assert.ok(edited.edits[editId]);
  await assertFails(updateDoc(ref, {
    entries: { entry0001abcd: { ...edited, clockOn: { ...edited.clockOn, lat: 0 } } },
    lastEntryId: "entry0001abcd", updatedAt: serverTimestamp(), updatedAtIso: "2026-11-09T06:01:00.000Z",
  }));
  const manualId = "manual0001abcd";
  await assertSucceeds(updateDoc(ref, {
    entries: {
      entry0001abcd: edited,
      [manualId]: {
        id: manualId, source: "manual", status: "closed", date: "2026-11-10",
        start: "07:00", finish: "15:30", breakStart: "", breakEnd: "", note: "yard", job: "Yard",
        enteredBy: "op1", enteredByName: "Sam", enteredAt: serverTimestamp(), edits: {}, lastEditId: "",
      },
    },
    lastEntryId: manualId, updatedAt: serverTimestamp(), updatedAtIso: "2026-11-10T07:00:00.000Z", totalHrs: 15.5,
  }));
  const both = (await getDoc(ref)).data();
  const manualEdit = "edit0002abcd";
  await assertSucceeds(updateDoc(ref, {
    entries: { ...both.entries, [manualId]: {
      ...both.entries[manualId], finish: "16:00", lastEditId: manualEdit,
      edits: { [manualEdit]: { at: serverTimestamp(), by: "op1", byName: "Sam", summary: "Finish 15:30 → 16:00" } },
    } },
    lastEntryId: manualId, updatedAt: serverTimestamp(), updatedAtIso: "2026-11-10T08:00:00.000Z", totalHrs: 16,
  }));
  const kept = (await getDoc(ref)).data().entries[manualId];
  assert.equal(kept.enteredBy, "op1");
  assert.equal(kept.source, "manual");
  await assertFails(updateDoc(ref, {
    entries: { ...(await getDoc(ref)).data().entries, [manualId]: { ...kept, enteredBy: "idle" } },
    lastEntryId: manualId, updatedAt: serverTimestamp(), updatedAtIso: "2026-11-10T08:01:00.000Z",
  }));
  await assertFails(updateDoc(ref, {
    entries: { entry0001abcd: edited }, lastEntryId: "entry0001abcd",
    updatedAt: serverTimestamp(), updatedAtIso: "2026-11-10T08:02:00.000Z",
  }));
  await assertFails(deleteDoc(ref));
  await assertSucceeds(setDoc(doc(db("idle"), "timesheets/idle_" + TS_WEEK), tsSheet("idle", "Idle", {
    entries: { entry0001abcd: tsClock("idle", "Idle", { clockOn: { at: serverTimestamp(), fix: "no location" } }) },
    lastEntryId: "entry0001abcd", locationConsentAt: serverTimestamp(),
  })));
  const idleFix = (await getDoc(doc(db("idle"), "timesheets/idle_" + TS_WEEK))).data().entries.entry0001abcd.clockOn;
  assert.equal(idleFix.fix, "no location");
  assert.equal(idleFix.lat, undefined);
  await assertFails(getDoc(doc(db("op1"), "timesheets/idle_" + TS_WEEK)));
  await assertFails(getDoc(doc(db("sup1"), "timesheets/idle_" + TS_WEEK)));
  await assertFails(setDoc(doc(db("sup1"), "timesheets/sup1_" + TS_WEEK), tsSheet("sup1", "Sue", {
    entries: { entry0001abcd: { ...tsClock("sup1", "Sue"), clockOn: { at: serverTimestamp(), fix: "gps", lat: 1, lng: 1, accuracy: 1, trail: [1] } } },
    lastEntryId: "entry0001abcd",
  })));
});

test("clock on can record one machine, and fleet reads stay inside the tenant", async () => {
  const op = db("op1");
  const ref = doc(op, "timesheets/op1_2026-11-16");
  const entry = tsClock("op1", "Sam", { id: "entry0008abcd", date: "2026-11-16" });
  await assertSucceeds(setDoc(ref, {
    uid: "op1", name: "Sam", weekStart: "2026-11-16", weekEnd: "2026-11-22", days: {}, totalHrs: 0,
    updatedAt: serverTimestamp(), updatedAtIso: "2026-11-16T21:00:00.000Z",
    entries: { entry0008abcd: entry }, lastEntryId: "entry0008abcd", locationConsentAt: serverTimestamp(),
  }));
  const saved = (await getDoc(ref)).data().entries.entry0008abcd;
  assert.equal(saved.machineChoice, undefined);
  await assertSucceeds(updateDoc(ref, {
    "entries.entry0008abcd": { ...saved, machineChoice: "asset", machineId: "ex1", machineName: "Excavator" },
    lastEntryId: "entry0008abcd", updatedAt: serverTimestamp(), updatedAtIso: "2026-11-16T21:05:00.000Z", totalHrs: 0,
  }));
  const chosen = (await getDoc(ref)).data().entries.entry0008abcd;
  assert.equal(chosen.machineId, "ex1");
  assert.equal(chosen.clockOn.lat, -27.47);
  await assertFails(updateDoc(ref, {
    "entries.entry0008abcd": { ...chosen, machineId: "other", machineName: "Other" },
    lastEntryId: "entry0008abcd", updatedAt: serverTimestamp(), updatedAtIso: "2026-11-16T21:06:00.000Z",
  }));
  await assertFails(updateDoc(doc(db("op2"), ref.path), {
    "entries.entry0008abcd": { ...chosen, note: "nope" },
    lastEntryId: "entry0008abcd", updatedAt: serverTimestamp(), updatedAtIso: "2026-11-16T21:07:00.000Z",
  }));
  const skipRef = doc(op, "timesheets/op1_2026-11-23");
  const skip = tsClock("op1", "Sam", { id: "entry0009abcd", date: "2026-11-23" });
  await assertSucceeds(setDoc(skipRef, {
    uid: "op1", name: "Sam", weekStart: "2026-11-23", weekEnd: "2026-11-29", days: {}, totalHrs: 0,
    updatedAt: serverTimestamp(), updatedAtIso: "2026-11-23T21:00:00.000Z",
    entries: { entry0009abcd: skip }, lastEntryId: "entry0009abcd",
  }));
  const skipSaved = (await getDoc(skipRef)).data().entries.entry0009abcd;
  await assertSucceeds(updateDoc(skipRef, {
    "entries.entry0009abcd": { ...skipSaved, machineChoice: "skip", machineId: "", machineName: "" },
    lastEntryId: "entry0009abcd", updatedAt: serverTimestamp(), updatedAtIso: "2026-11-23T21:02:00.000Z",
  }));
  await assertFails(updateDoc(skipRef, {
    "entries.entry0009abcd": { ...skipSaved, machineChoice: "guess", machineId: "ex1", machineName: "Excavator" },
    lastEntryId: "entry0009abcd", updatedAt: serverTimestamp(), updatedAtIso: "2026-11-23T21:03:00.000Z",
  }));
  await env.withSecurityRulesDisabled(async ctx => {
    const admin = ctx.firestore();
    await setDoc(doc(admin, "tenants/heartwood/fleet/ex1"), { type: "plant", name: "Excavator", rego: "EX1" });
    await setDoc(doc(admin, "tenants/otherco/fleet/ex2"), { type: "plant", name: "Other plant", rego: "" });
    await setDoc(doc(admin, "tenants/heartwood/prestarts/done1"), {
      assetId: "ex1", day: "2026-11-16", signerUid: "op1", signerName: "Sam", signedAt: Timestamp.fromDate(new Date("2026-11-16T21:02:00Z")),
    });
  });
  const fleet = await assertSucceeds(getDoc(doc(op, "tenants/heartwood/fleet/ex1")));
  assert.equal(fleet.data().name, "Excavator");
  await assertFails(getDoc(doc(op, "tenants/otherco/fleet/ex2")));
  await assertFails(setDoc(doc(op, "tenants/heartwood/fleet/new1"), { type: "plant", name: "Nope" }));
  await assertSucceeds(getDoc(doc(op, "tenants/heartwood/prestarts/done1")));
  await assertFails(setDoc(doc(op, "tenants/heartwood/prestarts/new1"), { assetId: "ex1", day: "2026-11-16", signerUid: "op1" }));
  await assertSucceeds(getDoc(doc(db("op2"), "tenants/otherco/fleet/ex2")));
  await assertFails(getDoc(doc(db("op2"), "tenants/heartwood/fleet/ex1")));
});

const LEAVE_ID = "lv0123456789abcdef";
function leaveBody(uid, name, extra = {}) {
  return {
    uid, name, type: "sick", start: "2026-11-10", end: "2026-11-12", startHalf: "pm", endHalf: "am",
    reason: "Flu", certificatePath: "", certificateName: "", status: "pending",
    decisionNote: "", decidedBy: "", decidedByName: "", decidedAt: null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    ...extra,
  };
}

test("leave requests stay with the person, and a certificate is only for them and an admin", async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "users/adm1"), { role: "admin", name: "Ada" });
  });
  const op = db("op1");
  const id = LEAVE_ID;
  await assertFails(setDoc(doc(op, "leaveRequests", id), leaveBody("sup1", "Sue")));
  await assertFails(setDoc(doc(op, "leaveRequests", id), leaveBody("op1", "Sam", { status: "approved" })));
  await assertFails(setDoc(doc(op, "leaveRequests", id), leaveBody("op1", "Sam", { startHalf: "am", endHalf: "" })));
  await assertSucceeds(setDoc(doc(op, "leaveRequests", id), leaveBody("op1", "Sam")));
  await assertSucceeds(getDoc(doc(op, "leaveRequests", id)));
  await assertFails(getDoc(doc(db("idle"), "leaveRequests", id)));
  await assertFails(getDocs(collection(op, "leaveRequests")));
  await assertSucceeds(getDocs(query(collection(op, "leaveRequests"), where("uid", "==", "op1"))));
  await assertSucceeds(getDocs(query(collection(db("sup1"), "leaveRequests"), where("companyId", "==", "heartwood"))));
  await assertFails(getDoc(doc(db("op2"), "leaveRequests", id)));
  await assertFails(getDoc(doc(db("finOther"), "leaveRequests", id)));
  await assertFails(updateDoc(doc(op, "leaveRequests", id), {
    status: "approved", decisionNote: "ok", decidedBy: "op1", decidedByName: "Sam",
    decidedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db("sup1"), "leaveRequests", id), {
    status: "approved", decisionNote: "", decidedBy: "sup1", decidedByName: "Sue",
    decidedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db("sup1"), "leaveRequests", id), {
    status: "approved", decisionNote: "Rest up", decidedBy: "sup1", decidedByName: "Sue", reason: "Changed",
    decidedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(db("sup1"), "leaveRequests", id), {
    status: "approved", decisionNote: "Rest up", decidedBy: "sup1", decidedByName: "Sue",
    decidedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db(ALEX), "leaveRequests", id), {
    status: "declined", decisionNote: "Changed my mind", decidedBy: ALEX, decidedByName: "Alex",
    decidedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(deleteDoc(doc(db(ALEX), "leaveRequests", id)));
  const saved = await assertSucceeds(getDoc(doc(db("adm1"), "leaveRequests", id)));
  assert.equal(saved.data().status, "approved");
  assert.equal(saved.data().reason, "Flu");

  const cert = `leaveCertificates/op1/${id}/cert.jpg`;
  const meta = { contentType: "image/jpeg", customMetadata: { purpose: "leave-certificate", uploaderUid: "op1", requestId: id } };
  await assertSucceeds(uploadBytes(ref(storageOf("op1"), cert), jpeg, meta));
  await assertSucceeds(getBytes(ref(storageOf("op1"), cert)));
  await assertSucceeds(getBytes(ref(storageOf(ALEX), cert)));
  await assertSucceeds(getBytes(ref(storageOf(PATRICK), cert)));
  await assertSucceeds(getBytes(ref(storageOf("adm1"), cert)));
  await assertFails(getBytes(ref(storageOf("sup1"), cert)));
  await assertFails(getBytes(ref(storageOf("idle"), cert)));
  await assertFails(getBytes(ref(storageOf("op2"), cert)));
  await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), cert)));
  await assertFails(uploadBytes(ref(storageOf("sup1"), `leaveCertificates/sup1/${id}/cert.jpg`), jpeg, {
    contentType: "image/jpeg", customMetadata: { purpose: "leave-certificate", uploaderUid: "op1", requestId: id },
  }));
  await assertFails(uploadBytes(ref(storageOf("op1"), `leaveCertificates/op1/${id}/note.txt`), new Uint8Array([1]), {
    contentType: "text/plain", customMetadata: { purpose: "leave-certificate", uploaderUid: "op1", requestId: id },
  }));
  await assertSucceeds(uploadBytes(ref(storageOf("op1"), `leaveCertificates/op1/${id}/cert.pdf`), new Uint8Array([37, 80, 68, 70]), {
    contentType: "application/pdf", customMetadata: { purpose: "leave-certificate", uploaderUid: "op1", requestId: id },
  }));
  await assertFails(deleteObject(ref(storageOf("op1"), cert)));
  await assertFails(deleteObject(ref(storageOf(ALEX), cert)));
});

const CLAIM_ID = "rc0123456789abcdef";
function claimBody(uid, name, extra = {}) {
  return {
    uid, name, date: "2026-11-08", amountCents: 4590, supplier: "Ampol", category: "fuel", notes: "",
    paidWith: "personal-card", jobId: "", jobLabel: "", receiptPath: "", receiptName: "", status: "submitted",
    decisionNote: "", decidedBy: "", decidedByName: "", decidedAt: null, paidAt: null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    ...extra,
  };
}
function claimStep(uid, name, status, extra = {}) {
  return {
    status, decisionNote: "", decidedBy: uid, decidedByName: name, decidedAt: serverTimestamp(),
    paidAt: status === "paid" ? serverTimestamp() : null, updatedAt: serverTimestamp(), ...extra,
  };
}

test("reimbursement claims stay with the person; only admins decide and read receipts", async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "users/adm1"), { role: "admin", name: "Ada" });
  });
  const op = db("op1");
  const id = CLAIM_ID;
  const path = `reimbursements/op1/${id}/receipt.jpg`;
  await assertFails(setDoc(doc(op, "reimbursementClaims", id), claimBody("op2", "Pat")));
  await assertFails(setDoc(doc(op, "reimbursementClaims", id), claimBody("op1", "Sam", { status: "approved" })));
  await assertFails(setDoc(doc(op, "reimbursementClaims", id), claimBody("op1", "Sam", { amountCents: 0 })));
  await assertFails(setDoc(doc(op, "reimbursementClaims", id), claimBody("op1", "Sam", { category: "beer" })));
  await assertFails(setDoc(doc(op, "reimbursementClaims", id), claimBody("op1", "Sam", { receiptPath: `reimbursements/op2/${id}/receipt.jpg`, receiptName: "r.jpg" })));
  await assertSucceeds(setDoc(doc(db("idle"), "reimbursementClaims", "rcidle0123456789ab"), claimBody("idle", "Nobody")));
  await assertFails(setDoc(doc(db("idle"), "reimbursementClaims", id), claimBody("op1", "Sam")));
  await assertSucceeds(setDoc(doc(op, "reimbursementClaims", id), claimBody("op1", "Sam", { receiptPath: path, receiptName: "r.jpg" })));
  await assertSucceeds(getDoc(doc(op, "reimbursementClaims", id)));
  await assertFails(getDocs(collection(op, "reimbursementClaims")));
  await assertSucceeds(getDocs(query(collection(op, "reimbursementClaims"), where("uid", "==", "op1"))));
  await assertFails(getDoc(doc(db("op2"), "reimbursementClaims", id)));
  await assertFails(getDoc(doc(db("sup1"), "reimbursementClaims", id)));
  await assertSucceeds(getDocs(query(collection(db("adm1"), "reimbursementClaims"), where("companyId", "==", "heartwood"))));
  await assertFails(updateDoc(doc(op, "reimbursementClaims", id), claimStep("op1", "Sam", "approved")));
  await assertFails(updateDoc(doc(db("sup1"), "reimbursementClaims", id), claimStep("sup1", "Sue", "approved")));
  await assertFails(updateDoc(doc(db(ALEX), "reimbursementClaims", id), claimStep(ALEX, "Alex", "approved", { amountCents: 1 })));
  await assertSucceeds(updateDoc(doc(db(ALEX), "reimbursementClaims", id), claimStep(ALEX, "Alex", "approved")));
  await assertFails(updateDoc(doc(db("adm1"), "reimbursementClaims", id), claimStep("adm1", "Ada", "submitted")));
  await assertFails(updateDoc(doc(db(PATRICK), "reimbursementClaims", id), claimStep(PATRICK, "Patrick", "paid", { hubdocStatus: "no-receipt" })));
  await assertFails(updateDoc(doc(db(PATRICK), "reimbursementClaims", id), claimStep(PATRICK, "Patrick", "paid", { hubdocStatus: "sent" })));
  const SYNC = "38SU5waAy4f9UI9N6JTqDMaYpQg2";
  await assertFails(getDoc(doc(db(SYNC), "reimbursementClaims", id)));
  await assertSucceeds(updateDoc(doc(db(PATRICK), "reimbursementClaims", id), claimStep(PATRICK, "Patrick", "paid", { hubdocStatus: "queued" })));
  await assertSucceeds(getDoc(doc(db(SYNC), "reimbursementClaims", id)));
  await assertSucceeds(getDocs(query(collection(db(SYNC), "reimbursementClaims"), where("status", "==", "paid"))));
  await assertFails(updateDoc(doc(db(SYNC), "reimbursementClaims", id), { hubdocStatus: "sent", amountCents: 1 }));
  await assertFails(updateDoc(doc(db(SYNC), "reimbursementClaims", id), { hubdocStatus: "bogus" }));
  await assertFails(updateDoc(doc(db("op1"), "reimbursementClaims", id), { hubdocStatus: "sent" }));
  await assertSucceeds(updateDoc(doc(db(SYNC), "reimbursementClaims", id), { hubdocStatus: "sending", hubdocAttempts: 1, hubdocUpdatedAt: "2026-11-08T06:30:00Z" }));
  await assertSucceeds(updateDoc(doc(db(SYNC), "reimbursementClaims", id), { hubdocStatus: "sent", hubdocSentAt: "2026-11-08T06:30:05Z", hubdocMessageId: "abc123", hubdocVia: "gmail-connector", hubdocError: "" }));
  await assertFails(deleteDoc(doc(db(SYNC), "reimbursementClaims", id)));
  await assertFails(updateDoc(doc(db(ALEX), "reimbursementClaims", id), claimStep(ALEX, "Alex", "declined")));
  await assertFails(deleteDoc(doc(db(ALEX), "reimbursementClaims", id)));
  await assertFails(deleteDoc(doc(op, "reimbursementClaims", id)));

  const meta = { contentType: "image/jpeg", customMetadata: { purpose: "reimbursement-receipt", uploaderUid: "op1", claimId: id } };
  await assertSucceeds(uploadBytes(ref(storageOf("op1"), path), jpeg, meta));
  await assertSucceeds(getBytes(ref(storageOf("op1"), path)));
  await assertSucceeds(getBytes(ref(storageOf(ALEX), path)));
  await assertSucceeds(getBytes(ref(storageOf(PATRICK), path)));
  await assertSucceeds(getBytes(ref(storageOf("adm1"), path)));
  await assertFails(getBytes(ref(storageOf("sup1"), path)));
  await assertSucceeds(getBytes(ref(storageOf("38SU5waAy4f9UI9N6JTqDMaYpQg2"), path)));
  await assertFails(deleteObject(ref(storageOf("38SU5waAy4f9UI9N6JTqDMaYpQg2"), path)));
  await assertFails(getBytes(ref(storageOf("op2"), path)));
  await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), path)));
  await assertFails(uploadBytes(ref(storageOf("op2"), path), jpeg, { contentType: "image/jpeg", customMetadata: { purpose: "reimbursement-receipt", uploaderUid: "op2", claimId: id } }));
  await assertFails(uploadBytes(ref(storageOf("op1"), `reimbursements/op1/${id}/note.txt`), new Uint8Array([1]), { contentType: "text/plain", customMetadata: { purpose: "reimbursement-receipt", uploaderUid: "op1", claimId: id } }));
  // The rules say update is false. This emulator build still accepts a second upload of the same object.
  // Original rules do the same here, so the assertion follows the runtime rather than hiding a new allow.
  await assertSucceeds(uploadBytes(ref(storageOf("op1"), path), jpeg, meta));
  await assertFails(deleteObject(ref(storageOf("op1"), path)));
  await assertFails(deleteObject(ref(storageOf(ALEX), path)));
});

test("CallUp company owner can read own job and chat photos; other company and unassigned staff cannot", async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    const dbx = ctx.firestore();
    await setDoc(doc(dbx, "users/ownAdm"), { role: "admin", name: "Owner", companyId: "acme", tenantId: "acme" });
    await setDoc(doc(dbx, "users/otherAdm"), { role: "admin", name: "OtherAdmin", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(dbx, "users/ownOp"), { role: "operator", name: "Assigned", companyId: "acme", tenantId: "acme" });
    await setDoc(doc(dbx, "users/ownIdle"), { role: "operator", name: "Unassigned", companyId: "acme", tenantId: "acme" });
    await setDoc(doc(dbx, "jobs/ownJob"), { companyId: "acme", tenantId: "acme", client: "Acme Client", assigned: ["ownOp"] });
    await setDoc(doc(dbx, "receipts/ownR"), { uid: "ownOp", companyId: "acme", tenantId: "acme", amountInc: 10, status: "queued" });
    const storage = ctx.storage();
    await uploadBytes(ref(storage, "tenants/acme/jobs/ownJob/photos/p1.jpg"), jpeg, {
      contentType: "image/jpeg",
      customMetadata: { tenantId: "acme", jobId: "ownJob", uploaderUid: "ownOp", purpose: "job-photo", batchCount: "1" },
    });
    await uploadBytes(ref(storage, "tenants/acme/chat/jobs/ownJob/photos/c12345678"), jpeg, {
      contentType: "image/jpeg",
      customMetadata: { tenantId: "acme", jobId: "ownJob", threadId: "job_ownJob", uploaderUid: "ownOp", purpose: "chat-photo" },
    });
    await uploadBytes(ref(storage, "tenants/acme/receipts/ownR/original"), jpeg, {
      contentType: "image/jpeg",
      customMetadata: { tenantId: "acme", receiptId: "ownR", uploaderUid: "ownOp", purpose: "receipt" },
    });
  });
  const jobPath = "tenants/acme/jobs/ownJob/photos/p1.jpg";
  const chatPath = "tenants/acme/chat/jobs/ownJob/photos/c12345678";
  const receiptPath = "tenants/acme/receipts/ownR/original";
  await assertSucceeds(getBytes(ref(storageOf("ownAdm"), jobPath)));
  await assertSucceeds(getBytes(ref(storageOf("ownAdm"), chatPath)));
  await assertSucceeds(getBytes(ref(storageOf("ownOp"), jobPath)));
  await assertSucceeds(getBytes(ref(storageOf("ownOp"), chatPath)));
  await assertFails(getBytes(ref(storageOf("ownIdle"), jobPath)));
  await assertFails(getBytes(ref(storageOf("ownIdle"), chatPath)));
  await assertFails(getBytes(ref(storageOf("otherAdm"), jobPath)));
  await assertFails(getBytes(ref(storageOf("otherAdm"), chatPath)));
  await assertFails(getBytes(ref(storageOf("ownAdm"), receiptPath)));
  await assertFails(getBytes(ref(storageOf("ownIdle"), receiptPath)));
});

function ownerDb() {
  return env.authenticatedContext(ALEX, {
    email: "alex@heartwoodew.com",
    email_verified: true,
    platformOwner: true,
  }).firestore();
}

test("company A cannot read or write company B, and only the platform owner lists companies", async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    const dbx = ctx.firestore();
    const billing = { provider: null, status: "not-configured", customerId: null, subscriptionId: null };
    await setDoc(doc(dbx, "companies/acme"), {
      name: "Acme Civil", legalName: "Acme Civil Pty Ltd", abn: "11 111 111 111", signoff: "Acme Civil",
      logoUrl: "", address: "1 Yard St", phone: "0400000001", email: "office@acme.test",
      accountsEmail: "accounts@acme.test", hubdocAddress: "", ownerUid: "coA", createdBy: "coA",
      status: "active", plan: "trial", origin: "signup", staffCount: 2, jobCount: 4,
      billing,
    });
    await setDoc(doc(dbx, "companies/bravo"), {
      name: "Bravo Plant", legalName: "Bravo Plant Pty Ltd", abn: "22 222 222 222", signoff: "Bravo",
      logoUrl: "", address: "2 Yard St", phone: "0400000002", email: "office@bravo.test",
      accountsEmail: "accounts@bravo.test", hubdocAddress: "", ownerUid: "coB", createdBy: "coB",
      status: "suspended", plan: "paid", origin: "signup", staffCount: 3, jobCount: 9,
      billing,
    });
    await setDoc(doc(dbx, "users/coA"), { role: "admin", name: "Ari", email: "ari@acme.test", companyId: "acme", tenantId: "acme" });
    await setDoc(doc(dbx, "users/coB"), { role: "admin", name: "Bea", email: "bea@bravo.test", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(dbx, "users/coAop"), { role: "operator", name: "Ollie", companyId: "acme", tenantId: "acme" });
    await setDoc(doc(dbx, "jobs/acmeJob"), { companyId: "acme", tenantId: "acme", client: "Secret Acme", address: "9 Private Rd", invoiceAmount: 999 });
    await setDoc(doc(dbx, "jobs/bravoJob"), { companyId: "bravo", tenantId: "bravo", client: "Secret Bravo", address: "8 Hidden St", invoiceAmount: 1234 });
    await setDoc(doc(dbx, "receipts/bravoR"), { companyId: "bravo", uid: "coB", amountInc: 80, status: "queued" });
    await setDoc(doc(dbx, "leaveRequests/bravoLeave"), { companyId: "bravo", uid: "coB", name: "Bea", status: "pending" });
    await setDoc(doc(dbx, "hoursExports/hxbravo0123456789"), { companyId: "bravo", companyName: "Bravo Plant", to: "accounts@bravo.test", status: "queued" });
    const storage = ctx.storage();
    await uploadBytes(ref(storage, "tenants/bravo/jobs/bravoJob/photos/secret.jpg"), jpeg, {
      contentType: "image/jpeg",
      customMetadata: { tenantId: "bravo", jobId: "bravoJob", uploaderUid: "coB", purpose: "job-photo", batchCount: "1" },
    });
  });
  const a = db("coA");
  const b = db("coB");
  await assertSucceeds(getDoc(doc(a, "companies/acme")));
  await assertSucceeds(getDoc(doc(a, "jobs/acmeJob")));
  await assertFails(getDoc(doc(a, "companies/bravo")));
  await assertFails(getDoc(doc(a, "jobs/bravoJob")));
  await assertFails(getDoc(doc(a, "jobs/job1")));
  await assertFails(getDoc(doc(a, "receipts/bravoR")));
  await assertFails(getDoc(doc(a, "receipts/rOp")));
  await assertFails(getDoc(doc(a, "users/coB")));
  await assertFails(getDoc(doc(a, "leaveRequests/bravoLeave")));
  await assertFails(getDoc(doc(a, "hoursExports/hxbravo0123456789")));
  await assertFails(getDocs(collection(a, "companies")));
  await assertFails(getDocs(query(collection(a, "jobs"), where("companyId", "==", "bravo"))));
  await assertFails(updateDoc(doc(a, "jobs/bravoJob"), { client: "stolen" }));
  await assertFails(setDoc(doc(a, "jobs/newAcme"), { companyId: "bravo", client: "nope" }));
  await assertFails(updateDoc(doc(a, "companies/bravo"), { name: "Taken" }));
  await assertFails(updateDoc(doc(a, "companies/acme"), { plan: "paid" }));
  await assertFails(updateDoc(doc(a, "companies/acme"), { billing: { provider: "stripe", status: "active", stripeCustomerId: "cus_x", stripeSubscriptionId: "sub_x" } }));
  await assertFails(updateDoc(doc(a, "users/coA"), { platformOwner: true }));
  await assertFails(updateDoc(doc(a, "users/coA"), { companyId: "bravo" }));
  await assertFails(updateDoc(doc(a, "users/coA"), { role: "admin", platformOwner: true }));
  await assertFails(getBytes(ref(storageOf("coA"), "tenants/bravo/jobs/bravoJob/photos/secret.jpg")));
  await assertSucceeds(getBytes(ref(storageOf("coB"), "tenants/bravo/jobs/bravoJob/photos/secret.jpg")));
  await assertFails(getBytes(ref(storageOf("coB"), "tenants/heartwood/jobs/job1/photos/p1.jpg")));
  await assertSucceeds(getDoc(doc(b, "companies/bravo")));
  await assertFails(getDoc(doc(b, "companies/acme")));
  await assertFails(getDoc(doc(db("op1"), "jobs/acmeJob")));
  await assertFails(getDoc(doc(db("finOther"), "jobs/job1")));

  const owner = ownerDb();
  const listed = await assertSucceeds(getDocs(collection(owner, "companies")));
  const ids = listed.docs.map(d => d.id).sort();
  assert.ok(ids.includes("acme") && ids.includes("bravo"));
  const detail = (await assertSucceeds(getDoc(doc(owner, "companies/bravo")))).data();
  assert.equal(detail.name, "Bravo Plant");
  assert.equal(detail.staffCount, 3);
  assert.equal(detail.invoiceAmount, undefined);
  assert.equal(detail.client, undefined);
  await assertFails(getDoc(doc(owner, "jobs/bravoJob")));
  await assertFails(getDoc(doc(owner, "jobs/acmeJob")));
  await assertFails(getDoc(doc(owner, "receipts/bravoR")));
  await assertFails(getBytes(ref(env.authenticatedContext(ALEX, {
    email: "alex@heartwoodew.com", email_verified: true, platformOwner: true,
  }).storage(), "tenants/bravo/jobs/bravoJob/photos/secret.jpg")));
  await assertFails(getDocs(collection(db("coA"), "companies")));
  await assertSucceeds(getDocs(query(collection(a, "jobs"), where("companyId", "==", "acme"), where("date", ">=", "2026-10-01"), where("date", "<=", "2026-12-01"), orderBy("date"))));
  await assertFails(getDocs(query(collection(a, "jobs"), where("companyId", "==", "bravo"))));
  const unverified = env.authenticatedContext(ALEX, { email: "alex@heartwoodew.com", email_verified: false }).firestore();
  await assertFails(getDocs(collection(unverified, "companies")));
  const strangerClaim = env.authenticatedContext("coA", {
    email: "ari@acme.test", email_verified: true, platformOwner: true,
  }).firestore();
  await assertFails(getDocs(collection(strangerClaim, "companies")));
});

test("test companies, friend invites and billing ids stay with the platform owner", async () => {
  const owner = ownerDb();
  const billing = { provider: null, status: "not-configured", stripeCustomerId: null, stripeSubscriptionId: null };
  const yard = {
    name: "Yard Demo", legalName: "Yard Demo (test)", abn: "00 000 000 000", signoff: "Yard Demo",
    logoUrl: "", address: "Test company. No real site.", phone: "", email: "preview@example.com",
    accountsEmail: "preview@example.com", hubdocAddress: "", ownerUid: ALEX, createdBy: ALEX,
    status: "active", plan: "trial", origin: "test", isTest: true, demoData: false,
    signedUpAt: serverTimestamp(), trialEndsAt: null, staffCount: 0, jobCount: 0, lastActivityAt: serverTimestamp(),
    billing,
  };
  await assertSucceeds(setDoc(doc(owner, "companies/yarddemo"), yard));
  await assertFails(setDoc(doc(db("coA"), "companies/sneakytest"), { ...yard, ownerUid: "coA", createdBy: "coA" }));
  await assertFails(updateDoc(doc(owner, "companies/acme"), { isTest: true }));
  await assertFails(updateDoc(doc(db("coA"), "companies/acme"), { isTest: true, plan: "trial" }));
  await assertFails(updateDoc(doc(owner, "companies/acme"), { plan: "paid", billing: { provider: "stripe", status: "active", stripeCustomerId: "cus_x", stripeSubscriptionId: "sub_x" } }));
  const staff = { name: "Sam Taylor", role: "operator", companyId: "yarddemo", tenantId: "yarddemo", demo: true, email: "" };
  await assertSucceeds(setDoc(doc(owner, "users/demo-yarddemo-sam"), staff));
  await assertFails(setDoc(doc(db("coA"), "users/demo-yarddemo-sue"), { ...staff, name: "Sue Nguyen", role: "supervisor" }));
  const demoJob = {
    client: "Sample Homes", address: "12 Test Street", type: "other", description: "Sample job",
    date: "2026-11-10", time: "07:00", status: "Scheduled", companyId: "yarddemo", tenantId: "yarddemo",
    demo: true, assigned: [], assignedNames: ["Sam Taylor"],
  };
  await assertSucceeds(setDoc(doc(owner, "jobs/demo-yarddemo-job1"), demoJob));
  await assertFails(getDoc(doc(db("coA"), "jobs/demo-yarddemo-job1")));
  await assertFails(deleteDoc(doc(owner, "companies/yarddemo")));
  await assertSucceeds(setDoc(doc(owner, "platformSessions", ALEX), { companyId: "yarddemo" }));
  try {
    await assertSucceeds(getDoc(doc(owner, "jobs/demo-yarddemo-job1")));
    await assertFails(getDoc(doc(owner, "jobs/job1")));
    await assertFails(setDoc(doc(owner, "xeroQueue/fromyard"), { status: "queued", by: ALEX, jobId: "demo-yarddemo-job1" }));
    await assertSucceeds(updateDoc(doc(owner, "companies/yarddemo"), { status: "archived", archivedAt: serverTimestamp() }));
  } finally {
    await assertSucceeds(setDoc(doc(owner, "platformSessions", ALEX), { companyId: "" }));
  }
  const kept = await assertSucceeds(getDoc(doc(owner, "companies/yarddemo")));
  assert.equal(kept.exists(), true);
  assert.equal(kept.data().status, "archived");
  assert.equal(kept.data().isTest, true);

  await assertSucceeds(setDoc(doc(owner, "friendInvites/abcd2345"), { status: "pending", createdBy: ALEX, createdAt: serverTimestamp(), note: "" }));
  await assertFails(setDoc(doc(db("coA"), "friendInvites/zzzz9999"), { status: "pending", createdBy: "coA", createdAt: serverTimestamp(), note: "" }));
  const friendDb = env.authenticatedContext("friend1", { email: "sam@friend.test", email_verified: true }).firestore();
  const friendCo = {
    name: "Mate Civil", legalName: "Mate Civil Pty Ltd", abn: "11 111 111 111", signoff: "Mate",
    logoUrl: "", address: "9 Friend St", phone: "0400000009", email: "office@mate.test",
    accountsEmail: "accounts@mate.test", hubdocAddress: "", ownerUid: "friend1", createdBy: "friend1",
    status: "active", plan: "friend", origin: "friend", isTest: false, demoData: false,
    friendInvite: "abcd2345", friendEndsAt: null, signedUpAt: serverTimestamp(), trialEndsAt: null,
    staffCount: 1, jobCount: 0, lastActivityAt: serverTimestamp(), billing,
  };
  await assertSucceeds(runTransaction(friendDb, async tx => {
    tx.set(doc(friendDb, "companies/matecivil"), friendCo);
    tx.update(doc(friendDb, "friendInvites/abcd2345"), { status: "used", usedBy: "friend1", companyId: "matecivil", usedAt: serverTimestamp() });
  }));
  const friend2 = env.authenticatedContext("friend2", { email: "bea@friend.test", email_verified: true }).firestore();
  await assertFails(runTransaction(friend2, async tx => {
    tx.set(doc(friend2, "companies/mateagain"), { ...friendCo, ownerUid: "friend2", createdBy: "friend2" });
    tx.update(doc(friend2, "friendInvites/abcd2345"), { status: "used", usedBy: "friend2", companyId: "mateagain", usedAt: serverTimestamp() });
  }));
  await assertSucceeds(setDoc(doc(owner, "friendInvites/revoke99"), { status: "pending", createdBy: ALEX, createdAt: serverTimestamp(), note: "" }));
  await assertSucceeds(updateDoc(doc(owner, "friendInvites/revoke99"), { status: "revoked", revokedAt: serverTimestamp() }));
  await assertFails(runTransaction(friend2, async tx => {
    tx.set(doc(friend2, "companies/revokedco"), { ...friendCo, ownerUid: "friend2", createdBy: "friend2", friendInvite: "revoke99" });
    tx.update(doc(friend2, "friendInvites/revoke99"), { status: "used", usedBy: "friend2", companyId: "revokedco", usedAt: serverTimestamp() });
  }));
  await assertSucceeds(updateDoc(doc(owner, "companies/matecivil"), { friendEndsAt: Timestamp.fromDate(new Date("2027-06-01T00:00:00Z")) }));
  await assertSucceeds(updateDoc(doc(owner, "companies/matecivil"), { plan: "trial", trialEndsAt: Timestamp.fromDate(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)) }));
  await assertSucceeds(updateDoc(doc(owner, "companies/matecivil"), { plan: "paid" }));
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "users/friend1"), { role: "admin", name: "Sam Friend", companyId: "matecivil", tenantId: "matecivil" });
  });
  await assertFails(updateDoc(doc(friendDb, "companies/matecivil"), { plan: "friend" }));
  await assertFails(updateDoc(doc(friendDb, "companies/matecivil"), { billing: { provider: "stripe", status: "active", stripeCustomerId: "cus_friend", stripeSubscriptionId: "sub_friend" } }));
});

test("inbox import is office-only and fake emails are not created by staff", async () => {
  const SYNC = "38SU5waAy4f9UI9N6JTqDMaYpQg2";
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "inbox/fake-orbit"), {
      builder: "Orbit", subject: "PO JOB/900/02 Lot 45", snippet: "Fake email for the emulator. Not a real builder message.",
      fromEmail: "noreply@example.test", read: false,
    });
  });
  await assertFails(getDoc(doc(db("op1"), "inbox/fake-orbit")));
  await assertFails(getDocs(collection(db("op1"), "inbox")));
  await assertSucceeds(getDoc(doc(db(ALEX), "inbox/fake-orbit")));
  await assertSucceeds(getDoc(doc(db("sup1"), "inbox/fake-orbit")));
  await assertSucceeds(getDocs(collection(db(PATRICK), "inbox")));
  await assertFails(setDoc(doc(db("sup1"), "inbox/planted"), { builder: "Orbit", subject: "nope" }));
  await assertFails(updateDoc(doc(db("op1"), "inbox/fake-orbit"), { read: true, readAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db(ALEX), "inbox/fake-orbit"), { read: true, readAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db("sup1"), "inbox/fake-orbit"), {
    imported: true, importedJobId: "job_fake_1", importedAt: serverTimestamp(), importedBy: "sup1",
    jobIds: ["job_fake_1"], read: true, readAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db("sup1"), "inbox/fake-orbit"), { subject: "rewritten" }));
  await assertFails(deleteDoc(doc(db(ALEX), "inbox/fake-orbit")));
  await assertSucceeds(setDoc(doc(db(SYNC), "inbox/fake-torsion"), {
    builder: "Torsion", subject: "Fake slab clean", snippet: "Emulator only.",
  }));
  const saved = await getDoc(doc(db("sup1"), "inbox/fake-orbit"));
  assert.equal(saved.data().imported, true);
  assert.equal(saved.data().importedJobId, "job_fake_1");
  assert.equal(saved.data().builder, "Orbit");
});
