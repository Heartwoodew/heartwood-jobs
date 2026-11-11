import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCleanupExport, checkCleanupRequest, cleanupBlocker, confirmOk, confirmPhrase, cutoffDate, cutoffDays, exportRecord,
  finishedOn, jobsCsv, linkedTimesheetRows, selectOldJobs, timesheetRemovals, EXPORT_MAX_AGE_MS,
} from "../../app/features/job-cleanup.js";
import { callerScope } from "../functions/lib/job-cleanup-run.js";

const NOW = Date.parse("2026-11-11T02:00:00Z"); // 12:00 Brisbane
const opts = { companyId: "bravo", now: NOW, days: 90 };
const job = (id, extra = {}) => ({ id, companyId: "bravo", status: "Done", date: "2026-05-01", client: "Acme", address: id + " Test St", assigned: ["op1"], ...extra });

test("cut-off is 90 days by default, adjustable, and never below 30", () => {
  assert.equal(cutoffDays(undefined), 90);
  assert.equal(cutoffDays(5), 30);
  assert.equal(cutoffDays(99999), 3650);
  assert.equal(cutoffDate(NOW, 90), "2026-08-13");
  assert.equal(cutoffDate(Date.parse("2026-11-11T14:30:00Z"), 90), "2026-08-14"); // just after midnight Brisbane
});

test("only finished jobs of this company older than the cut-off are listed", () => {
  const jobs = [
    job("old"), job("cancel", { status: "Cancelled" }), job("inv", { status: "Invoiced" }), job("legacy", { status: "", sm8Status: "Completed" }),
    job("recent", { date: "2026-10-30" }), job("recentDone", { date: "2026-01-01", completedAt: { seconds: Date.parse("2026-10-01T00:00:00Z") / 1000 } }),
    job("open", { status: "Scheduled" }), job("progress", { status: "In progress" }),
    job("other", { companyId: "charlie" }), job("hw", { companyId: undefined }), job("held", { retention: { state: "held" } }), job("nodate", { date: "" }),
  ];
  assert.deepEqual(selectOldJobs(jobs, opts).map(j => j.id).sort(), ["cancel", "inv", "legacy", "old"]);
  assert.equal(cleanupBlocker(jobs.find(j => j.id === "hw"), opts), "other-company");
  assert.equal(cleanupBlocker(jobs.find(j => j.id === "recentDone"), opts), "too-recent");
  assert.equal(cleanupBlocker(jobs.find(j => j.id === "open"), opts), "not-finished");
  assert.equal(finishedOn(jobs.find(j => j.id === "recentDone")), "2026-10-01");
});

test("the confirmation must be typed exactly (any case)", () => {
  assert.equal(confirmPhrase(12), "DELETE 12 JOBS");
  assert.equal(confirmOk("delete 12 jobs", 12), true);
  assert.equal(confirmOk("DELETE 11 JOBS", 12), false);
  assert.equal(confirmOk("", 12), false);
});

