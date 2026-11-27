// CallUp company staff: clock on, break start, break end, clock off (user test 11 Nov 2026 found clock-off denied after a break).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp } from "firebase/firestore";

let env;
test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-clockbreak",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, "companies/bravo"), { name: "bravo", isTest: true, status: "archived", plan: "trial", ownerUid: "bravoAdm" });
    await setDoc(doc(d, "users/bravoOp"), { role: "operator", name: "Bravo Op", email: "op@example.com", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/hwOp"), { role: "operator", name: "HW Op", companyId: "heartwood" });
    await setDoc(doc(d, "users/bravoBusy"), { role: "operator", name: "Bravo Busy", email: "busy@example.com", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/hwBusy"), { role: "operator", name: "HW Busy", companyId: "heartwood" });
  });
});
test.after(async () => { if (env) await env.cleanup(); });

const gps = () => ({ at: serverTimestamp(), fix: "gps", lat: -27.4698, lng: 153.0251, accuracy: 20 });
// A finished shift already on the sheet: clock, break and machine stamps (the heaviest real shape).
const done = (id, uid, date) => ({ id, source: "clock", status: "closed", date, start: "06:00", finish: "15:00", breakStart: "12:00", breakEnd: "12:30", note: "", job: "",
  clockOn: { at: new Date(date + "T06:00:00+10:00"), fix: "gps", lat: -27.4, lng: 153.0, accuracy: 12 },
  breakOn: { at: new Date(date + "T12:00:00+10:00"), fix: "gps", lat: -27.4, lng: 153.0, accuracy: 12 },
  breakOff: { at: new Date(date + "T12:30:00+10:00"), fix: "gps", lat: -27.4, lng: 153.0, accuracy: 12 },
  clockOff: { at: new Date(date + "T15:00:00+10:00"), fix: "gps", lat: -27.4, lng: 153.0, accuracy: 12 },
  machineChoice: "asset", machineId: "skid1", machineName: "Skid steer", enteredBy: uid, enteredByName: uid, enteredAt: new Date(date + "T06:00:00+10:00"), edits: {}, lastEditId: "" });
