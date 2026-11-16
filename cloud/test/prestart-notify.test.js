import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pushTargetFromUrl } from "../../app/features/push-logic.js";
import {
  assignmentWhen, buildPrestartNotices, changedAssetAssignments, changedJobAssignments,
  changedTimesheetAssignments, deliverPrestartNotices, dueAssignments, prestartCovers, prestartEnabled,
  prestartOpenUrl, prestartSentence, resolveMachine,
} from "../functions/prestart-notify.js";

const day = "2026-11-16";
const excavator = { id: "ex1", name: "JCB 3CX", type: "plant", prestartKind: "excavator" };
const skid = { id: "sk1", name: "Bobcat", type: "plant", prestartKind: "skid-steer" };
const otherSkid = { id: "sk2", name: "Second skid", type: "plant", prestartKind: "skid-steer" };

function job(extra = {}) {
  return {
    id: "job1",
    companyId: "bravo",
    client: "Orbit Homes (Qld) Pty Ltd",
    address: "12 Creek Rd, Springfield QLD 4300",
    suburb: "Springfield",
    date: day,
    status: "Scheduled",
    assigned: ["op1"],
    machines: ["excavator"],
    invoiceAmount: 880,
    poAmount: 900,
    ...extra,
  };
}

function person(uid, profile, companyId = "bravo") {
  return {
    uid,
    profile,
    tokens: [{ id: "t-" + uid, token: "fcm-token-value-0123456789-" + uid, companyId, origin: "https://app.callupapp.com.au" }],
  };
}

const operator = person("op1", { role: "operator", name: "Sam", companyId: "bravo", tenantId: "bravo" });
const labourer = person("lab1", { role: "labourer", name: "Lee", companyId: "bravo", tenantId: "bravo" });
const outsider = person("hw1", { role: "operator", name: "Pat", companyId: "heartwood", tenantId: "heartwood" }, "heartwood");

function noticesFor(assignments, extra = {}) {
  return buildPrestartNotices({
    companyId: "bravo",
    assignments,
    assets: [excavator, skid],
    prestarts: [],
    people: [operator, labourer, outsider],
    enabled: true,
    ...extra,
  });
}

test("a new job plant assignment notifies that company's operator once", () => {
  const first = changedJobAssignments(null, job());
  assert.equal(first.length, 1);
  assert.equal(first[0].machineId, "excavator");
  const again = changedJobAssignments(job(), job({ notes: "same crew" }));
  assert.deepEqual(again, []);
  const notes = noticesFor(first);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].uid, "op1");
  assert.equal(notes[0].assetId, "ex1");
  assert.equal(notes[0].body, "Prestart needed: JCB 3CX for Springfield / 16 Nov. Tap to complete.");
  assert.equal(notes[0].messages.length, 1);
  const packed = JSON.stringify(notes[0]);
  assert.equal(packed.includes("880"), false);
  assert.equal(packed.includes("900"), false);
  assert.equal(packed.includes("invoiceAmount"), false);
  assert.equal(packed.includes("$"), false);
  assert.match(notes[0].messages[0].data.url, /prestart=ex1/);
  assert.equal(noticesFor(first, { enabled: false }).length, 0);
  assert.equal(prestartEnabled({ id: "bravo" }), true);
  assert.equal(prestartEnabled(null), true);
  assert.equal(prestartEnabled({ features: { prestart: false } }), false);
  assert.equal(prestartEnabled({ prestart: false }), false);
});

test("another company, a labourer on the job plant, and an existing prestart stay quiet", () => {
  const mixed = job({ assigned: ["op1", "lab1", "hw1"], machines: ["excavator", "skid"] });
  const added = changedJobAssignments(job({ assigned: ["op1"], machines: ["excavator"] }), mixed);
  const notes = noticesFor(added);
  const ids = notes.map(row => row.uid + ":" + row.assetId).sort();
  assert.deepEqual(ids, ["op1:sk1"]);
  assert.equal(notes.some(row => row.uid === "hw1" || row.uid === "lab1"), false);
  const done = noticesFor(changedJobAssignments(null, job()), {
    prestarts: [{ assetId: "ex1", kind: "excavator", day, signerUid: "someone" }],
  });
  assert.deepEqual(done, []);
  assert.equal(prestartCovers([{ assetId: "ex1", jobId: "job9", day: "2026-11-01" }], {
    assetId: "ex1", kind: "excavator", day: "2026-11-02", jobId: "job9", ambiguous: false,
  }), true);
});