test("the download has job details, notes, linked timesheets, receipt details and optional photos", () => {
  const jobs = [job("j1", { sm8JobNo: "B-101", notes: "=HYPERLINK(\"x\")", log: [{ at: "2026-05-01", byName: "Bo", text: "Done" }] }), job("j2", { date: "2026-04-01" })];
  const sheets = [{ id: "op1_2026-04-27", uid: "op1", name: "Bo", weekStart: "2026-04-27", entries: {
    e1: { date: "2026-05-01", start: "07:00", finish: "15:00", job: "B-101 spoil" },
    e2: { date: "2026-04-29", start: "07:00", finish: "12:00", job: "other work" },
  } }, { id: "op1_2026-03-30", uid: "op1", name: "Bo", weekStart: "2026-03-30", entries: { e3: { date: "2026-04-01", start: "06:00", finish: "10:00", job: "" } } }];
  const receipts = [{ id: "r1", jobId: "j1", supplier: "Ampol", amountInc: 42, uid: "op1" }, { id: "r2", jobId: "zzz", supplier: "x" }];
  const photos = [{ jobId: "j1", name: "a.jpg", bytes: new Uint8Array([1, 2, 3]) }, { jobId: "nope", name: "b.jpg", bytes: new Uint8Array([4]) }];
  const out = buildCleanupExport({ companyId: "bravo", jobs, sheets, receipts, photos, now: NOW, days: 90, by: "Bea" });
  assert.deepEqual(out.counts, { jobs: 2, timesheetRows: 2, receipts: 1, photos: 1 });
  const text = Buffer.from(out.zip).toString("latin1");
  for (const name of ["README.txt", "jobs.csv", "timesheets.csv", "receipts.csv", "photos/B-101_j1/a.jpg"]) assert.ok(text.includes(name), name);
  assert.ok(!text.includes("b.jpg"));
  assert.match(jobsCsv(jobs), /"'=HYPERLINK/);
  const rows = linkedTimesheetRows(sheets, jobs);
  assert.deepEqual(rows.map(r => [r.job.id, r.entry.date, r.link]), [["j1", "2026-05-01", "named"], ["j2", "2026-04-01", "same-day"]]);
  assert.match(out.filename, /^old-jobs-bravo-2026-11-11\.zip$/);
});

test("timesheet removal only touches entries that name a deleted job, and never a sent sheet", () => {
  const jobs = [job("j1", { sm8JobNo: "B-101" })];
  const plans = timesheetRemovals([
    { id: "a", entries: { e1: { job: "B-101" }, e2: { job: "B-202" } } },
    { id: "b", entries: { e3: { job: "b-101 spoil" } } },
    { id: "c", sent: true, entries: { e4: { job: "B-101" } } },
    { id: "d", entries: { e5: { job: "" } } },
  ], jobs);
  assert.deepEqual(plans, [{ id: "a", removeEntryIds: ["e1"], deleteSheet: false }, { id: "b", removeEntryIds: ["e3"], deleteSheet: true }]);
});

test("the server refuses without a fresh, unused download by the same admin, the typed text, and eligible jobs", () => {
  const jobs = [job("j1"), job("j2")];
  const exportDoc = { ...exportRecord({ companyId: "bravo", uid: "adm", jobIds: ["j1", "j2"], days: 90 }), createdAtMs: NOW - 60000 };
  const base = { uid: "adm", companyId: "bravo", isAdmin: true, exportDoc, nowMs: NOW, jobIds: ["j1", "j2"], jobs, typed: "DELETE 2 JOBS" };
  assert.equal(checkCleanupRequest(base).ok, true);
  const why = over => checkCleanupRequest({ ...base, ...over }).reason;
  assert.equal(why({ uid: "" }), "sign-in");
  assert.equal(why({ isAdmin: false }), "admins-only");
  assert.equal(why({ exportDoc: null }), "download-first");
  assert.equal(why({ exportDoc: { ...exportDoc, createdBy: "other" } }), "not-your-download");
  assert.equal(why({ exportDoc: { ...exportDoc, companyId: "charlie" } }), "not-your-download");
  assert.equal(why({ exportDoc: { ...exportDoc, used: true } }), "download-already-used");
  assert.equal(why({ exportDoc: { ...exportDoc, createdAtMs: NOW - EXPORT_MAX_AGE_MS - 1 } }), "download-too-old");
  assert.equal(why({ jobIds: ["j1", "j2", "j3"], typed: "DELETE 3 JOBS" }), "not-in-download");
  assert.equal(why({ typed: "DELETE 1 JOBS" }), "confirm-text");
  assert.equal(why({ jobs: [job("j1"), job("j2", { status: "Scheduled" })] }), "not-eligible");
  assert.equal(why({ jobs: [job("j1"), job("j2", { companyId: "charlie" })] }), "not-eligible");
  assert.equal(why({ jobIds: ["j1", "../x"] }), "bad-job-list");
});

test("who may clean up: Heartwood by the admin uid list only, other companies by an admin profile", () => {
  assert.deepEqual(callerScope("1JKLsoxkQNfkphBBO0vDz2ziEyj2", null), { companyId: "heartwood", isAdmin: true, name: "" });
  assert.equal(callerScope("hwFake", { role: "admin" }).isAdmin, false);
  assert.equal(callerScope("hwFake2", { role: "admin", companyId: "heartwood" }).isAdmin, false);
  assert.equal(callerScope("38SU5waAy4f9UI9N6JTqDMaYpQg2", null).isAdmin, false);
  assert.deepEqual(callerScope("b", { role: "admin", companyId: "bravo", name: "Bea" }), { companyId: "bravo", isAdmin: true, name: "Bea" });
  assert.equal(callerScope("s", { role: "supervisor", companyId: "bravo" }).isAdmin, false);
  assert.equal(callerScope("o", { role: "operator", companyId: "bravo" }).isAdmin, false);
});

test("clean-up never runs on a schedule and the page hides it from non-admins", () => {
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.match(index, /export const cleanupOldJobs = onCall\(/);
  assert.doesNotMatch(index, /cleanup[\s\S]{0,200}onSchedule|onSchedule[\s\S]{0,200}cleanup/i);
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.match(app, /\(k === "invoices" \|\| k === "cleanup"\) && \(!me \|\| me\.role !== "admin"\)/);
  assert.match(app, /const canDelete = !!\(c\.exported && /);
});

test("a job number only matches as a whole word", async () => {
  const { entryNamesJob } = await import("../../app/features/job-cleanup.js");
  const j = { id: "abcdefghijklmnopqrst", sm8JobNo: "B-101" };
  assert.equal(entryNamesJob({ job: "B-101 spoil" }, j), true);
  assert.equal(entryNamesJob({ job: "job b-101" }, j), true);
  assert.equal(entryNamesJob({ job: "B-1010" }, j), false);
  assert.equal(entryNamesJob({ job: "XB-101" }, j), false);
  assert.equal(entryNamesJob({ job: "id abcdefghijklmnopqrst" }, j), true);
});
