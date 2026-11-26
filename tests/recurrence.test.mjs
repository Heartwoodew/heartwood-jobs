import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addMonths, cancelVisitPatch, occurrenceDates, occurrenceId, planSeries, planStopSeries, recurrenceFromForm, repeatFieldHtml, sanitizeRecurrence, shouldStopSeries, skipPatch, stopSeriesConfirmText, stopSeriesResultText, wireRepeatBox } from "../app/features/recurrence.js";

const MONEY = ["poAmount", "quoteAmount", "invoiceAmount", "totalEx", "gst", "totalInc"];

test("weekly visits fill a rolling 60 days and skip the template date", () => {
  const dates = occurrenceDates({ freq: "weekly" }, "2026-11-23", "2026-11-23", 60);
  assert.deepEqual(dates.slice(0, 3), ["2026-11-30", "2026-12-07", "2026-12-14"]);
  assert.ok(dates.every(day => day <= "2027-01-22"));
  assert.equal(dates.includes("2026-11-23"), false);
});

test("fortnightly, monthly, quarterly, yearly and every N stay inside the end", () => {
  assert.deepEqual(occurrenceDates({ freq: "fortnightly" }, "2026-11-02", "2026-11-02", 42), ["2026-11-16", "2026-11-30", "2026-12-14"]);
  assert.deepEqual(occurrenceDates({ freq: "monthly" }, "2026-01-31", "2026-01-31", 100), ["2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.deepEqual(occurrenceDates({ freq: "quarterly", count: 3 }, "2026-01-01", "2026-01-01", 400), ["2026-04-01", "2026-07-01"]);
  assert.deepEqual(occurrenceDates({ freq: "yearly", endDate: "2027-06-01" }, "2026-05-01", "2026-05-01", 800), ["2027-05-01"]);
  assert.deepEqual(occurrenceDates({ freq: "every", interval: 10, unit: "days" }, "2026-11-01", "2026-11-01", 25), ["2026-11-11", "2026-11-21"]);
});

test("a second plan does not duplicate, and a skipped or edited visit is left alone", () => {
  const template = {
    id: "job1", seriesId: "sabc", seriesRole: "template", date: "2026-11-23",
    client: "Strata", address: "1 Park St", type: "po-service", description: "Weekly service",
    recurrence: { freq: "weekly", anchor: "2026-11-23" },
    poAmount: 120, quoteAmount: 120, invoiceAmount: 90,
  };
  const first = planSeries({ template, existing: [], today: "2026-11-23", horizonDays: 21 });
  assert.equal(first.creates.length, 3);
  assert.deepEqual(first.creates.map(row => row.id), first.creates.map(row => occurrenceId("sabc", row.data.date)));
  for (const row of first.creates) {
    for (const key of MONEY) assert.equal(row.data[key], undefined);
    assert.equal(row.data.client, "Strata");
    assert.equal(row.data.status, "Scheduled");
  }
  const existing = first.creates.map(row => ({ id: row.id, ...row.data }));
  existing[0].skipped = true;
  existing[0].status = "In progress";
  existing[0].seriesException = true;
  existing[1].seriesException = true;
  existing[1].description = "Moved to Thursday";
  const second = planSeries({ template: { ...template, description: "Weekly service plus filter" }, existing, today: "2026-11-23", horizonDays: 21 });
  assert.equal(second.creates.length, 0);
  assert.equal(second.updates.some(row => row.id === existing[0].id), false);
  assert.equal(second.updates.some(row => row.id === existing[1].id), false);
  assert.equal(second.updates.some(row => row.data.description === "Weekly service plus filter"), true);
  assert.deepEqual(skipPatch(), { status: "In progress", skipped: true, seriesException: true });
});

test("a bad repeat is refused and a count of visits stops the series", () => {
  assert.equal(sanitizeRecurrence({ freq: "daily" }), null);
  assert.equal(sanitizeRecurrence({ freq: "every", interval: 0, unit: "days" }), null);
  const dates = occurrenceDates({ freq: "weekly", count: 2 }, "2026-11-01", "2026-11-01", 90);
  assert.deepEqual(dates, ["2026-11-08"]);
});

function repeatMoreTags(html) {
  const tags = [];
  for (const match of html.matchAll(/<([a-z0-9]+)([^>]*)>/gi)) {
    if (/class="[^"]*\brepeat-more\b/.test(match[2])) tags.push(match[0]);
  }
  return tags;
}

test("repeat schedule stays hidden until This job repeats is checked", () => {
  const off = repeatFieldHtml({ date: "2026-11-23" }, { admin: true, suggestion: "Pest control is often monthly." });
  assert.match(off, /This job repeats/);
  assert.equal(off.includes('name="repeatOn" checked'), false);
  assert.doesNotMatch(off, /<label class="ck"[^>]*hidden/);
  const hidden = repeatMoreTags(off);
  assert.equal(hidden.length, 5);
  assert.ok(hidden.every(tag => /\shidden(?:\s|>)/.test(tag)));
  for (const name of ["repeatFreq", "repeatEvery", "repeatUnit", "repeatEnd", "repeatEndDate", "repeatCount"]) {
    assert.match(off, new RegExp(`name="${name}"`));
  }
  assert.match(off, /How often/);
  assert.match(off, />Every</);
  assert.match(off, />Unit</);
  assert.match(off, />End</);
  assert.match(off, />End date</);
  assert.match(off, />Visits</);
  assert.match(off, /<p class="sub repeat-more" hidden>Visits are added for the next 60 days\.[^<]*Pest control is often monthly\.<\/p>/);

  const on = repeatFieldHtml({ date: "2026-11-23", recurrence: { freq: "monthly", anchor: "2026-11-23" } }, { admin: true });
  assert.match(on, /name="repeatOn" checked/);
  const shown = repeatMoreTags(on);
  assert.equal(shown.length, 5);
  assert.ok(shown.every(tag => !/\shidden(?:\s|>)/.test(tag)));
  assert.match(on, /<option value="monthly" selected>Monthly<\/option>/);

  const visit = repeatFieldHtml({ seriesRole: "occurrence", seriesId: "sabc", recurrence: { freq: "weekly" } }, { admin: true });
  assert.match(visit, /This visit is part of a series/);
  assert.match(visit, /Skip leaves this visit on the planner as In progress/);
  assert.match(visit, /data-stop-series>Stop this series/);
  assert.doesNotMatch(visit, /name="repeatOn"/);
  assert.equal(repeatMoreTags(visit).length, 5);
  assert.ok(repeatMoreTags(visit).every(tag => !/\shidden(?:\s|>)/.test(tag)));

  const crew = repeatFieldHtml({ recurrence: { freq: "weekly" } }, { admin: false });
  assert.match(crew, /Repeats Weekly/);
  assert.match(crew, /stops the series/);
  assert.doesNotMatch(crew, /repeat-more|repeatOn|How often|data-stop-series|\$/);
  assert.equal(repeatFieldHtml({}, { admin: false }), "");
  const active = repeatFieldHtml({ id: "job1", seriesId: "sabc", seriesRole: "template", date: "2026-11-23", recurrence: { freq: "weekly" } }, { admin: true });
  assert.match(active, /data-stop-series>Stop this series/);
  assert.match(active, /Untick This job repeats/);
  const stopped = repeatFieldHtml({ seriesId: "sabc", seriesEnded: true, recurrence: { freq: "weekly" } }, { admin: true });
  assert.match(stopped, /This series is stopped/);
  assert.doesNotMatch(stopped, /data-stop-series/);
});

test("checking and unchecking This job repeats shows and hides the schedule", () => {
  const more = [{ hidden: true }, { hidden: true }, { hidden: true }, { hidden: true }, { hidden: true }];
  const toggle = { name: "repeatOn", checked: false };
  let onChange = null;
  const box = {
    id: "repeatbox",
    dataset: {},
    querySelector(sel) { return String(sel).includes("repeatOn") ? toggle : null; },
    querySelectorAll(sel) { return String(sel).includes("repeat-more") ? more : []; },
    addEventListener(type, fn) { if (type === "change") onChange = fn; },
  };
  wireRepeatBox(box);
  assert.equal(box.dataset.repeatWired, "1");
  assert.ok(more.every(el => el.hidden === true));
  toggle.checked = true;
  onChange({ target: toggle });
  assert.ok(more.every(el => el.hidden === false));
  toggle.checked = false;
  onChange({ target: { name: "repeatFreq" } });
  assert.ok(more.every(el => el.hidden === false));
  onChange({ target: toggle });
  assert.ok(more.every(el => el.hidden === true));
  wireRepeatBox(box);
  assert.equal(onChange !== null, true);

  const visitMore = [{ hidden: true }];
  const visit = {
    id: "repeatbox",
    dataset: {},
    querySelector() { return null; },
    querySelectorAll() { return visitMore; },
    addEventListener() {},
  };
  wireRepeatBox(visit);
  assert.equal(visitMore[0].hidden, false);
  assert.equal(wireRepeatBox(null), undefined);
});

function formFields({ checked = false, occurrence = false, skip = false, scope = "one", freq = "weekly", interval = "2", unit = "weeks", end = "date", endDate = "2027-01-01", count = "6", date = "2026-11-23" } = {}) {
  return {
    repeatOn: occurrence ? undefined : { checked },
    repeatScope: { value: scope },
    repeatSkip: { checked: skip },
    repeatFreq: { value: freq },
    repeatEvery: { value: interval },
    repeatUnit: { value: unit },
    repeatEnd: { value: end },
    repeatEndDate: { value: endDate },
    repeatCount: { value: count },
    date: { value: date },
  };
}

test("hiding the repeat fields does not change what a save stores", () => {
  assert.deepEqual(recurrenceFromForm(formFields({ checked: false, freq: "yearly", interval: "9" }), { date: "2026-11-23" }), {
    ok: true, recurrence: null, skip: false, scope: "one",
  });
  assert.deepEqual(recurrenceFromForm(formFields({ checked: true }), { date: "2026-11-23" }), {
    ok: true,
    recurrence: { freq: "weekly", interval: 1, unit: "", endDate: "2027-01-01", count: null, anchor: "2026-11-23" },
    skip: false,
    scope: "one",
  });
  assert.equal(recurrenceFromForm(formFields({ checked: true, freq: "every", interval: "0", unit: "days", end: "" }), {}).ok, false);
  const skipped = recurrenceFromForm(formFields({ occurrence: true, skip: true, scope: "one", end: "" }), { seriesRole: "occurrence", date: "2026-11-23" });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.skip, true);
  assert.equal(skipped.scope, "one");
  assert.equal(skipped.recurrence.freq, "weekly");
});

