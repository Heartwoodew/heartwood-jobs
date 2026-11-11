import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_ORG, orgSettings, setActiveCompany } from "../../app/org-settings.js";
import { parseMigrateArgs, LIVE_PROJECT } from "../scripts/migrate-company-id.mjs";
import {
  HEARTWOOD_ACCOUNTS_EMAIL, HEARTWOOD_COMPANY_ID, TRIAL_DAYS, billingHook, buildCompanyCreate,
  companyDetailPatch, docCompanyId, filterMaster, heartwoodSeed, hoursBrand, isPlatformOwner,
  masterRow, masterTotals, planCompanyField, scopeRecord, trialEnd, validateCompanyInput,
} from "../../app/features/company.js";
import { locationConsent, TS_CONSENT } from "../../app/features/timesheet.js";
import { profileFromInvite } from "../../app/features/staff-invites.js";
import { ACCOUNTS_TO, exportFileName, reportSheets, buildHoursReport } from "../../app/features/hours-export.js";

test("Heartwood defaults and hours copy stay the same until a company is loaded", () => {
  setActiveCompany(null);
  const org = orgSettings();
  assert.equal(org.name, "Heartwood Earthworx");
  assert.equal(org.legalName, DEFAULT_ORG.legalName);
  assert.equal(org.abn, "31 667 738 098");
  assert.equal(org.accountsEmail, HEARTWOOD_ACCOUNTS_EMAIL);
  assert.equal(ACCOUNTS_TO, "accounts@heartwoodew.com");
  const brand = hoursBrand(org);
  assert.equal(brand.accountsEmail, "accounts@heartwoodew.com");
  assert.equal(brand.subjectName, "Heartwood");
  assert.equal(brand.titleName, "Heartwood Earthworx");
  assert.equal(exportFileName(brand.fileName, "2026-11-02"), "Heartwood_Earthworx_hours_2026-11-02_to_2026-11-08.xlsx");
  const rep = buildHoursReport({ weekStart: "2026-11-02", people: [{ uid: "u", name: "Sam" }], sheets: [] });
  const xml = reportSheets(rep, { company: brand.titleName, generated: new Date("2026-11-08T06:00:00Z") })[0].xml;
  assert.match(xml, /Heartwood Earthworx · Timesheet hours/);
  assert.equal(locationConsent(org.name), TS_CONSENT);
  assert.match(locationConsent("Acme Civil"), /Acme Civil does not track/);
  assert.doesNotMatch(locationConsent("Acme Civil"), /Heartwood does not track/);
});

test("another company replaces the Heartwood name but does not become platform owner", () => {
  const input = validateCompanyInput({
    name: "Acme Civil", legalName: "Acme Civil Pty Ltd", abn: "12 345 678 901",
    address: "1 Yard St, Brisbane", phone: "0400 000 001", email: "office@acme.test",
    accountsEmail: "accounts@acme.test", hubdocAddress: "", logoUrl: "",
  });
  assert.equal(input.ok, true);
  const end = trialEnd(new Date("2026-11-08T00:00:00Z"));
  assert.equal((end - new Date("2026-11-08T00:00:00Z")) / 86400000, TRIAL_DAYS);
  const created = buildCompanyCreate(input.value, {
    companyId: "acme-1", ownerUid: "owner", signedUpAt: "server", trialEndsAt: end, lastActivityAt: "server",
  });
  assert.equal(created.plan, "trial");
  assert.equal(created.billing.provider, null);
  assert.deepEqual(created.billing, billingHook());
  setActiveCompany({ ...created, companyId: "acme-1" });
  const org = orgSettings();
  assert.equal(org.name, "Acme Civil");
  assert.equal(org.abn, "12 345 678 901");
  assert.equal(hoursBrand(org).accountsEmail, "accounts@acme.test");
  assert.equal(hoursBrand(org).subjectName, "Acme Civil");
  setActiveCompany(null);
  assert.equal(isPlatformOwner({ uid: "someone", email: "ari@acme.test", emailVerified: true, claims: { platformOwner: true } }), false);
  assert.equal(isPlatformOwner({ uid: "1JKLsoxkQNfkphBBO0vDz2ziEyj2", email: "alex@heartwoodew.com", emailVerified: false, claims: {} }), false);
  assert.equal(isPlatformOwner({ uid: "1JKLsoxkQNfkphBBO0vDz2ziEyj2", email: "alex@heartwoodew.com", emailVerified: true, claims: {} }), true);
});

