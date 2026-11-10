import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALLUP_SENDER, HEARTWOOD_CLIENTS, builderSignoff, clientDocId, companyClientNames, companyDetailPatch,
  companyJobPrefix, companyMailbox, companyStdClients, derivedJobPrefix, timesheetMailParts, validateCompanyExtras,
} from "../../app/features/company.js";
import { CALLUP_INVITE_FROM, buildInviteDraft, buildInviteEmail, inviteEmailConfig, inviteFailureText } from "../../app/features/staff-invites.js";

const HW = { companyId: "heartwood", name: "Heartwood Earthworx", signoff: "Heartwood Earthworx" };
const BRAVO = { companyId: "bravo", name: "Bravo Civil Pty Ltd", signoff: "Bravo Civil", phone: "07 3000 0000", email: "office@bravo.test", accountsName: "Nina Numbers" };

test("Heartwood keeps HW, its builder list, Nicole/Alex and Alex's sign-off", () => {
  assert.equal(companyJobPrefix(HW), "HW");
  assert.equal(companyJobPrefix({ ...HW, jobPrefix: "ZZ" }), "HW");
  assert.deepEqual(companyClientNames(HW, [{ name: "Someone Else" }]), [...HEARTWOOD_CLIENTS, "Private"]);
  assert.equal(clientDocId("heartwood", "Orbit Homes (Qld) Pty Ltd"), "orbit-homes-qld-pty-ltd");
  assert.deepEqual(timesheetMailParts(HW, "Patrick"), { greeting: "Hi Nicole,", sender: "Alex" });
  assert.deepEqual(builderSignoff(HW, "Patrick"), ["Alex Daly", "Heartwood Earthworx", "0499 802 812"]);
  assert.equal(companyMailbox(HW), "alex@heartwoodew.com");
});

test("other companies use their own prefix, clients, contacts and mailbox", () => {
  assert.equal(derivedJobPrefix("Bravo Civil Pty Ltd"), "BC");
  assert.equal(derivedJobPrefix("Bravo"), "BRA");
  assert.equal(derivedJobPrefix(""), "JOB");
  assert.equal(companyJobPrefix(BRAVO), "BC");
  assert.equal(companyJobPrefix({ ...BRAVO, jobPrefix: "brv" }), "BRV");
  assert.deepEqual(companyClientNames(BRAVO, []), ["Private"]);
  assert.deepEqual(companyStdClients(BRAVO, [{ name: "Zed Homes" }, { name: "Acme" }]), ["Acme", "Zed Homes"]);
  assert.equal(clientDocId("bravo", "Acme Homes"), "bravo_acme-homes");
  assert.deepEqual(timesheetMailParts(BRAVO, "Sam Boss"), { greeting: "Hi Nina,", sender: "Sam Boss" });
  assert.deepEqual(timesheetMailParts({ ...BRAVO, accountsName: "" }, "Sam Boss").greeting, "Hi,");
  assert.deepEqual(builderSignoff(BRAVO, "Sam Boss"), ["Sam Boss", "Bravo Civil", "07 3000 0000"]);
  assert.equal(companyMailbox(BRAVO), "office@bravo.test");
  assert.doesNotMatch([timesheetMailParts(BRAVO, "Sam").greeting, ...builderSignoff(BRAVO, "Sam")].join(" "), /Nicole|Alex|0499/);
  assert.match(CALLUP_SENDER, /callupapp\.com\.au/);
});

test("settings extras validate and only patch when given", () => {
  assert.deepEqual(validateCompanyExtras({ jobPrefix: "brv", accountsName: "Nina" }), { ok: true, value: { jobPrefix: "BRV", accountsName: "Nina" } });
  assert.equal(validateCompanyExtras({ jobPrefix: "B-V" }).reason, "jobPrefix");
  assert.equal(validateCompanyExtras({ accountsName: "<b>" }).reason, "accountsName");
  const cur = { name: "Bravo", legalName: "Bravo Pty Ltd", abn: "12 345 678 901", signoff: "Bravo", logoUrl: "", address: "1 B St", phone: "", email: "office@bravo.test", accountsEmail: "acc@bravo.test", hubdocAddress: "" };
  const none = companyDetailPatch(cur, { name: "Bravo" });
  assert.ok(none.ok); assert.ok(!("jobPrefix" in none.patch)); assert.ok(!("accountsName" in none.patch));
  const some = companyDetailPatch(cur, { jobPrefix: "brv", accountsName: "Nina" });
  assert.deepEqual({ jobPrefix: some.patch.jobPrefix, accountsName: some.patch.accountsName }, { jobPrefix: "BRV", accountsName: "Nina" });
});

test("invite email: Heartwood sender unchanged, others use the CallUp sender with reply-to the company", () => {
  const invite = buildInviteDraft({ name: "Casey", email: "casey@example.com", role: "operator", createdBy: "admin-1", now: new Date("2026-11-10T00:00:00Z"), token: "c".repeat(43), tenantId: "heartwood" }).invite;
  const hw = buildInviteEmail(invite, inviteEmailConfig({}));
  assert.equal(hw.from, "Heartwood Jobs <jobs@heartwoodew.com>");
  assert.equal(hw.replyTo, "alex@heartwoodew.com");
  assert.equal(hw.subject, "You're invited to Heartwood Jobs");
  const other = buildInviteEmail(invite, { ...inviteEmailConfig({}), companyName: "Bravo Civil", companyEmail: "office@bravo.test" });
  assert.equal(other.from, CALLUP_INVITE_FROM);
  assert.doesNotMatch(other.from, /heartwood/i);
  assert.equal(other.replyTo, "office@bravo.test");
  assert.equal(other.subject, "You're invited to Bravo Civil");
});

test("invite errors are plain English, not 'not deployed yet'", () => {
  for (const c of ["unavailable", "offline", "busy", "server-error"]) {
    assert.ok(inviteFailureText(c)); assert.doesNotMatch(inviteFailureText(c), /deploy/i);
  }
  const shared = readFileSync(new URL("../functions/shared/staff-invites.js", import.meta.url), "utf8");
  assert.equal(shared, readFileSync(new URL("../../app/features/staff-invites.js", import.meta.url), "utf8"));
});

test("sign-in page and manifest are generic CallUp", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const login = app.slice(app.indexOf("function renderLogin"), app.indexOf("function renderLogin") + 2500);
  assert.doesNotMatch(login, /Heartwood/);
  assert.doesNotMatch(readFileSync(new URL("../../app/manifest.webmanifest", import.meta.url), "utf8"), /Heartwood/);
});