async function shift(uid, companyId, prior = 0) {
  const db = env.authenticatedContext(uid).firestore();
  const ref = doc(db, `timesheets/${uid}_2026-11-09`);
  const id = "ent" + uid.toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(9, "0");
  if (prior) await env.withSecurityRulesDisabled(async ctx => {
    const entries = {};
    for (let i = 0; i < prior; i++) entries["old" + i + "aaaaaa"] = done("old" + i + "aaaaaa", uid, "2026-11-" + String(9 + (i % 3)).padStart(2, "0"));
    await setDoc(doc(ctx.firestore(), `timesheets/${uid}_2026-11-09`), { uid, name: uid, weekStart: "2026-11-09", weekEnd: "2026-11-15", days: {}, totalHrs: 0,
      updatedAt: new Date(), updatedAtIso: "x", lastEntryId: "old0aaaaaa", locationConsentAt: new Date(), entries, ...(companyId ? { companyId } : {}) });
  });
  const base = { uid, name: uid, weekStart: "2026-11-09", weekEnd: "2026-11-15", updatedAtIso: new Date().toISOString(), lastEntryId: id, ...(companyId ? { companyId } : {}) };
  const on = { id, source: "clock", status: "open", date: "2026-11-11", start: "17:58", finish: "", breakStart: "", breakEnd: "", note: "", job: "",
    clockOn: gps(), enteredBy: uid, enteredByName: uid, enteredAt: serverTimestamp(), edits: {}, lastEditId: "" };
  if (prior) await assertSucceeds(updateDoc(ref, { ...base, days: { "2026-11-11": { start: "17:58", finish: "", note: "" } }, totalHrs: 0, updatedAt: serverTimestamp(), [`entries.${id}`]: on }));
  else await assertSucceeds(setDoc(ref, { ...base, days: { "2026-11-11": { start: "17:58", finish: "", note: "" } }, totalHrs: 0, updatedAt: serverTimestamp(), locationConsentAt: serverTimestamp(), entries: { [id]: on } }));
  const read = async () => (await getDoc(ref)).data().entries[id];
  const write = async (e, day, step) => assertSucceeds(updateDoc(ref, { ...base, days: { "2026-11-11": day }, totalHrs: 0, updatedAt: serverTimestamp(), [`entries.${id}`]: e })).catch(err => { throw new Error(step + ": " + String(err.message).slice(0, 160)); });
  let e = await read();
  await write({ ...e, status: "break", breakStart: "18:00", breakOn: gps() }, { start: "17:58", finish: "", note: "" }, "break start");
  e = await read();
  await write({ ...e, status: "open", breakEnd: "18:00", breakOff: gps() }, { start: "17:58", finish: "", note: "", breakStart: "18:00", breakEnd: "18:00" }, "break end");
  e = await read();
  await write({ ...e, machineChoice: "asset", machineId: "skid1", machineName: "Skid steer" }, { start: "17:58", finish: "", note: "", breakStart: "18:00", breakEnd: "18:00" }, "machine");
  e = await read();
  await write({ ...e, status: "closed", finish: "18:02", clockOff: gps() }, { start: "17:58", finish: "18:02", note: "", breakStart: "18:00", breakEnd: "18:00" }, "clock off");
}
test("CallUp company staff clock off after a break", async () => { await shift("bravoOp", "bravo"); });
test("Heartwood staff clock off after a break", async () => { await shift("hwOp", null); });
test("CallUp company staff, busy week (12 finished shifts), clock off after a break", async () => { await shift("bravoBusy", "bravo", 12); });
test("Heartwood staff, busy week (12 finished shifts), clock off after a break", async () => { await shift("hwBusy", null, 12); });
test("CallUp company staff clock off while still on break (two new stamps), full week of 39 shifts", async () => {
  await env.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), "users/bravoFull"), { role: "operator", name: "Bravo Full", email: "full@example.com", companyId: "bravo", tenantId: "bravo" }));
  const uid = "bravoFull", db = env.authenticatedContext(uid).firestore(), ref = doc(db, `timesheets/${uid}_2026-11-09`), id = "entfull00001";
  await env.withSecurityRulesDisabled(async ctx => {
    const entries = {};
    for (let i = 0; i < 39; i++) entries["old" + i + "bbbbbb"] = done("old" + i + "bbbbbb", uid, "2026-11-" + String(9 + (i % 3)).padStart(2, "0"));
    entries[id] = { ...done(id, uid, "2026-11-11"), status: "break", finish: "", breakEnd: "", clockOff: undefined, breakOff: undefined };
    delete entries[id].clockOff; delete entries[id].breakOff;
    await setDoc(doc(ctx.firestore(), `timesheets/${uid}_2026-11-09`), { uid, name: uid, weekStart: "2026-11-09", weekEnd: "2026-11-15", days: {}, totalHrs: 0,
      updatedAt: new Date(), updatedAtIso: "x", lastEntryId: id, locationConsentAt: new Date(), entries, companyId: "bravo" });
  });
  const e = (await getDoc(ref)).data().entries[id];
  await assertSucceeds(updateDoc(ref, { uid, name: uid, weekStart: "2026-11-09", weekEnd: "2026-11-15", updatedAtIso: new Date().toISOString(), lastEntryId: id, companyId: "bravo",
    days: { "2026-11-11": { start: "06:00", finish: "15:00", note: "", breakStart: "12:00", breakEnd: "15:00" } }, totalHrs: 1, updatedAt: serverTimestamp(),
    [`entries.${id}`]: { ...e, status: "closed", finish: "15:00", breakEnd: "15:00", breakOff: gps(), clockOff: gps() } }));
});
test("CallUp company staff: machine pick then clock off, no break (live user test 11 Nov failed this)", async () => {
  await env.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), "users/bravoMach"), { role: "operator", name: "Bravo Mach", email: "m@example.com", companyId: "bravo", tenantId: "bravo" }));
  const uid = "bravoMach", db = env.authenticatedContext(uid).firestore(), ref = doc(db, `timesheets/${uid}_2026-11-09`), id = "entmach00001";
  const base = { uid, name: uid, weekStart: "2026-11-09", weekEnd: "2026-11-15", updatedAtIso: "x", lastEntryId: id, companyId: "bravo" };
  await assertSucceeds(setDoc(ref, { ...base, days: {}, totalHrs: 0, updatedAt: serverTimestamp(), locationConsentAt: serverTimestamp(), entries: { [id]: {
    id, source: "clock", status: "open", date: "2026-11-11", start: "18:24", finish: "", breakStart: "", breakEnd: "", note: "", job: "",
    clockOn: gps(), enteredBy: uid, enteredByName: uid, enteredAt: serverTimestamp(), edits: {}, lastEditId: "" } } }));
  await assertSucceeds(updateDoc(ref, { [`entries.${id}.machineChoice`]: "asset", [`entries.${id}.machineId`]: "a40affcd", [`entries.${id}.machineName`]: "UT Skid Steer (TEST)", lastEntryId: id, updatedAt: serverTimestamp(), updatedAtIso: "y" }));
  const e = (await getDoc(ref)).data().entries[id];
  await assertSucceeds(updateDoc(ref, { ...base, days: { "2026-11-11": { start: "18:24", finish: "18:40", note: "" } }, totalHrs: 0, updatedAt: serverTimestamp(), [`entries.${id}`]: { ...e, status: "closed", finish: "18:40", clockOff: gps() } }));
});
test("a worker still cannot rewrite a recorded stamp, remove one, change author or re-pick a machine", async () => {
  await env.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), "users/bravoBad"), { role: "operator", name: "Bravo Bad", email: "b@example.com", companyId: "bravo", tenantId: "bravo" }));
  const uid = "bravoBad", db = env.authenticatedContext(uid).firestore(), ref = doc(db, `timesheets/${uid}_2026-11-09`), id = "entbad000001";
  const base = { uid, name: uid, weekStart: "2026-11-09", weekEnd: "2026-11-15", updatedAtIso: "x", lastEntryId: id, companyId: "bravo", days: {}, totalHrs: 0 };
  await assertSucceeds(setDoc(ref, { ...base, updatedAt: serverTimestamp(), locationConsentAt: serverTimestamp(), entries: { [id]: {
    id, source: "clock", status: "open", date: "2026-11-11", start: "06:00", finish: "", breakStart: "", breakEnd: "", note: "", job: "",
    clockOn: gps(), enteredBy: uid, enteredByName: uid, enteredAt: serverTimestamp(), edits: {}, lastEditId: "" } } }));
  await assertSucceeds(updateDoc(ref, { ...base, updatedAt: serverTimestamp(), [`entries.${id}`]: { ...(await getDoc(ref)).data().entries[id], machineChoice: "none", machineId: "", machineName: "" } }));
  const e = (await getDoc(ref)).data().entries[id];
  const { assertFails } = await import("@firebase/rules-unit-testing");
  const { Timestamp } = await import("firebase/firestore");
  const old = Timestamp.fromDate(new Date("2026-11-11T04:00:00+10:00"));
  const put = entry => updateDoc(ref, { ...base, updatedAt: serverTimestamp(), [`entries.${id}`]: entry });
  await assertFails(put({ ...e, clockOn: { at: old, fix: "no location" } }));
  await assertFails(put({ ...e, clockOff: { at: old, fix: "no location" }, status: "closed", finish: "14:00" }));
  const { clockOn, ...noClockOn } = e; await assertFails(put(noClockOn));
  await assertFails(put({ ...e, enteredBy: "someoneElse" }));
  await assertFails(put({ ...e, source: "manual" }));
  await assertFails(put({ ...e, machineChoice: "asset", machineId: "x1", machineName: "Other" }));
  await assertFails(put({ ...e, note: "x".repeat(201) }));
  await assertFails(put({ ...e, sneaky: true }));
  await assertFails(put({ ...e, edits: { ed1: { at: serverTimestamp(), by: "someoneElse", byName: "x", summary: "y" } }, lastEditId: "ed1" }));
});

