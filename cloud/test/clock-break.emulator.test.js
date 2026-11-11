// CallUp company staff: clock on, break start, break end, clock off (user test 11 Nov 2026 found clock-off denied after a break).
import test from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

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
