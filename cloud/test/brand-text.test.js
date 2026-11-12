// 12 Nov 2026 (Alex): no ServiceM8 / SM8 wording anywhere a person can see it, and no Heartwood wording on CallUp
// client companies. Internal field names (sm8JobNo, sm8Status, ...) and ids/project ids are unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const acorn = require("acorn");
const walk = require("acorn-walk");
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function jsFiles(dir, out = []) {
  for (const f of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, f), st = statSync(join(ROOT, rel));
    if (st.isDirectory()) { if (!/^(node_modules|vendor|icons)$/.test(f)) jsFiles(rel, out); }
    else if (f.endsWith(".js")) out.push(rel);
  }
  return out;
}
/** Every string literal and template text in shipped app + functions code (comments and regex literals excluded). */
function shippedStrings() {
  const out = [];
  for (const f of [...jsFiles("app"), ...jsFiles("cloud/functions")]) {
    const ast = acorn.parse(readFileSync(join(ROOT, f), "utf8"), { ecmaVersion: "latest", sourceType: "module", locations: true });
    walk.full(ast, n => {
      if (n.type === "Literal" && typeof n.value === "string") out.push({ f, line: n.loc.start.line, v: n.value });
      if (n.type === "TemplateElement" && n.value.cooked) out.push({ f, line: n.loc.start.line, v: n.value.cooked });
    });
  }
  for (const f of ["app/index.html", "app/manifest.webmanifest", "app/styles.css"]) out.push({ f, line: 0, v: readFileSync(join(ROOT, f), "utf8") });
  return out;
}

test("no ServiceM8 / SM8 in any shipped string, page, manifest or stylesheet (for every company, Heartwood too)", () => {
  // "sm8" alone is a stored data value (job.source === "sm8"), never shown.
  const hits = shippedStrings().filter(s => /servicem8|\bSM8\b/i.test(s.v) && s.v !== "sm8");
  assert.deepEqual(hits.map(h => `${h.f}:${h.line} ${JSON.stringify(h.v).slice(0, 80)}`), []);
});

// Reviewed: each of these is an id, a Heartwood-only branch, a config default only used for Heartwood, or a Firebase
// project id. A new string mentioning Heartwood fails here until it is checked against client companies.
const HEARTWOOD_OK = new Set([
  "heartwood", "demo-heartwood", "heartwood-held", "heartwood-not-approved",
  "heartwood-9f37f", "heartwood-9f37f.firebaseapp.com", "heartwood-9f37f.firebasestorage.app",
  "https://australia-southeast1-heartwood-9f37f.cloudfunctions.net/stripeWebhook",
  "alex@heartwoodew.com", "accounts@heartwoodew.com", "https://jobs.heartwoodew.com", "https://jobs.heartwoodew.com/app",
  "-Quotes/1.0 (alex@heartwoodew.com)",
  "Heartwood", "Heartwood Earthworx", "Heartwood Earthworx Pty Ltd", "Heartwood Jobs",
  "Heartwood Jobs <jobs@heartwoodew.com>", "Heartwood Jobs <noreply@callupapp.com.au>", "You're invited to Heartwood Jobs",
  "Optional. Heartwood receipts still use the address on the Receipts page.",
]);
test("every shipped string that mentions Heartwood is on the reviewed list", () => {
  const hits = shippedStrings().filter(s => !s.f.endsWith(".html") && !s.f.endsWith(".css") && !s.f.endsWith(".webmanifest"))
    .filter(s => /heartwood/i.test(s.v) && !HEARTWOOD_OK.has(s.v) && !s.v.startsWith("Location is captured only when you tap Clock on"));
  assert.deepEqual(hits.map(h => `${h.f}:${h.line} ${JSON.stringify(h.v).slice(0, 80)}`), []);
  for (const f of ["app/index.html", "app/manifest.webmanifest"]) assert.doesNotMatch(readFileSync(join(ROOT, f), "utf8"), /heartwood/i, f);
});

const NO_HW = /heartwood|heartwoodew|chuwar|holdsworth|31 667 738 098|0499 802 812/i;

test("a client company's settings, mail parts and brand never fall back to Heartwood", async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const org = await import("../../app/org-settings.js");
  const co = await import("../../app/features/company.js");
  for (const c of [{ companyId: "bravo" }, { companyId: "bravo", name: "Bravo Civil" }, { companyId: "callup-test-x", name: "Test", isTest: true }]) {
    const o = org.setActiveCompany(c);
    assert.doesNotMatch(JSON.stringify(o), NO_HW, JSON.stringify(c));
    assert.doesNotMatch(JSON.stringify(Object.values(co.hoursBrand(o))), NO_HW);
    assert.doesNotMatch(JSON.stringify(co.timesheetMailParts(o, "Sam")), NO_HW);
    assert.doesNotMatch(JSON.stringify(co.builderSignoff(o, "Sam")), NO_HW);
    assert.doesNotMatch(co.companyMailbox(o), NO_HW);
  }
  assert.equal(org.setActiveCompany({ companyId: "bravo" }).name, "CallUp");
  assert.match(org.setActiveCompany(null).name, /Heartwood/, "Heartwood keeps its own name");
});

