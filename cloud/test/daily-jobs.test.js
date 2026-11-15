import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  affectedUids, brisbaneDate, companiesToScan, companySkipped, dailyOpenUrl, dayFingerprint,
  digestDocId, dispatchDailyChange, dispatchDailyJobs, jobOpenToday, jobPlace, jobsDayBody, jobsDayTitle,
  jobsForPerson, orderNoticeJobs, scheduleFieldsChanged, selectDailyDigests, updateDecision,
} from "../functions/daily-jobs.js";

const day = "2026-11-11";
const heartwood = { id: "heartwood", name: "Heartwood" };

function person(uid, extra = {}) {
  return {
    uid,
    profile: extra.profile || { role: "operator", name: uid },
    muteDaily: extra.muteDaily === true,
    tokens: extra.tokens === undefined ? [{
      id: "t-" + uid,
      token: "fcm-token-value-0123456789-" + uid,
      companyId: extra.companyId || "heartwood",
      origin: extra.origin || "https://jobs.heartwoodew.com",
    }] : extra.tokens,
    sheet: extra.sheet || null,
  };
}

const todayJobs = [
  { id: "job1", companyId: "heartwood", date: day, status: "Scheduled", time: "07:00", assigned: ["op1", "op2"], address: "12 Creek Rd, Springfield QLD 4300", invoiceAmount: 880, poAmount: 900 },
  { id: "jobDone", companyId: "heartwood", date: day, status: "Done", assigned: ["op1"], address: "1 Done St" },
  { id: "jobCancel", companyId: "heartwood", date: day, status: "Cancelled", assigned: ["op1"], address: "2 Cancel St" },
  { id: "jobOld", companyId: "heartwood", date: day, status: "Scheduled", sm8Status: "Completed", assigned: ["op1"], address: "3 Old St" },
  { id: "jobFail", companyId: "heartwood", date: day, status: "Scheduled", sm8Status: "Unsuccessful", assigned: ["op1"], address: "4 Fail St" },
  { id: "jobTomorrow", companyId: "heartwood", date: "2026-11-12", status: "Scheduled", assigned: ["op1"], address: "Tomorrow" },
  { id: "jobOther", companyId: "otherco", date: day, status: "Scheduled", assigned: ["op1"], address: "Other yard" },
  { id: "silk", companyId: "heartwood", date: day, status: "In progress", time: "09:00", assigned: ["scoped"], client: "Silkwood Homes", address: "9 Silk St, Goodna" },
  { id: "orbit", companyId: "heartwood", date: day, status: "Scheduled", time: "06:30", assigned: ["scoped", "ada"], client: "Orbit Homes (Qld) Pty Ltd", suburb: "Redbank Plains", quoteAmount: 1200 },
  { id: "later", companyId: "heartwood", date: day, status: "Scheduled", time: "15:00", assigned: ["op1"], address: "4 Hill Rd, Camira QLD 4300" },
];

test("Brisbane date and company filter", () => {
  assert.equal(brisbaneDate(new Date("2026-11-10T20:00:00Z")), "2026-11-11");
  assert.equal(brisbaneDate(new Date("2026-11-10T13:30:00Z")), "2026-11-10");
  assert.equal(companySkipped({ isTest: true, status: "active" }), true);
  assert.equal(companySkipped({ isTest: false, status: "archived" }), true);
  assert.equal(companySkipped({ id: "heartwood", status: "active" }), false);
  const scan = companiesToScan([
    { id: "acme", isTest: true, status: "active" },
    { id: "oldco", status: "archived" },
    { id: "bravo", status: "active", name: "Bravo" },
  ]);
  assert.deepEqual(scan.map(c => c.id), ["heartwood", "bravo"]);
});

