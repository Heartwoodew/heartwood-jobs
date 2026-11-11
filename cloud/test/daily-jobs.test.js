import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  brisbaneDate, companiesToScan, companySkipped, dailyOpenUrl, digestCopy, digestDocId,
  dispatchDailyJobs, jobOpenToday, jobPlace, jobRef, selectDailyDigests,
} from "../functions/daily-jobs.js";

const day = "2026-11-11";
const heartwood = { id: "heartwood", name: "Heartwood", jobPrefix: "HW" };

function person(uid, extra = {}) {
  return {
    uid,
    profile: extra.profile || { role: "operator", name: uid },
    push: extra.push !== false,
    dailyJobs: extra.dailyJobs,
    tokens: extra.tokens || [{
      id: "t-" + uid,
      token: "fcm-token-value-0123456789-" + uid,
      companyId: extra.companyId || "heartwood",
      origin: extra.origin || "https://jobs.heartwoodew.com",
    }],
  };
}

const todayJobs = [
  { id: "job1", companyId: "heartwood", date: day, status: "Scheduled", time: "07:00", assigned: ["op1", "op2"], address: "12 Creek Rd, Springfield QLD 4300", sm8JobNo: "4521", invoiceAmount: 880, poAmount: 900 },
  { id: "jobDone", companyId: "heartwood", date: day, status: "Done", assigned: ["op1"], address: "1 Done St" },
  { id: "jobCancel", companyId: "heartwood", date: day, status: "Cancelled", assigned: ["op1"], address: "2 Cancel St" },
  { id: "jobOld", companyId: "heartwood", date: day, status: "Scheduled", sm8Status: "Completed", assigned: ["op1"], address: "3 Old St" },
  { id: "jobFail", companyId: "heartwood", date: day, status: "Scheduled", sm8Status: "Unsuccessful", assigned: ["op1"], address: "4 Fail St" },
  { id: "jobTomorrow", companyId: "heartwood", date: "2026-11-12", status: "Scheduled", assigned: ["op1"], address: "Tomorrow" },
  { id: "jobOther", companyId: "otherco", date: day, status: "Scheduled", assigned: ["op1"], address: "Other yard" },
  { id: "silk", companyId: "heartwood", date: day, status: "In progress", time: "09:00", assigned: ["scoped"], client: "Silkwood Homes", address: "9 Silk St, Goodna" },
  { id: "orbit", companyId: "heartwood", date: day, status: "Scheduled", time: "06:30", assigned: ["scoped", "ada"], client: "Orbit Homes (Qld) Pty Ltd", suburb: "Redbank Plains" },
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
    { id: "bravo", status: "active", jobPrefix: "BE", name: "Bravo" },
  ]);
  assert.deepEqual(scan.map(c => c.id), ["heartwood", "bravo"]);
  const withHeartwood = companiesToScan([{ id: "heartwood", isTest: true, status: "active" }, { id: "bravo", status: "active" }]);
  assert.deepEqual(withHeartwood.map(c => c.id), ["bravo"]);
});

test("today's allocated jobs skip finished work, other companies, and money", () => {
  assert.equal(jobOpenToday(todayJobs[0], day), true);
  assert.equal(jobOpenToday(todayJobs[1], day), false);
  assert.equal(jobPlace(todayJobs[0]), "Springfield");
  assert.equal(jobPlace(todayJobs[8]), "Redbank Plains");
  assert.equal(jobRef(todayJobs[0], heartwood), "4521");
  const people = [
    person("op1"),
    person("op2", { dailyJobs: undefined }),
    person("idle"),
    person("muted", { push: false }),
    person("quiet", { dailyJobs: false }),
    person("scoped", { profile: { role: "operator", customerIds: ["Orbit Homes (Qld) Pty Ltd"] } }),
    person("ada", { profile: { role: "admin", name: "Ada" } }),
    person("boss", { profile: { role: "admin", name: "Boss" } }),
    person("outsider", { profile: { role: "operator", companyId: "otherco" }, companyId: "heartwood" }),
    person("notoken", { tokens: [] }),
  ];
  const digests = selectDailyDigests({ companyId: "heartwood", date: day, company: heartwood, jobs: todayJobs, people });
  const byUid = Object.fromEntries(digests.map(d => [d.uid, d]));
  assert.deepEqual(Object.keys(byUid).sort(), ["ada", "op1", "op2", "scoped"]);
  assert.deepEqual(byUid.op1.jobIds, ["job1"]);
  assert.deepEqual(byUid.scoped.jobIds, ["orbit"]);
  assert.equal(byUid.ada.jobIds.includes("job1"), false);
  assert.equal(byUid.op1.messages[0].data.body.includes("4521"), true);
  assert.equal(byUid.op1.messages[0].data.body.includes("Springfield"), true);
  assert.equal(byUid.op1.messages[0].data.body.includes("880"), false);
  assert.equal(byUid.op1.messages[0].data.body.includes("$"), false);
  assert.equal(byUid.op1.messages[0].data.view, "today");
  assert.equal(byUid.op1.messages[0].webpush.fcmOptions.link, "https://jobs.heartwoodew.com/app/?jobs=today");
  assert.equal(dailyOpenUrl("https://evil.example", "bravo"), "https://app.callupapp.com.au/app/?jobs=today");
  assert.equal(digestCopy(["A · B", "C · D", "E · F", "G · H", "I · J"]).body.includes("+1 more"), true);
  assert.equal(digestDocId("heartwood", day, "op1"), "heartwood_2026-11-11_op1");
});

test("the morning send is once per person and skips test companies", async () => {
  const claimed = new Set();
  const sent = [];
  const loaded = [];
  const dropped = [];
  const run = () => dispatchDailyJobs({
    date: day,
    loadCompanies: async () => [
      { id: "heartwood", status: "active", jobPrefix: "HW" },
      { id: "acme", isTest: true, status: "active" },
      { id: "bravo", status: "active", jobPrefix: "BE", name: "Bravo" },
    ],
    loadJobs: async (companyId) => {
      loaded.push(companyId);
      if (companyId === "heartwood") return todayJobs;
      if (companyId === "bravo") return [{ id: "b1", companyId: "bravo", date: day, status: "Scheduled", assigned: ["bop"], address: "4 Yard Rd, Ipswich QLD 4305" }];
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
  assert.equal(jobRef({ id: "b1" }, { id: "bravo", jobPrefix: "BE" }), "BE-B1");
});

test("daily job rules stay closed to the client and match the paste block", async () => {
  const { readFileSync } = await import("node:fs");
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
});

test("quotes that are not accepted yet stay out of the morning list", () => {
  const base = { companyId: "heartwood", date: day, status: "Scheduled", assigned: ["u1"] };
  assert.equal(jobOpenToday({ ...base, quoteStatus: "Draft" }, day), false);
  assert.equal(jobOpenToday({ ...base, sm8Status: "Quote" }, day), false);
  assert.equal(jobOpenToday({ ...base, quoteStatus: "Accepted", sm8Status: "Quote" }, day), true);
  assert.equal(jobOpenToday({ ...base, quoteStatus: "Accepted" }, day), true);
  assert.equal(jobOpenToday({ ...base, sm8Status: "Work Order" }, day), true);
  assert.equal(jobOpenToday(base, day), true);
});