test("client timesheet consent, hours export, quote depot and run-sheet depot are Heartwood-free", async () => {
  const ts = await import("../../app/features/timesheet.js");
  for (const who of ["", "Bravo Civil"]) assert.doesNotMatch(ts.locationConsent(who), NO_HW);
  const hx = await import("../../app/features/hours-export.js");
  assert.doesNotMatch(hx.exportFileName("", "2026-11-09"), NO_HW);
  const q = await import("../../app/features/quotes.js");
  q.setDefaultDepot("", { heartwood: false });
  assert.doesNotMatch(JSON.stringify(q.DEFAULT_DEPOT), NO_HW);
  q.setDefaultDepot("", { heartwood: true });
  assert.match(q.DEFAULT_DEPOT.yardAddress, /Chuwar/);
  const r = await import("../../app/features/route-order.js");
  r.setRouteDepot("", { heartwood: false });
  assert.equal(r.depotAddress(), "");
  r.setRouteDepot("", { heartwood: true });
  assert.match(r.depotAddress(), /Chuwar/);
});

test("invite emails (both copies) for a client company never say Heartwood, with or without a company name", async () => {
  for (const path of ["../../app/features/staff-invites.js", "../functions/shared/staff-invites.js"]) {
    const m = await import(path);
    const invite = m.buildInviteDraft({ name: "Casey", email: "casey@example.com", role: "operator", createdBy: "admin-1",
      now: new Date("2026-11-10T00:00:00Z"), token: "c".repeat(43), tenantId: "bravo" }).invite;
    for (const extra of [{}, { companyName: "Bravo Civil", companyEmail: "office@bravo.test" }]) {
      const mail = m.buildInviteEmail(invite, { ...m.inviteEmailConfig({}), ...extra });
      assert.doesNotMatch(JSON.stringify(mail), NO_HW, path + " " + JSON.stringify(extra));
    }
    assert.doesNotMatch(m.staffViewHtml([], { origin: "https://app.callupapp.com.au" }), NO_HW);
  }
});

test("helper: no ServiceM8 for anyone; no Heartwood in a client company's prompt or reply", async () => {
  const { buildHelperPrompt, sanitiseReply, neutralText } = await import("../functions/helper/prompt.js");
  const knowledge = { source: "pack", text: "Heartwood Earthworx imports from ServiceM8 (SM8 job #). Email alex@heartwoodew.com." };
  const ctx = { jobs: [{ id: "j", sm8JobNo: "700", sm8Status: "Work Order", description: "Heartwood ServiceM8 job" }] };
  const p = buildHelperPrompt({ name: "Bo", role: "operator", tenantId: "bravo", canSeeMoney: false, finance: false, today: "Thursday 12 November 2026",
    knowledge, context: ctx, question: "What is ServiceM8?", canary: "CANARY-1" });
  assert.doesNotMatch(p.system + p.user, /heartwood|servicem8|\bsm8\b/i);
  const hw = buildHelperPrompt({ name: "Alex", role: "admin", tenantId: "heartwood", canSeeMoney: true, finance: true, today: "Thursday 12 November 2026",
    knowledge, context: ctx, question: "q", canary: "CANARY-2" });
  assert.doesNotMatch(hw.system + hw.user, /servicem8|\bsm8\b/i);
  assert.match(hw.user, /Heartwood/, "Heartwood's own helper may name Heartwood");
  assert.doesNotMatch(sanitiseReply("Heartwood syncs it to ServiceM8.", { canary: "C", canSeeMoney: false, tenantId: "bravo" }), /heartwood|servicem8/i);
  assert.doesNotMatch(sanitiseReply("It syncs to ServiceM8.", { canary: "C", canSeeMoney: true, tenantId: "heartwood" }), /servicem8/i);
  assert.equal(neutralText("SM8 #12", "heartwood"), "job #12");
});

test("function replies to client companies: the Xero queue note is Heartwood-free", async () => {
  const { handleXeroQueue } = await import("../functions/pro/xero-queue.js");
  assert.doesNotMatch(JSON.stringify(handleXeroQueue([])), NO_HW);
});