test("today's list is assigned people only, with no prices in the text", () => {
  assert.equal(jobOpenToday(todayJobs[0], day), true);
  assert.equal(jobOpenToday(todayJobs[1], day), false);
  assert.equal(jobPlace(todayJobs[0]), "Springfield");
  assert.equal(jobPlace(todayJobs[8]), "Redbank Plains");
  assert.equal(jobsDayTitle(day), "Your jobs for Wed 11 Nov");
  const people = [
    person("op1"),
    person("op2"),
    person("idle"),
    person("muted", { muteDaily: true }),
    person("scoped", { profile: { role: "operator", customerIds: ["Orbit Homes (Qld) Pty Ltd"] } }),
    person("ada", { profile: { role: "admin", name: "Ada" } }),
    person("boss", { profile: { role: "admin", name: "Boss" } }),
    person("outsider", { profile: { role: "operator", companyId: "otherco" }, companyId: "heartwood" }),
    person("notoken", { tokens: [] }),
  ];
  const digests = selectDailyDigests({ companyId: "heartwood", date: day, jobs: todayJobs, people });
  const byUid = Object.fromEntries(digests.map(d => [d.uid, d]));
  assert.deepEqual(Object.keys(byUid).sort(), ["ada", "op1", "op2", "scoped"]);
  assert.deepEqual(byUid.op1.jobIds, ["job1", "later"]);
  assert.deepEqual(byUid.scoped.jobIds, ["orbit"]);
  assert.equal(byUid.ada.jobIds.includes("job1"), false);
  const body = byUid.op1.messages[0].data.body;
  assert.equal(body, "2 jobs · Springfield");
  assert.equal(body.includes("880"), false);
  assert.equal(body.includes("$"), false);
  assert.equal(byUid.op1.messages[0].data.title, "Your jobs for Wed 11 Nov");
  assert.equal(byUid.op1.messages[0].data.view, "today");
  assert.equal(byUid.op1.messages[0].data.invoiceAmount, undefined);
  assert.equal(byUid.scoped.messages[0].data.body, "1 job · Redbank Plains");
  assert.equal(byUid.op1.messages[0].webpush.fcmOptions.link, "https://jobs.heartwoodew.com/app/?jobs=today");
  assert.equal(dailyOpenUrl("https://evil.example", "bravo"), "https://app.callupapp.com.au/app/?jobs=today");
  assert.equal(digestDocId("heartwood", day, "op1"), "heartwood_2026-11-11_op1");
  const ordered = orderNoticeJobs(
    jobsForPerson(todayJobs, "op1", { role: "operator" }, "heartwood", day, { status: "approved", companyId: "heartwood", jobIds: ["later", "job1"] }),
    { status: "approved", jobIds: ["later", "job1"] },
  );
  assert.equal(jobsDayBody(ordered), "2 jobs · Camira");
});

test("the morning send is once per person and skips test companies", async () => {
  const claimed = new Set();
  const sent = [];
  const loaded = [];
  const dropped = [];
  const run = () => dispatchDailyJobs({
    date: day,
    loadCompanies: async () => [
      { id: "heartwood", status: "active" },
      { id: "acme", isTest: true, status: "active" },
      { id: "bravo", status: "active", name: "Bravo" },
    ],
    loadJobs: async (companyId) => {
      loaded.push(companyId);
      if (companyId === "heartwood") return todayJobs;
      if (companyId === "bravo") return [{ id: "b1", companyId: "bravo", date: day, status: "Scheduled", time: "08:00", assigned: ["bop"], address: "4 Yard Rd, Ipswich QLD 4305" }];
      return [{ id: "secret", companyId: "acme", date: day, status: "Scheduled", assigned: ["tester"], address: "Secret" }];
    },
    loadPeople: async (companyId) => {
      if (companyId === "heartwood") return [person("op1", { tokens: [
        { id: "phone", token: "fcm-token-value-0123456789-phone", companyId: "heartwood", origin: "https://jobs.heartwoodew.com" },
        { id: "tablet", token: "fcm-token-value-0123456789-tablet", companyId: "heartwood", origin: "https://jobs.heartwoodew.com" },
      ] })];
      if (companyId === "bravo") return [person("bop", { companyId: "bravo", origin: "https://app.callupapp.com.au", profile: { role: "operator", companyId: "bravo", name: "Bo" } })];
      return [person("tester", { companyId: "acme", origin: "https://app.callupapp.com.au" })];
    },
    claim: async (digest) => {
      if (claimed.has(digest.id)) return false;
      claimed.add(digest.id);
      return true;
    },
    sendEach: async (messages) => {
      sent.push(...messages.map(message => message.token));
      return { responses: messages.map((message, index) => index === 1 ? { success: false, error: { code: "messaging/registration-token-not-registered" } } : { success: true }) };
    },
    deleteToken: async (target) => { dropped.push(target.tokenId); },
  });
  const first = await run();
  assert.equal(loaded.includes("acme"), false);
  assert.equal(first.sent, 2);
  assert.equal(sent.length, 3);
  assert.deepEqual(dropped, ["tablet"]);
  const before = sent.length;
  const second = await run();
  assert.equal(second.sent, 0);
  assert.equal(second.skipped, 2);
  assert.equal(sent.length, before);
});