test("stop series removes untouched future visits and keeps edited, skipped and past ones", () => {
  const template = {
    id: "job1", seriesId: "sabc", seriesRole: "template", date: "2026-11-23",
    client: "Strata", address: "1 Park St", description: "Weekly service", po: "PO1",
    recurrence: { freq: "weekly", anchor: "2026-11-23" },
    poAmount: 120, quoteAmount: 120,
  };
  const visit = (date, extra = {}) => ({
    id: occurrenceId("sabc", date), seriesId: "sabc", seriesRole: "occurrence",
    date, client: "Strata", address: "1 Park St", description: "Weekly service", po: "PO1",
    status: "Scheduled", skipped: false, seriesException: false, ...extra,
  });
  const existing = [
    visit("2026-11-16"),
    visit("2026-11-24"),
    visit("2026-11-30"),
    visit("2026-12-07", { skipped: true, status: "In progress", seriesException: true }),
    visit("2026-12-14", { seriesException: true, description: "Moved" }),
    visit("2026-12-21", { status: "Done", completedAt: "2026-12-21T01:00:00.000Z" }),
    visit("2026-12-28", { log: [{ text: "Gate code 1234", byName: "Bo" }] }),
    visit("2027-01-04", { photosEmailedCount: 2 }),
    visit("2027-01-11", { invoiceNo: "5510", invoiceAmount: 80, poAmount: 80 }),
  ];
  const extras = {
    documentJobIds: new Set([occurrenceId("sabc", "2027-01-18")]),
    timesheets: [{ entries: { e1: { job: "1 Park St", date: "2027-01-25" } } }],
  };
  existing.push(visit("2027-01-18"));
  existing.push(visit("2027-01-25"));
  const plan = planStopSeries({ template, existing, today: "2026-11-24", extras });
  assert.deepEqual(plan.remove.map(row => row.date), ["2026-11-30"]);
  assert.deepEqual(plan.templatePatch, { seriesEnded: true, seriesEndedOn: "2026-11-24", recurrence: null, seriesRole: "template" });
  const kept = Object.fromEntries(plan.keep.map(row => [row.date, row.reasons]));
  assert.deepEqual(kept["2026-12-07"], ["skipped"]);
  assert.deepEqual(kept["2026-12-14"], ["edited"]);
  assert.deepEqual(kept["2026-12-21"], ["completed"]);
  assert.ok(kept["2026-12-28"].includes("crew notes"));
  assert.ok(kept["2027-01-04"].includes("photos"));
  assert.ok(kept["2027-01-11"].includes("invoice or PO"));
  assert.ok(kept["2027-01-18"].includes("documents"));
  assert.ok(kept["2027-01-25"].includes("timesheet"));
  assert.equal(kept["2026-11-16"], undefined);
  assert.equal(kept["2026-11-24"], undefined);
  const text = stopSeriesConfirmText(plan);
  assert.match(text, /1 future visit will be removed/);
  assert.match(text, /Visits today and earlier stay/);
  assert.match(text, /2026-12-07 1 Park St \(skipped\)/);
  assert.match(text, /2027-01-11 1 Park St \(invoice or PO\)/);
  assert.doesNotMatch(text, /\$|120|80|5510/);
  assert.match(stopSeriesResultText(plan), /Removed 1 future visit/);
  assert.match(stopSeriesResultText(plan), /Kept: /);
  const again = planSeries({
    template: { ...template, ...plan.templatePatch },
    existing: existing.map(row => row.date === "2026-11-30" ? { ...row, ...cancelVisitPatch() } : row),
    today: "2026-12-01",
    horizonDays: 60,
  });
  assert.deepEqual(again, { creates: [], updates: [] });
  const endedButRuleLeft = planSeries({
    template: { ...template, seriesEnded: true },
    existing: [],
    today: "2026-11-24",
    horizonDays: 21,
  });
  assert.deepEqual(endedButRuleLeft, { creates: [], updates: [] });
  const fn = readFileSync(new URL("../cloud/functions/recurrence-fn.js", import.meta.url), "utf8");
  assert.match(fn, /template\.seriesEnded/);
  assert.match(fn, /after\.seriesEnded/);
});