test("changing the machine notifies the new one only", () => {
  const before = job({ machines: ["skid"] });
  const after = job({ machines: ["excavator"] });
  const notes = noticesFor(changedJobAssignments(before, after));
  assert.deepEqual(notes.map(row => row.assetId), ["ex1"]);
  assert.match(notes[0].body, /^Prestart needed: JCB 3CX for Springfield \/ 16 Nov\. Tap to complete\.$/);
});

test("an explicit machine-to-staff row names that person, including a labourer", () => {
  const row = job({
    assigned: ["lab1"],
    machines: ["excavator"],
    assignments: [{ uid: "lab1", assetId: "sk1", machineName: "Bobcat" }],
  });
  const notes = noticesFor(changedJobAssignments(null, row));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].uid, "lab1");
  assert.equal(notes[0].assetId, "sk1");
  assert.equal(notes[0].source, "pair");
});

test("a fleet operator change and a timesheet machine are assignments", () => {
  const asset = changedAssetAssignments(
    { id: "ex1", name: "JCB 3CX" },
    { id: "ex1", name: "JCB 3CX", operatorUid: "op1" },
    { assetId: "ex1", companyId: "bravo", day },
  );
  assert.equal(asset.length, 1);
  assert.deepEqual(changedAssetAssignments(asset[0] && { operatorUid: "op1" }, { operatorUid: "op1", name: "JCB 3CX" }, {
    assetId: "ex1", companyId: "bravo", day,
  }), []);
  const notes = noticesFor(asset);
  assert.equal(notes[0].body, "Prestart needed: JCB 3CX for 16 Nov. Tap to complete.");
  const sheet = changedTimesheetAssignments(
    { uid: "op1", companyId: "bravo", entries: {} },
    { uid: "op1", companyId: "bravo", entries: { e1: { id: "e1", machineChoice: "asset", machineId: "sk1", machineName: "Bobcat", date: day, job: "Creek Rd" } } },
    "op1",
  );
  assert.equal(sheet.length, 1);
  assert.deepEqual(changedTimesheetAssignments(
    { uid: "op1", companyId: "bravo", entries: { e1: { id: "e1", machineChoice: "asset", machineId: "sk1", machineName: "Bobcat", date: day, job: "Creek Rd" } } },
    { uid: "op1", companyId: "bravo", entries: { e1: { id: "e1", machineChoice: "asset", machineId: "sk1", machineName: "Bobcat", date: day, job: "Creek Rd", note: "again" } } },
    "op1",
  ), []);
  const heard = noticesFor(sheet);
  assert.equal(heard[0].assetId, "sk1");
  assert.match(heard[0].body, /Bobcat for Creek Rd \/ 16 Nov/);
  const swapped = changedTimesheetAssignments(
    { uid: "op1", companyId: "bravo", entries: { e1: { id: "e1", machineId: "sk1", date: day } } },
    { uid: "op1", companyId: "bravo", entries: { e1: { id: "e1", machineId: "ex1", machineName: "JCB 3CX", date: day } } },
    "op1",
  );
  assert.equal(noticesFor(swapped)[0].assetId, "ex1");
});

test("several machines of one kind collapse, and a kind prestart covers the notice", () => {
  const resolved = resolveMachine("skid", "", [skid, otherSkid]);
  assert.equal(resolved.ambiguous, true);
  assert.equal(resolved.kind, "skid-steer");
  const notes = noticesFor(changedJobAssignments(null, job({ machines: ["skid"] })), { assets: [skid, otherSkid] });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].ambiguous, true);
  assert.equal(noticesFor(changedJobAssignments(null, job({ machines: ["skid"] })), {
    assets: [skid, otherSkid],
    prestarts: [{ assetId: "sk2", kind: "skid-steer", day }],
  }).length, 0);
});