test("a price edit does not count, and today's list changes at most once", async () => {
  const before = { id: "job1", companyId: "heartwood", date: day, status: "Scheduled", time: "07:00", assigned: ["op1"], address: "12 Creek Rd, Springfield", invoiceAmount: 10 };
  const priced = { ...before, invoiceAmount: 880 };
  assert.equal(scheduleFieldsChanged(before, priced), false);
  const moved = { ...before, time: "09:30" };
  assert.equal(scheduleFieldsChanged(before, moved), true);
  assert.deepEqual(affectedUids(before, moved, day, "heartwood"), ["op1"]);
  assert.deepEqual(affectedUids(before, { ...moved, companyId: "bravo" }, day, "bravo"), ["op1"]);
  assert.deepEqual(affectedUids(before, moved, day, "otherco"), []);
  const jobs = [before, todayJobs[9]];
  const fingerprint = dayFingerprint(jobsForPerson(jobs, "op1", { role: "operator" }, "heartwood", day, null));
  assert.equal(updateDecision({ existing: null, fingerprint, muteDaily: false }), "before-morning");
  assert.equal(updateDecision({ existing: { fingerprint, updateSent: false }, fingerprint, muteDaily: false }), "same");
  assert.equal(updateDecision({ existing: { fingerprint: "old", updateSent: true }, fingerprint: "new", muteDaily: false }), "already");
  assert.equal(updateDecision({ existing: { fingerprint: "old", updateSent: false }, fingerprint, muteDaily: true }), "muted");
  const sent = [];
  let claimed = false;
  const personRow = person("op1");
  const first = await dispatchDailyChange({
    companyId: "heartwood", date: day, uid: "op1", jobs: todayJobs, person: personRow,
    existing: { fingerprint: "old", updateSent: false },
    claimUpdate: async () => { if (claimed) return false; claimed = true; return true; },
    sendEach: async (messages) => { sent.push(messages[0]); return { responses: [{ success: true }] }; },
    deleteToken: async () => {},
  });
  assert.equal(first.sent, 1);
  assert.equal(sent[0].data.title, "Your jobs changed");
  assert.equal(sent[0].data.body.includes("$"), false);
  assert.equal(sent[0].data.body.includes("880"), false);
  const second = await dispatchDailyChange({
    companyId: "heartwood", date: day, uid: "op1", jobs: todayJobs, person: personRow,
    existing: { fingerprint: "old", updateSent: false },
    claimUpdate: async () => false,
    sendEach: async () => { throw new Error("should not send"); },
    deleteToken: async () => {},
  });
  assert.equal(second.skipped, "claim");
  assert.equal(sent.length, 1);
  const muted = await dispatchDailyChange({
    companyId: "heartwood", date: day, uid: "op1", jobs: todayJobs, person: person("op1", { muteDaily: true }),
    existing: { fingerprint: "old" },
    claimUpdate: async () => { throw new Error("should not claim"); },
    sendEach: async () => { throw new Error("should not send"); },
    deleteToken: async () => {},
  });
  assert.equal(muted.skipped, "muted");
});

test("quotes that are not accepted yet stay out of the morning list", () => {
  const base = { companyId: "heartwood", date: day, status: "Scheduled", assigned: ["u1"] };
  assert.equal(jobOpenToday({ ...base, quoteStatus: "Draft" }, day), false);
  assert.equal(jobOpenToday({ ...base, sm8Status: "Quote" }, day), false);
  assert.equal(jobOpenToday({ ...base, quoteStatus: "Accepted", sm8Status: "Quote" }, day), true);
  assert.equal(jobOpenToday(base, day), true);
});

test("daily job rules stay closed to the client and match the paste block", () => {
  const slice = (text) => {
    const start = text.indexOf("// BEGIN DAILY JOB RULES");
    const end = text.indexOf("// END DAILY JOB RULES");
    assert.ok(start >= 0 && end > start);
    return text.slice(start, end + "// END DAILY JOB RULES".length);
  };
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const frag = readFileSync(new URL("../production/firestore.daily-jobs.rules", import.meta.url), "utf8");
  const prod = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  assert.equal(slice(emu), slice(frag));
  assert.equal(slice(emu), slice(prod));
  assert.match(slice(frag), /allow read, write: if false/);
  const chat = (text) => {
    const start = text.indexOf("// BEGIN CHAT RULES");
    const end = text.indexOf("// END CHAT RULES");
    return text.slice(start, end);
  };
  assert.equal(chat(emu), chat(readFileSync(new URL("../production/firestore.chat.rules", import.meta.url), "utf8")));
  assert.match(emu, /match \/users\/\{uid\}\/fcmTokens\/\{tokenId\}/);
  assert.match(readFileSync(new URL("../functions/push-schedule.js", import.meta.url), "utf8"), /0 6 \* \* \*/);
  assert.match(readFileSync(new URL("../functions/push-schedule.js", import.meta.url), "utf8"), /Australia\/Brisbane/);
});
