// Live crew location. Loads cloud/firestore.production.rules. Fake data only. Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, serverTimestamp } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-live-location",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    const people = [
      ["op1", "operator", "Sam", "heartwood"],
      ["lab1", "labourer", "Lee", "heartwood"],
      ["sup1", "supervisor", "Sue", "heartwood"],
      ["idle1", "operator", "Idle", "heartwood"],
      ["hwMgr", "manager", "Hana", "heartwood"],
      ["hwAdm", "admin", "Ada", "heartwood"],
      ["bOp", "operator", "Bo", "bravo"],
      ["bLab", "labourer", "Bix", "bravo"],
      ["bSup", "supervisor", "Sid", "bravo"],
      ["bMgr", "manager", "Mo", "bravo"],
      ["bAdm", "admin", "Bea", "bravo"],
      ["cAdm", "admin", "Cy", "charlie"],
    ];
    for (const [uid, role, name, companyId] of people) {
      await setDoc(doc(d, "users/" + uid), { role, name, companyId, tenantId: companyId });
    }
    const open = (uid, name, companyId, status = "open") => setDoc(doc(d, `timesheets/${uid}_2026-11-09`), {
      uid, name, companyId, weekStart: "2026-11-09",
      entries: { entry0001abcd: { source: "clock", status } },
    });
    await open("op1", "Sam", "heartwood");
    await open("lab1", "Lee", "heartwood");
    await open("sup1", "Sue", "heartwood", "break");
    await open("idle1", "Idle", "heartwood", "closed");
    await open("bOp", "Bo", "bravo");
    await setDoc(doc(d, "jobs/hw1"), { companyId: "heartwood", client: "Orbit", address: "10 Creek Rd", date: "2026-11-15", assigned: ["op1"], status: "Scheduled" });
    await setDoc(doc(d, "jobs/b1"), { companyId: "bravo", client: "Bravo", date: "2026-11-15", assigned: ["bOp"], status: "Scheduled" });
  });
});
test.after(async () => { if (env) await env.cleanup(); });

const db = uid => env.authenticatedContext(uid).firestore();
const gps = (uid, name, companyId) => ({
  uid, name, companyId, clockedOn: true, sharing: "gps",
  lat: -27.47, lng: 153.025, accuracy: 12,
  updatedAt: serverTimestamp(), weekStart: "2026-11-09", entryId: "entry0001abcd",
});
const off = (uid, name, companyId) => ({
  uid, name, companyId, clockedOn: true, sharing: "off",
  updatedAt: serverTimestamp(), weekStart: "2026-11-09", entryId: "entry0001abcd",
});

test("own live location write is allowed only while clocked on, and only on that person's doc", async () => {
  await assertSucceeds(setDoc(doc(db("op1"), "liveLocations/op1"), gps("op1", "Sam", "heartwood")));
  await assertSucceeds(setDoc(doc(db("lab1"), "liveLocations/lab1"), off("lab1", "Lee", "heartwood")));
  await assertSucceeds(setDoc(doc(db("sup1"), "liveLocations/sup1"), gps("sup1", "Sue", "heartwood")));
  await assertFails(setDoc(doc(db("op1"), "liveLocations/lab1"), gps("op1", "Sam", "heartwood")));
  await assertFails(setDoc(doc(db("op1"), "liveLocations/lab1"), { ...gps("lab1", "Lee", "heartwood"), uid: "lab1" }));
  await assertFails(setDoc(doc(db("idle1"), "liveLocations/idle1"), gps("idle1", "Idle", "heartwood")));
  await assertFails(setDoc(doc(db("op1"), "liveLocations/op1"), { ...gps("op1", "Sam", "heartwood"), trail: [1] }));
  await assertFails(setDoc(doc(db("op1"), "liveLocations/op1"), { ...gps("op1", "Sam", "heartwood"), accuracy: 100001 }));
  await assertFails(setDoc(doc(db("op1"), "liveLocations/op1"), { ...gps("op1", "Sam", "heartwood"), clockedOn: false }));
  await assertFails(setDoc(doc(db("hwMgr"), "liveLocations/op1"), gps("hwMgr", "Hana", "heartwood")));
  await assertSucceeds(setDoc(doc(db("bOp"), "companies/bravo/liveLocations/bOp"), gps("bOp", "Bo", "bravo")));
  await assertFails(setDoc(doc(db("bOp"), "liveLocations/bOp"), gps("bOp", "Bo", "heartwood")));
  await assertFails(setDoc(doc(db("op1"), "companies/bravo/liveLocations/op1"), gps("op1", "Sam", "bravo")));
  await assertFails(setDoc(doc(db("bOp"), "companies/charlie/liveLocations/bOp"), gps("bOp", "Bo", "charlie")));
});

