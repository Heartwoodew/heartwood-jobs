import test from "node:test";
import assert from "node:assert/strict";
import { addMonths, occurrenceDates, occurrenceId, planSeries, sanitizeRecurrence } from "../app/features/recurrence.js";

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