test("Heartwood staff can correct their own clock times and cannot change anything else", async () => {
  const uid = "hwOp";
  const db = env.authenticatedContext(uid).firestore();
  const week = "2026-10-05";
  const id = "entryadj00001";
  const ref = doc(db, `timesheets/${uid}_${week}`);
  const entry = {
    id, source: "clock", status: "closed", date: "2026-10-06", start: "07:00", finish: "15:00",
    breakStart: "", breakEnd: "", note: "", job: "Lot 12",
    clockOn: { at: Timestamp.fromDate(new Date("2026-10-06T07:00:00+10:00")), fix: "gps", lat: -27.47, lng: 153.025, accuracy: 12 },
    clockOff: { at: Timestamp.fromDate(new Date("2026-10-06T15:00:00+10:00")), fix: "no location" },
    enteredBy: uid, enteredByName: uid, enteredAt: Timestamp.fromDate(new Date("2026-10-06T07:00:00+10:00")),
    edits: {}, lastEditId: "",
  };
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), `timesheets/${uid}_${week}`), {
      uid, name: uid, weekStart: week, weekEnd: "2026-10-11", days: {}, totalHrs: 8, companyId: "heartwood",
      updatedAt: new Date(), updatedAtIso: "2026-10-06T01:00:00.000Z", lastEntryId: id, entries: { [id]: entry },
    });
  });
  const edit = (row, patch, editId) => ({
    ...row, ...patch, lastEditId: editId,
    edits: { ...(row.edits || {}), [editId]: { at: serverTimestamp(), by: uid, byName: uid, summary: "Clock on 07:00 → 07:30" } },
  });
  const base = { uid, name: uid, weekStart: week, weekEnd: "2026-10-11", companyId: "heartwood", totalHrs: 8, updatedAtIso: new Date().toISOString(), lastEntryId: id };
  await assertSucceeds(updateDoc(ref, { ...base, updatedAt: serverTimestamp(), [`entries.${id}`]: edit(entry, { start: "07:30", originalClockOn: "07:00", originalClockOff: "15:00" }, "editadj000001") }));
  const saved = (await getDoc(ref)).data().entries[id];
  assert.equal(saved.originalClockOn, "07:00");
  assert.equal(saved.clockOn.lat, -27.47);
  await assertSucceeds(updateDoc(ref, { ...base, updatedAt: serverTimestamp(), [`entries.${id}`]: edit(saved, { start: "08:00" }, "editadj000002") }));
  const kept = (await getDoc(ref)).data().entries[id];
  assert.equal(kept.originalClockOn, "07:00");
  await assertFails(updateDoc(ref, { ...base, updatedAt: serverTimestamp(), [`entries.${id}`]: edit(kept, { start: "08:10", originalClockOn: "08:00" }, "editadj000003") }));
  await assertFails(updateDoc(ref, { ...base, updatedAt: serverTimestamp(), [`entries.${id}`]: edit(kept, { finish: "08:00" }, "editadj000004") }));
  await assertFails(updateDoc(ref, { ...base, updatedAt: serverTimestamp(), [`entries.${id}`]: edit(kept, { job: "Elsewhere" }, "editadj000005") }));
  await assertFails(updateDoc(ref, { ...base, updatedAt: serverTimestamp(), [`entries.${id}`]: edit(kept, { note: "nope" }, "editadj000006") }));
  await assertFails(updateDoc(doc(env.authenticatedContext("bravoOp").firestore(), `timesheets/${uid}_${week}`), { ...base, updatedAt: serverTimestamp(), [`entries.${id}`]: edit(kept, { start: "09:00" }, "editadj000007") }));
  const alex = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
  await assertSucceeds(updateDoc(doc(env.authenticatedContext(alex).firestore(), `timesheets/${uid}_${week}`), { name: "Sam from the office" }));
});