test("manager and admin can read their own company's live crew; supervisor, operator and labourer cannot", async () => {
  for (const uid of ["hwMgr", "hwAdm", ALEX]) {
    await assertSucceeds(getDoc(doc(db(uid), "liveLocations/op1")), uid);
    await assertSucceeds(getDocs(query(collection(db(uid), "liveLocations"), where("companyId", "==", "heartwood"))), uid);
  }
  for (const uid of ["sup1", "op1", "lab1"]) {
    await assertFails(getDoc(doc(db(uid), "liveLocations/op1")), uid);
    await assertFails(getDoc(doc(db(uid), "liveLocations/" + uid)), uid + " own");
    await assertFails(getDocs(query(collection(db(uid), "liveLocations"), where("companyId", "==", "heartwood"))), uid);
  }
  for (const uid of ["bMgr", "bAdm"]) {
    await assertSucceeds(getDoc(doc(db(uid), "companies/bravo/liveLocations/bOp")), uid);
    await assertSucceeds(getDocs(query(collection(db(uid), "companies/bravo/liveLocations"), where("companyId", "==", "bravo"))), uid);
  }
  for (const uid of ["bSup", "bOp", "bLab"]) {
    await assertFails(getDoc(doc(db(uid), "companies/bravo/liveLocations/bOp")), uid);
    await assertFails(getDocs(query(collection(db(uid), "companies/bravo/liveLocations"), where("companyId", "==", "bravo"))), uid);
  }
});

test("a company cannot read or write another company's live crew", async () => {
  await assertFails(getDoc(doc(db("bAdm"), "liveLocations/op1")));
  await assertFails(getDocs(query(collection(db("bAdm"), "liveLocations"), where("companyId", "==", "heartwood"))));
  await assertFails(getDoc(doc(db(ALEX), "companies/bravo/liveLocations/bOp")));
  await assertFails(getDoc(doc(db("hwMgr"), "companies/bravo/liveLocations/bOp")));
  await assertFails(getDocs(query(collection(db("hwMgr"), "companies/bravo/liveLocations"), where("companyId", "==", "bravo"))));
  await assertFails(getDoc(doc(db("cAdm"), "companies/bravo/liveLocations/bOp")));
  await assertFails(deleteDoc(doc(db("bAdm"), "liveLocations/op1")));
  await assertFails(deleteDoc(doc(db("hwMgr"), "companies/bravo/liveLocations/bOp")));
});

test("clock off clears only that person's live doc", async () => {
  await assertSucceeds(deleteDoc(doc(db("op1"), "liveLocations/op1")));
  await assertFails(deleteDoc(doc(db("hwMgr"), "liveLocations/lab1")));
  await assertFails(deleteDoc(doc(db("sup1"), "liveLocations/lab1")));
  const left = await getDocs(query(collection(db("hwMgr"), "liveLocations"), where("companyId", "==", "heartwood")));
  assert.equal(left.docs.some(d => d.id === "op1"), false);
  assert.equal(left.docs.some(d => d.id === "lab1"), true);
});

test("a Heartwood manager can read Heartwood jobs for the map and cannot change them or open another company", async () => {
  await assertSucceeds(getDoc(doc(db("hwMgr"), "jobs/hw1")));
  await assertSucceeds(getDocs(query(collection(db("hwMgr"), "jobs"), where("companyId", "==", "heartwood"))));
  await assertFails(getDoc(doc(db("hwMgr"), "jobs/b1")));
  await assertFails(updateDoc(doc(db("hwMgr"), "jobs/hw1"), { client: "Changed" }));
});
