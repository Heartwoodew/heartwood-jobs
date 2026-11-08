import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CALLUP_BASE, resolveMembership } from "../../app/features/cloud-storage.js";
import { SCHEDULING_APPROVED } from "../../app/features/cloud-retention.js";
import {
  CALLUP_PLANS, addIsoDays, assetPayload, assetStatus, attentionCounts, bannerHtml,
  canEditCompliance, canViewFleet, canViewPolicies, classifyDate, complianceFor,
  featuresFor, fleetCardsHtml, needsAttention, policyCardsHtml, policyPayload, policyStatus,
  sortBySoonest, withStatus,
} from "../../app/features/compliance.js";

const TODAY = "2026-11-06";

function rulesSlice(text) {
  const start = text.indexOf("// BEGIN FLEET RULES");
  const end = text.indexOf("// END FLEET RULES");
  assert.ok(start >= 0 && end > start);
  return text.slice(start, end + "// END FLEET RULES".length);
}

test("fleet and policies are Pro, off on Base, and on for Heartwood only", () => {
  assert.equal(CALLUP_BASE.features.fleet, false);
  assert.equal(CALLUP_BASE.features.policies, false);
  assert.equal(CALLUP_BASE.xero, false);
  assert.equal(CALLUP_BASE.invoicing, false);
  assert.equal(CALLUP_PLANS.base.features.fleet, false);
  assert.equal(CALLUP_PLANS.base.features.policies, false);
  assert.equal(CALLUP_PLANS.pro.plan, "pro");
  assert.equal(CALLUP_PLANS.pro.features.fleet, true);
  assert.equal(CALLUP_PLANS.pro.features.policies, true);
  assert.equal(CALLUP_PLANS.base.features.servicing, false);
  assert.equal(CALLUP_PLANS.pro.features.servicing, true);
  assert.equal(CALLUP_PLANS.base.features.prestart, false);
  assert.equal(CALLUP_PLANS.pro.features.prestart, true);
  assert.equal(CALLUP_BASE.features.servicing, false);
  assert.equal(CALLUP_BASE.features.prestart, false);
  const heartwood = featuresFor(resolveMembership({ uid: "op1", profile: { role: "operator", name: "Sam" } }));
  assert.equal(heartwood.plan, "pro");
  assert.equal(heartwood.features.fleet, true);
  assert.equal(canViewFleet(heartwood), true);
  assert.equal(canEditCompliance(heartwood, "operator"), false);
  assert.equal(canEditCompliance(heartwood, "supervisor"), false);
  assert.equal(canEditCompliance(heartwood, "admin"), true);
  assert.equal(canViewPolicies(heartwood, "operator"), false);
  assert.equal(canViewPolicies(heartwood, "supervisor"), false);
  assert.equal(canViewPolicies(heartwood, "admin"), true);
  const other = featuresFor(resolveMembership({
    uid: "adm2", profile: { role: "admin", tenantId: "otherco", plan: "pro" }, requestedTenantId: "heartwood",
  }));
  assert.equal(other.plan, "base");
  assert.equal(other.features.fleet, false);
  assert.equal(canViewPolicies(other, "admin"), false);
  assert.equal(complianceFor({ uid: "1JKLsoxkQNfkphBBO0vDz2ziEyj2", role: "admin", cloudProfile: null }).features.fleet, true);
});