test("master rows are account-level and totals ignore job text", () => {
  const now = new Date("2026-11-08T00:00:00Z");
  const trial = masterRow("acme", {
    name: "Acme Civil", abn: "12 345 678 901", email: "office@acme.test", phone: "0400",
    signedUpAt: "2026-11-01T00:00:00Z", trialEndsAt: "2026-11-15T00:00:00Z",
    plan: "trial", status: "active", staffCount: 2, jobCount: 4, lastActivityAt: "2026-11-07T00:00:00Z",
    client: "should not be copied", invoiceAmount: 500,
  }, now);
  assert.equal(trial.trialActive, true);
  assert.equal(trial.client, undefined);
  assert.equal(trial.invoiceAmount, undefined);
  const paid = masterRow("heartwood", { ...heartwoodSeed(now), name: "Heartwood Earthworx", plan: "paid", status: "active", staffCount: 5, jobCount: 10 }, now);
  const suspended = masterRow("old", { name: "Old Co", plan: "trial", status: "suspended", trialEndsAt: "2026-11-20T00:00:00Z", staffCount: 1, jobCount: 0, email: "a@old.test", abn: "1" }, now);
  const totals = masterTotals([trial, paid, suspended]);
  assert.deepEqual(totals, { companies: 3, activeTrials: 1, paying: 1, friends: 0, staff: 8 });
  const testCo = masterRow("yard", { name: "Yard", isTest: true, plan: "trial", status: "active", staffCount: 9, jobCount: 2, trialEndsAt: "2026-12-01T00:00:00Z", billing: { status: "not-configured" } }, now);
  const friend = masterRow("mate", { name: "Mate Co", plan: "friend", status: "active", staffCount: 2, jobCount: 1, friendEndsAt: null, billing: { status: "not-configured" } }, now);
  const billed = masterRow("paidco", { name: "Paid Co", plan: "paid", status: "active", staffCount: 1, billing: { provider: "stripe", status: "active", stripeCustomerId: "cus_test" } }, now);
  assert.equal(testCo.planLabel, "Test");
  assert.equal(testCo.billingStatus, "Not billed");
  assert.equal(friend.planLabel, "Friend");
  assert.equal(friend.billingStatus, "Not billed");
  assert.equal(billed.billingStatus, "Active");
  assert.equal(billed.stripeCustomerId, undefined);
  const withExtras = masterTotals([trial, paid, suspended, testCo, friend, billed]);
  assert.deepEqual(withExtras, { companies: 6, activeTrials: 1, paying: 2, friends: 1, staff: 11 });
  assert.equal(filterMaster([trial, paid, suspended], { q: "acme", status: "active", plan: "trial" }).length, 1);
  assert.equal(filterMaster([trial, paid], { plan: "paid" })[0].id, "heartwood");
});

test("migration only adds a missing companyId and never replaces one", () => {
  assert.deepEqual(planCompanyField({ client: "Orbit", note: "keep" }, ""), { action: "add", companyId: HEARTWOOD_COMPANY_ID, field: "companyId" });
  assert.deepEqual(planCompanyField({ tenantId: "otherco" }, ""), { action: "add", companyId: "otherco", field: "companyId" });
  assert.deepEqual(planCompanyField({ companyId: "acme", name: "Acme" }, "heartwood"), { action: "keep", companyId: "acme" });
  assert.equal(docCompanyId({}), "heartwood");
  assert.equal(scopeRecord({ client: "Orbit" }, "heartwood").tenantId, undefined);
  assert.equal(scopeRecord({ client: "Orbit" }, "acme").companyId, "acme");
  const invite = { name: "Casey Nguyen", role: "operator", email: "casey.nguyen@example.com", tenantId: "heartwood", token: "a".repeat(43) };
  assert.deepEqual(profileFromInvite(invite), { name: "Casey Nguyen", role: "operator", email: "casey.nguyen@example.com", companyId: "heartwood" });
  const patch = companyDetailPatch({ name: "Acme Civil", legalName: "Acme Civil Pty Ltd", abn: "12 345 678 901", address: "1 Yard St", email: "office@acme.test", accountsEmail: "accounts@acme.test", signoff: "Acme", phone: "", hubdocAddress: "", logoUrl: "" }, { phone: "0400111222" });
  assert.equal(patch.ok, true);
  assert.deepEqual(patch.patch, { phone: "0400111222" });
});

test("production migration is explicit, dry-run by default, and add-only in its flags", () => {
  const emu = parseMigrateArgs(["node", "migrate-company-id.mjs"], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
  assert.equal(emu.ok, true);
  assert.equal(emu.commit, false);
  assert.equal(emu.live, false);
  assert.equal(emu.mode, "dry-run");
  const liveDry = parseMigrateArgs(["node", "migrate-company-id.mjs", "--project", LIVE_PROJECT], {});
  assert.equal(liveDry.ok, true);
  assert.equal(liveDry.commit, false);
  assert.equal(liveDry.live, true);
  const liveWrite = parseMigrateArgs(["node", "migrate-company-id.mjs", "--project", LIVE_PROJECT, "--commit"], {});
  assert.equal(liveWrite.ok, true);
  assert.equal(liveWrite.commit, true);
  assert.equal(liveWrite.mode, "commit");
  assert.equal(parseMigrateArgs(["node", "migrate-company-id.mjs", "--project", LIVE_PROJECT, "--commit"], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }).ok, false);
  assert.equal(parseMigrateArgs(["node", "migrate-company-id.mjs"], {}).reason, "emulator-required");
  assert.equal(parseMigrateArgs(["node", "migrate-company-id.mjs"], { GCLOUD_PROJECT: LIVE_PROJECT }).reason, "explicit-project");
});

test("mail tools do not send for a test company and still send for Heartwood", () => {
  const script = `
import sys
sys.path.insert(0, "tools")
from company_scope import hours_recipient, hubdoc_for, xero_accounts
ok, to, name = hours_recipient({"to": "accounts@heartwoodew.com", "companyId": "heartwood"})
assert ok and to == "accounts@heartwoodew.com" and name == "Heartwood", (ok, to, name)
ok, to, name = hours_recipient({"to": "preview@example.com", "isTest": True, "companyId": "yard", "status": "queued"})
assert ok is False and to == "" and name == ""
hub, label = hubdoc_for({"companyId": "yard", "isTest": True}, {"isTest": True, "hubdocAddress": "yard@app.hubdoc.com"}, "heartwood@app.hubdoc.com")
assert hub == "" and label == "Test"
hub, label = hubdoc_for({"companyId": "heartwood"}, None, "heartwood@app.hubdoc.com")
assert hub == "heartwood@app.hubdoc.com" and label == "Heartwood"
row = xero_accounts({"companyId": "yard"}, {"isTest": True, "accountsEmail": "accounts@yard.test"})
assert row["send"] is False and row["reason"] == "test-company-no-send"
print("ok")
`;
  const out = execFileSync("python3", ["-c", script], { cwd: fileURLToPath(new URL("../..", import.meta.url)), encoding: "utf8" });
  assert.match(out, /ok/);
});