test("a visit past the new end is cancelled, and a skipped in-progress visit is left alone", () => {
  const template = {
    id: "job1", seriesId: "sabc", seriesRole: "template", date: "2026-11-23",
    description: "Weekly service", recurrence: { freq: "weekly", endDate: "2026-11-29", anchor: "2026-11-23" },
  };
  const plain = { id: occurrenceId("sabc", "2026-11-30"), date: "2026-11-30", seriesId: "sabc", status: "Scheduled", description: "Weekly service" };
  const skipped = { id: occurrenceId("sabc", "2026-12-07"), date: "2026-12-07", seriesId: "sabc", status: "In progress", skipped: true, seriesException: true, description: "Weekly service" };
  const plan = planSeries({ template, existing: [plain, skipped], today: "2026-11-23", horizonDays: 60 });
  assert.deepEqual(plan.updates.find(row => row.id === plain.id).data, cancelVisitPatch());
  assert.equal(plan.updates.some(row => row.id === skipped.id), false);
  assert.equal(plan.creates.length, 0);
});

test("unticking This job repeats on a live series asks to stop, and a stopped series does not", () => {
  const job = { seriesId: "sabc", seriesRole: "template", recurrence: { freq: "weekly" }, date: "2026-11-23" };
  assert.equal(shouldStopSeries(job, { recurrence: null, skip: false }), true);
  assert.equal(shouldStopSeries(job, { recurrence: { freq: "weekly" }, skip: false }), false);
  assert.equal(shouldStopSeries({ ...job, seriesRole: "occurrence" }, { recurrence: null, skip: false }), false);
  assert.equal(shouldStopSeries({ ...job, seriesEnded: true }, { recurrence: null, skip: false }), false);
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /needsSignal\("stop-series"/);
  assert.match(app, /repeat\.stop/);
  const offline = readFileSync(new URL("../app/features/offline.js", import.meta.url), "utf8");
  assert.match(offline, /Stop series needs a connection/);
  const help = readFileSync(new URL("../app/features/help.js", import.meta.url), "utf8");
  assert.match(help, /skipped visit stays on the planner as In progress/);
  assert.match(help, /Stop this series/);
  assert.doesNotMatch(help, /skipped visit becomes Unsuccessful|becomes Unsuccessful/);
});

test("the job modal wires the repeat box and the shell is callup-shell-v161-requirements", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /wireRepeatBox\(f,/);
  const css = readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.repeat-box \.repeat-more\[hidden\]\{display:none !important\}/);
  const sw = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v161-requirements/);
  assert.match(sw, /features\/recurrence\.js/);
});
