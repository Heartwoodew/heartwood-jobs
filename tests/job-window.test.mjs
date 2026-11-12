import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OPEN_STATUSES, addDaysIso, staleOpenJobs, mergeJobLists } from "../app/features/job-window.js";

const today = "2026-11-12";
const job = (id, date, status = "Scheduled", extra = {}) => ({ id, date, status, ...extra });

test("addDaysIso crosses month and year ends", () => {
  assert.equal(addDaysIso("2026-11-12", -14), "2026-10-29");
  assert.equal(addDaysIso("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
});

test("older jobs still open are picked; window, undated, finished and cancelled jobs are not", () => {
  const list = [
    job("sm689", "2026-10-23"), job("sm690", "2026-10-23", "Scheduled", { time: "08:00" }), job("early", "2026-10-13", "In progress"),
    job("edge", "2026-10-29"),               // first day of the window: already in the window query
    job("recent", "2026-11-10"), job("undated", ""), job("nodate", undefined),
    job("done", "2026-10-01", "Done"), job("cancelled", "2026-10-01", "Cancelled"),
    job("badfmt", "23/10/2026"), job("num", 20261023),
  ];
  assert.deepEqual(staleOpenJobs(list, today).map(j => j.id), ["early", "sm689", "sm690"]);
  assert.deepEqual(staleOpenJobs(list, today).map(j => j.status), ["In progress", "Scheduled", "Scheduled"]);
  assert.deepEqual(OPEN_STATUSES, ["Scheduled", "In progress"]);
  assert.deepEqual(staleOpenJobs(null, today), []);
});

test("merge keeps window jobs and adds stale ones once", () => {
  const win = [job("a", "2026-11-12"), job("b", "2026-11-13")];
  const merged = mergeJobLists(win, [job("b", "2026-11-13"), job("old", "2026-10-20")]);
  assert.deepEqual(merged.map(j => j.id), ["a", "b", "old"]);
  assert.equal(merged[1], win[1], "window copy wins");
  assert.deepEqual(mergeJobLists(undefined, undefined), []);
});

test("office app subscribes to older open jobs and merges them into the job list; crew query is unchanged", () => {
  const src = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(src, /companyJobs\(\[where\("status", "in", \[\.\.\.OPEN_STATUSES\]\)\]\)/);
  assert.match(src, /jobs = mergeJobLists\(windowJobs, staleJobs\)\.map\(withMoney\)/);
  assert.match(src, /u1\(\); u2\(\); u3\(\); u4\(\); u5\(\);/);
  assert.match(src, /companyJobs\(\[where\("assigned", "array-contains", user\.uid\)\]\)/);
  const sw = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /"features\/job-window\.js"/);
  assert.match(sw, /callup-shell-v95-company-logo-upload/);
});
