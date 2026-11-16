import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  acceptGap, acceptedQuoteBannerHtml, calcSections, normalizeQuoteSections, quoteAcceptedButtonHtml, quotesViewHtml
} from "../app/features/quotes.js";

const rates = {
  travelPerKm: 2, materialPerUnit: 3, tipPerLoad: 4,
  machineRates: {
    truck: { rate: 100, unit: "hour" },
    skid: { rate: 80, unit: "hour" },
    excavator: { rate: 120, unit: "hour" }
  },
  labourerRate: 45, labourerUnit: "hour"
};

const blankRates = {
  travelPerKm: null, materialPerUnit: null, tipPerLoad: null,
  machineRates: {
    truck: { rate: null, unit: "hour" },
    skid: { rate: null, unit: "hour" },
    excavator: { rate: null, unit: "hour" }
  },
  labourerRate: null, labourerUnit: "hour"
};

function spoil(extra = {}) {
  return {
    client: "Orbit",
    address: "1 Test Street, Chuwar QLD 4306",
    sections: normalizeQuoteSections({
      type: "spoil", hoursOnSite: 2, machines: ["truck", "skid"], presetId: "truck_skid",
      includeLabourer: false, travelKm: 0, materialQty: 0, tipLoads: 0, machineDays: 1,
      ...extra
    })
  };
}

test("a complete quote can be accepted", () => {
  const state = spoil();
  assert.equal(acceptGap(state, calcSections(state, rates), rates), null);
});

test("a missing site address is named and jumps to that field", () => {
  const state = spoil();
  state.address = "  ";
  assert.deepEqual(acceptGap(state, calcSections(state, rates), rates), {
    message: "Add the site address first", step: 0, focus: "[name=address]"
  });
});

test("missing plant rates are named before a total is invented", () => {
  const state = spoil();
  const gap = acceptGap(state, calcSections(state, blankRates), blankRates);
  assert.equal(gap.message, "Add rates first");
  assert.equal(gap.step, 2);
  assert.equal(gap.focus, "#qwmissing");
});

test("hourly plant without hours is named before rates", () => {
  const state = spoil({ hoursOnSite: "" });
  const gap = acceptGap(state, calcSections(state, rates), rates);
  assert.match(gap.message, /hours on site/);
  assert.equal(gap.step, 1);
  assert.match(gap.focus, /hoursOnSite/);
});

test("the accept control stays enabled and does not show a price", () => {
  const html = quoteAcceptedButtonHtml(false);
  assert.match(html, /Quote accepted/);
  assert.match(html, /Turns this quote into a job/);
  assert.match(html, /id="qwaccept"/);
  assert.match(html, /data-can-accept="0"/);
  assert.doesNotMatch(html, /disabled/);
  assert.doesNotMatch(html, /\$/);
});

test("an accepted quote shows the job and a way to open it, with no price", () => {
  const html = acceptedQuoteBannerHtml({
    quoteStatus: "Accepted", jobId: "job1234", jobIds: ["job1234", "job9999"], totalEx: 480, totalInc: 528
  }, s => String(s ?? ""));
  assert.match(html, /Accepted · Job job1234/);
  assert.match(html, /Open job/);
  assert.match(html, /data-job="job1234"/);
  assert.match(html, /data-job="job9999"/);
  assert.doesNotMatch(html, /\$|480|528/);
  assert.doesNotMatch(html, /id="qwaccept"/);
});

test("each draft row offers Quote accepted and an accepted row names its job", () => {
  const esc = s => String(s ?? "");
  const html = quotesViewHtml({
    quoteRates: rates,
    quotes: [
      { id: "q1", quoteStatus: "Draft", client: "Orbit", address: "Lot 1", totalEx: 10 },
      { id: "q2", quoteStatus: "Accepted", jobId: "job9", client: "Orbit", address: "Lot 2", totalEx: 20 }
    ]
  }, esc, v => "$" + v, { canEditQuoteRates: () => false });
  assert.match(html, /data-qaccept="q1"[^>]*>Quote accepted</);
  assert.match(html, /class="jobs qlist"/);
  assert.doesNotMatch(html, /Accept →/);
  assert.match(html, /Job job9/);
  assert.equal((html.match(/data-qaccept/g) || []).length, 1);
});

test("quote accept ships in the next service worker cache", () => {
  const sw = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v121-price50/);
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /canQuote = \(\) => canSeeMoney\(\)/);
  assert.match(app, /openJob: openAcceptedJob/);
  const src = readFileSync(new URL("../app/features/quotes.js", import.meta.url), "utf8");
  assert.match(src, /jobsFromAcceptedQuote\(payload, calc, mode\)/);
});
