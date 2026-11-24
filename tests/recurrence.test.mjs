import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addMonths, occurrenceDates, occurrenceId, planSeries, recurrenceFromForm, repeatFieldHtml, sanitizeRecurrence, wireRepeatBox } from "../app/features/recurrence.js";

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
  existing[0].status = "Cancelled";
  existing[1].seriesException = true;
  existing[1].description = "Moved to Thursday";
  const second = planSeries({ template: { ...template, description: "Weekly service plus filter" }, existing, today: "2026-11-23", horizonDays: 21 });
  assert.equal(second.creates.length, 0);
  assert.equal(second.updates.some(row => row.id === existing[0].id), false);
  assert.equal(second.updates.some(row => row.id === existing[1].id), false);
  assert.equal(second.updates.some(row => row.data.description === "Weekly service plus filter"), true);
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

  const visit = repeatFieldHtml({ seriesRole: "occurrence", recurrence: { freq: "weekly" } }, { admin: true });
  assert.match(visit, /This visit is part of a series/);
  assert.doesNotMatch(visit, /name="repeatOn"/);
  assert.equal(repeatMoreTags(visit).length, 5);
  assert.ok(repeatMoreTags(visit).every(tag => !/\shidden(?:\s|>)/.test(tag)));

  const crew = repeatFieldHtml({ recurrence: { freq: "weekly" } }, { admin: false });
  assert.match(crew, /Repeats Weekly/);
  assert.doesNotMatch(crew, /repeat-more|repeatOn|How often/);
  assert.equal(repeatFieldHtml({}, { admin: false }), "");
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

test("the job modal wires the repeat box and the shell is callup-shell-v156-dispatch-drag", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /wireRepeatBox\(f\)/);
  const css = readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.repeat-box \.repeat-more\[hidden\]\{display:none !important\}/);
  const sw = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v156-dispatch-drag/);
  assert.match(sw, /features\/recurrence\.js/);
});
