// Runs only under `firebase emulators:exec` (Auth, Firestore, Storage).
// Project id is demo-heartwood. This does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, serverTimestamp, Timestamp, where } from "firebase/firestore";
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
  await assertSucceeds(getDocs(query(collection(db(ALEX), "timesheets"), where("weekStart", "==", TS_WEEK))));
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