test("a real CallUp company can clock a second and third shift, then a later day, and cannot take another sheet", async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, "companies/callupco"), {
      name: "Callup Co", legalName: "Callup Co", abn: "51 824 753 556", isTest: false, status: "active", plan: "trial",
      ownerUid: "cuOwn", origin: "signup",
      trialEndsAt: Timestamp.fromMillis(Date.now() + 10 * 86400000),
      billing: { provider: null, status: "not-configured", stripeCustomerId: null, stripeSubscriptionId: null },
    });
    await setDoc(doc(d, "users/cuOp"), { role: "operator", name: "Cue", email: "cue@example.com", companyId: "callupco", tenantId: "callupco" });
    await setDoc(doc(d, "users/cuOther"), { role: "operator", name: "Other", email: "other@example.com", companyId: "callupco", tenantId: "callupco" });
  });
  const uid = "cuOp";
  const db = env.authenticatedContext(uid).firestore();
  const ref = doc(db, `timesheets/${uid}_2026-11-09`);
  const companyId = "callupco";
  const on = (id, date, start) => ({
    id, source: "clock", status: "open", date, start, finish: "", breakStart: "", breakEnd: "", note: "", job: "",
    clockOn: gps(), enteredBy: uid, enteredByName: uid, enteredAt: serverTimestamp(), edits: {}, lastEditId: "",
  });
  const base = (id) => ({ uid, name: uid, weekStart: "2026-11-09", weekEnd: "2026-11-15", updatedAtIso: new Date().toISOString(), lastEntryId: id, companyId });
  await assertSucceeds(setDoc(ref, { ...base("entcuop00001"), days: { "2026-11-09": { start: "07:00", finish: "", note: "" } }, totalHrs: 0, updatedAt: serverTimestamp(), locationConsentAt: serverTimestamp(), entries: { entcuop00001: on("entcuop00001", "2026-11-09", "07:00") } }));
  await assertSucceeds(updateDoc(ref, { ...base("entcuop00002"), days: { "2026-11-09": { start: "07:00", finish: "", note: "" }, "2026-11-10": { start: "08:00", finish: "", note: "" } }, totalHrs: 0, updatedAt: serverTimestamp(), ["entries.entcuop00002"]: on("entcuop00002", "2026-11-10", "08:00") }));
  await assertSucceeds(updateDoc(ref, { ...base("entcuop00003"), days: { "2026-11-11": { start: "09:00", finish: "", note: "" } }, totalHrs: 0, updatedAt: serverTimestamp(), ["entries.entcuop00003"]: on("entcuop00003", "2026-11-11", "09:00") }));
  const third = (await getDoc(ref)).data().entries.entcuop00003;
  await assertSucceeds(updateDoc(ref, { ...base("entcuop00003"), days: { "2026-11-11": { start: "09:00", finish: "15:00", note: "" } }, totalHrs: 6, updatedAt: serverTimestamp(), ["entries.entcuop00003"]: { ...third, status: "closed", finish: "15:00", clockOff: gps() } }));
  await assertSucceeds(updateDoc(ref, { ...base("entcuop00004"), days: { "2026-11-13": { start: "07:30", finish: "", note: "" } }, totalHrs: 6, updatedAt: serverTimestamp(), ["entries.entcuop00004"]: on("entcuop00004", "2026-11-13", "07:30") }));
  const saved = await getDoc(ref);
  assert.equal(Object.keys(saved.data().entries).length, 4);
  const other = env.authenticatedContext("cuOther").firestore();
  await assertFails(updateDoc(doc(other, ref.path), { ...base("entcuop00004"), name: "Stolen", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { ...base("entcuop00004"), companyId: "heartwood", updatedAt: serverTimestamp() }));
});