test("the same notice is not pushed twice, and a phone without push still gets the notice", async () => {
  const [notice] = noticesFor(changedJobAssignments(null, job()));
  const quiet = { ...notice, messages: [], targets: [] };
  const claimed = new Set();
  const claim = async row => {
    if (claimed.has(row.id)) return false;
    claimed.add(row.id);
    return true;
  };
  let sends = 0;
  const first = await deliverPrestartNotices({
    notices: [quiet],
    claim,
    sendEach: async () => { sends += 1; return { responses: [] }; },
    deleteToken: async () => {},
  });
  assert.equal(first.noticed, 1);
  assert.equal(first.sent, 0);
  assert.equal(sends, 0);
  const second = await deliverPrestartNotices({
    notices: [notice],
    claim,
    sendEach: async () => { sends += 1; return { responses: [{ success: true }] }; },
    deleteToken: async () => {},
  });
  assert.equal(second.skipped, 1);
  assert.equal(sends, 0);
  claimed.delete(notice.id);
  const pushed = await deliverPrestartNotices({
    notices: [notice],
    claim,
    sendEach: async () => { sends += 1; return { responses: [{ success: true }] }; },
    deleteToken: async () => {},
  });
  assert.equal(pushed.sent, 1);
  assert.equal(sends, 1);
});

test("the link opens the prestart form and Heartwood uses its own site", () => {
  const url = prestartOpenUrl("https://jobs.heartwoodew.com", "heartwood", {
    assetId: "ex1", kind: "excavator", day, jobId: "job1",
  });
  assert.equal(url.startsWith("https://jobs.heartwoodew.com/app/?"), true);
  const target = pushTargetFromUrl(url);
  assert.equal(target.kind, "prestart");
  assert.equal(target.assetId, "ex1");
  assert.equal(target.prestartKind, "excavator");
  assert.equal(target.day, day);
  assert.equal(target.jobId, "job1");
  assert.equal(pushTargetFromUrl("https://app.callupapp.com.au/app/?prestart=../finance"), null);
  const other = prestartOpenUrl("https://evil.example", "bravo", { assetId: "ex1", day });
  assert.match(other, /^https:\/\/app\.callupapp\.com\.au\/app\/\?/);
  assert.equal(prestartSentence("JCB", assignmentWhen({ day, job: job() })), "Prestart needed: JCB for Springfield / 16 Nov. Tap to complete.");
});

test("an assignment dated before today in Brisbane never sends a notice", () => {
  const yesterday = {
    uid: "op1", companyId: "bravo", day: "2026-11-15", machineId: "ex1", machineName: "JCB 3CX",
    jobId: "old", source: "timesheet", job: null, jobLabel: "Creek Rd",
  };
  const todayRow = { ...yesterday, day, jobId: "job1", source: "job", job: job() };
  const kept = dueAssignments([yesterday, todayRow, { ...yesterday, day: "2026-11-17", jobId: "later" }], day);
  assert.deepEqual(kept.map(row => row.day), [day, "2026-11-17"]);
  assert.equal(dueAssignments([yesterday], day).length, 0);
  assert.equal(dueAssignments([todayRow], "").length, 0);
  const notices = buildPrestartNotices({
    companyId: "bravo",
    assignments: dueAssignments([yesterday, todayRow], day),
    assets: [excavator, skid],
    prestarts: [],
    people: [operator],
    enabled: true,
  });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].day, day);
  assert.match(notices[0].body, /16 Nov/);
  const schedule = readFileSync(new URL("../functions/push-schedule.js", import.meta.url), "utf8");
  const guard = schedule.slice(schedule.indexOf("async function runPrestart"), schedule.indexOf("export const prestartJobPush"));
  assert.match(guard, /dueAssignments\(assignments, brisbaneDate\(new Date\(\)\)\)/);
  assert.match(guard, /assignments: due/);
});

test("draft and finished jobs do not assign a prestart, and the function is exported", () => {
  assert.deepEqual(changedJobAssignments(null, job({ quoteStatus: "Draft" })), []);
  assert.deepEqual(changedJobAssignments(null, job({ status: "Done" })), []);
  assert.deepEqual(changedJobAssignments(null, job({ date: "" })), []);
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.match(index, /prestartJobPush/);
  assert.match(index, /prestartAssetPush/);
  assert.match(index, /prestartTimesheetPush/);
  const rules = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /prestartNotices/);
  assert.match(emu, /prestartNotices/);
  assert.match(rules, /allow create, update, delete: if false/);
});