test("rego and COI status is OK, due within 30 days, or expired", () => {
  assert.equal(addIsoDays(TODAY, 30), "2026-12-06");
  assert.equal(classifyDate(TODAY, TODAY).k, "due");
  assert.equal(classifyDate("2026-12-06", TODAY).k, "due");
  assert.equal(classifyDate("2026-12-07", TODAY).k, "ok");
  assert.equal(classifyDate("2026-11-05", TODAY).k, "expired");
  assert.equal(classifyDate("", TODAY).label, "No date");
  const expired = assetStatus({ regoExpiry: "2026-10-01", coiRequired: true, coiExpiry: "2026-09-15" }, TODAY);
  assert.equal(expired.k, "expired");
  assert.equal(expired.sort, "2026-09-15");
  const due = assetStatus({ regoExpiry: "2026-11-28", coiRequired: true, coiExpiry: "2027-04-01" }, TODAY);
  assert.equal(due.k, "due");
  assert.equal(due.label, "Due within 30 days");
  assert.equal(due.sort, "2026-11-28");
  const ok = assetStatus({ regoExpiry: "2027-06-01", coiRequired: false, coiExpiry: "2020-01-01" }, TODAY);
  assert.equal(ok.k, "ok");
  assert.equal(ok.coi, null);
  const missingCoi = assetStatus({ regoExpiry: "2027-06-01", coiRequired: true, coiExpiry: "" }, TODAY);
  assert.equal(missingCoi.k, "expired");
  assert.equal(missingCoi.sort, "");
  const rows = sortBySoonest(withStatus([
    { id: "ok", name: "Ute", regoExpiry: "2027-06-01", coiRequired: false },
    { id: "due", name: "Trailer", regoExpiry: "2026-11-28", coiRequired: true, coiExpiry: "2027-04-01" },
    { id: "exp", name: "Tipper", regoExpiry: "2026-10-01", coiRequired: true, coiExpiry: "2026-09-15" },
  ], TODAY, "asset"));
  assert.deepEqual(rows.map(r => r.id), ["exp", "due", "ok"]);
  assert.equal(policyStatus({ expiry: "2026-09-01" }, TODAY).k, "expired");
  assert.equal(policyStatus({ expiry: "2026-11-25", startDate: "2027-01-01" }, TODAY).k, "due");
});

test("payloads match the rules shape and staff html hides policies", () => {
  const asset = assetPayload({
    type: "trailer", name: " Dog ", rego: "pre002", regoExpiry: "2026-11-28",
    coiRequired: false, coiExpiry: "2020-01-01", notes: "yard",
  }, "admin1");
  assert.equal(asset.ok, true);
  assert.equal(asset.data.rego, "PRE002");
  assert.equal(asset.data.coiExpiry, "");
  assert.deepEqual(Object.keys(asset.data).sort(), ["coiExpiry", "coiRequired", "name", "notes", "rego", "regoExpiry", "type", "updatedBy"]);
  assert.equal(assetPayload({ type: "car", name: "X", rego: "", regoExpiry: "", coiRequired: false, coiExpiry: "", notes: "" }, "admin1").ok, false);
  const policy = policyPayload({
    type: "vehicle", insurer: "Preview Insurance", policyNumber: "VI-9", startDate: "2026-01-01",
    expiry: "2027-01-15", amount: "$10,000,000", notes: "", assetId: "a1",
  }, "admin1");
  assert.equal(policy.ok, true);
  assert.equal(policy.data.assetId, "a1");
  const cleared = policyPayload({
    type: "workcover", insurer: "WorkCover Queensland", policyNumber: "WC", startDate: "",
    expiry: "2026-11-25", amount: "Statutory", notes: "", assetId: "a1",
  }, "admin1");
  assert.equal(cleared.data.assetId, "");
  assert.equal(policyPayload({ type: "workcover", insurer: "", policyNumber: "", startDate: "", expiry: "", amount: "", notes: "", assetId: "" }, "admin1").ok, false);

  const cards = fleetCardsHtml([
    { id: "a1", type: "vehicle", name: "Preview tipper", rego: "PRE001", regoExpiry: "2026-10-01", coiRequired: true, coiExpiry: "2026-09-15", notes: "" },
    { id: "a3", type: "vehicle", name: "Preview ute", rego: "PRE003", regoExpiry: "2027-06-01", coiRequired: false, coiExpiry: "", notes: "" },
  ], TODAY, { editable: false });
  assert.match(cards, /Expired/);
  assert.match(cards, /OK/);
  assert.match(cards, /Not required/);
  assert.doesNotMatch(cards, /data-comp-edit|WorkCover|\$20|policy/i);
  const editable = fleetCardsHtml([{ id: "a1", type: "vehicle", name: "Preview tipper", rego: "PRE001", regoExpiry: "2026-10-01", coiRequired: true, coiExpiry: "2026-09-15" }], TODAY, { editable: true });
  assert.match(editable, /data-comp-edit="asset"/);
  const policies = policyCardsHtml([
    { id: "p1", type: "public-liability", insurer: "Preview Mutual", policyNumber: "PL-100", expiry: "2026-09-01", amount: "$20,000,000", assetId: "" },
  ], [], TODAY);
  assert.match(policies, /Public liability/);
  assert.match(policies, /\$20,000,000/);
  assert.match(policies, /data-comp-edit="policy"/);
  const staffBanner = bannerHtml({
    assets: [{ name: "Preview tipper", regoExpiry: "2026-10-01", coiRequired: true, coiExpiry: "2026-09-15" }],
    policies: [{ type: "workcover", insurer: "WorkCover Queensland", expiry: "2026-09-01", amount: "$20,000,000" }],
    today: TODAY, includePolicies: false, go: "fleet",
  });
  assert.match(staffBanner, /Fleet needs attention/);
  assert.match(staffBanner, /Preview tipper/);
  assert.doesNotMatch(staffBanner, /WorkCover|policy|\$20/);
  const adminBanner = bannerHtml({
    assets: [{ name: "Preview tipper", regoExpiry: "2026-10-01", coiRequired: true, coiExpiry: "2026-09-15" }],
    policies: [{ type: "workcover", insurer: "WorkCover Queensland", expiry: "2026-11-25" }],
    today: TODAY, includePolicies: true, go: "compliance",
  });
  assert.match(adminBanner, /Compliance needs attention/);
  assert.match(adminBanner, /policy due/);
  assert.match(adminBanner, /WorkCover/);
  assert.doesNotMatch(adminBanner, /\$20/);
  const counts = attentionCounts(
    [{ regoExpiry: "2027-01-01", coiRequired: false }],
    [{ expiry: "2027-01-01" }],
    TODAY,
    false,
  );
  assert.equal(needsAttention(counts), false);
  assert.equal(counts.policyDue, 0);
});

