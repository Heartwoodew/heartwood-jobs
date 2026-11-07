// Runs only under `firebase emulators:exec` (Auth, Firestore, Storage).
// Project id is demo-heartwood. This does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
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