test("compliance rules are additive and do not touch receipts, finance, or scheduling", () => {
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const frag = readFileSync(new URL("../production/firestore.fleet.rules", import.meta.url), "utf8");
  assert.equal(rulesSlice(emu), rulesSlice(frag));
  assert.match(emu, /match \/receipts\/\{id\}/);
  assert.match(emu, /match \/xeroQueue\/\{id\}/);
  assert.match(rulesSlice(frag), /match \/tenants\/\{tenantId\}\/fleet\/\{assetId\}/);
  assert.match(rulesSlice(frag), /match \/tenants\/\{tenantId\}\/policies\/\{policyId\}/);
  assert.match(rulesSlice(frag), /allow read: if fleetMember\(tenantId\)/);
  assert.match(rulesSlice(frag), /allow read: if fleetAdmin\(tenantId\)/);
  assert.doesNotMatch(rulesSlice(frag), /match \/receipts\/|match \/xeroQueue\/|match \/jobs\/|SCHEDULING_APPROVED/);
  const storage = readFileSync(new URL("../emulator/storage.rules", import.meta.url), "utf8");
  assert.doesNotMatch(storage, /fleet|policies/);
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.match(app, /installCompliance/);
  assert.match(app, /NAV_TOP = \["home", "chat", "inbox", "clients"\]/);
  assert.match(app, /\["safety", "⚠", "Safety", \["safety", "swms", "compliance"\]\]/);
  assert.match(app, /<div class="mob-sec">Safety<\/div>/);
  assert.doesNotMatch(app, /NAV_TOP = \["home", "compliance"/);
  assert.match(app, /COMP\.adminBannerHtml\(\)/);
  assert.match(app, /COMP\.staffHtml\(\)/);
  assert.doesNotMatch(app, /SCHEDULING_APPROVED = true/);
  assert.equal(SCHEDULING_APPROVED, false);
  assert.doesNotMatch(readFileSync(new URL("../../app/features/compliance.js", import.meta.url), "utf8"), /YB49EZ|786HK5/);
  assert.doesNotMatch(readFileSync(new URL("../../tests/phone-preview.html", import.meta.url), "utf8"), /YB49EZ|786HK5/);
});
