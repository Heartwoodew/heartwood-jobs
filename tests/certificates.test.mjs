import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCertificate, certificatePanelHtml, certificatesEnabled, licenceNumbers, planCertificateEmail, templatesForTrades, tradeIdsFromCompany } from "../app/features/certificates.js";
import { sendCertificateWork } from "../cloud/functions/certificate-email.js";

const bright = { name: "Bright Pest", legalName: "Bright Pest Pty Ltd", abn: "51 824 753 556", phone: "07 3000 0000", email: "office@bright.test", address: "12 Creek Rd, Brisbane" };
const other = { name: "Other Co", legalName: "Other Co Pty Ltd" };

test("licence numbers come from the worker's licence tags", () => {
  assert.deepEqual(licenceNumbers(["White card", "Licence: PMT-12345", "HR licence"]), ["PMT-12345"]);
  assert.deepEqual(licenceNumbers(["QBCC 1234567"]), ["QBCC 1234567"]);
});

test("a pest certificate PDF uses this company's branding and not another company's", () => {
  const built = buildCertificate({
    company: bright,
    templateId: "pest-treatment",
    raw: { chemical: "Bifenthrin", rate: "1 L / 100 m2", areas: "Kitchen and eaves", technician: "Ari Patel", date: "2026-11-23" },
    skills: ["Licence: PMT-12345"],
    job: { client: "Strata Plan 9", address: "4 Garden Ave" },
  });
  assert.equal(built.ok, true);
  assert.equal(built.values.licence, "PMT-12345");
  assert.equal(built.visibility, "crew");
  const text = built.pdf.text;
  assert.match(text, /Bright Pest Pty Ltd/);
  assert.match(text, /Bifenthrin/);
  assert.match(text, /PMT-12345/);
  assert.match(text, /4 Garden Ave/);
  assert.doesNotMatch(text, /Other Co/);
  assert.equal(templatesForTrades(["pest-control"]).some(row => row.id === "termite-inspection"), true);
  assert.equal(templatesForTrades(["pest-control"]).some(row => row.id === "generic"), true);
  assert.equal(templatesForTrades(["cleaning"]).some(row => row.id === "pest-treatment"), false);
  assert.equal(templatesForTrades(["cleaning"]).length, 0);
  assert.equal(templatesForTrades(["earthworks"]).length, 0);
  assert.equal(certificatesEnabled(["earthworks", "cleaning"]), false);
  assert.equal(certificatesEnabled(tradeIdsFromCompany({ name: "Heartwood" }, null)), false);
  assert.equal(certificatesEnabled(tradeIdsFromCompany({ trades: ["earthworks"] }, { trades: ["earthworks", "pest-control"] })), true);
  const generic = buildCertificate({ company: other, templateId: "generic", raw: { title: "Completion", details: "Done", technician: "Jo", licence: "L1", date: "2026-11-23" }, job: {} });
  assert.match(generic.pdf.text, /Other Co Pty Ltd/);
  assert.doesNotMatch(generic.pdf.text, /Bright Pest/);
});

test("certificate email is held unless the test address is allowed", () => {
  const pdf = Buffer.from("%PDF-1.4").toString("base64");
  const held = planCertificateEmail({ to: "callup932+cert@gmail.com", company: bright, job: { address: "4 Garden Ave" }, fileName: "Pest treatment certificate.pdf", pdfBase64: pdf, env: {}, allowLiveMail: false });
  assert.equal(held.held, true);
  assert.equal(held.payload.attachments[0].filename.includes("Pest"), true);
  const blocked = planCertificateEmail({
    to: "customer@example.com", company: bright, job: {}, fileName: "c.pdf", pdfBase64: pdf,
    env: { INVITE_EMAIL_ENABLED: "true", INVITE_EMAIL_ALLOW_TO: "callup932+" }, allowLiveMail: true,
  });
  assert.equal(blocked.reason, "allow-list");
  const allowed = planCertificateEmail({
    to: "callup932+cert@gmail.com", company: bright, job: { address: "4 Garden Ave" }, fileName: "c.pdf", pdfBase64: pdf,
    env: { INVITE_EMAIL_ENABLED: "true", INVITE_EMAIL_ALLOW_TO: "callup932+" }, allowLiveMail: true,
  });
  assert.equal(allowed.held, false);
  assert.match(allowed.payload.from, /noreply@callupapp.com.au/);
  assert.equal(allowed.payload.to[0], "callup932+cert@gmail.com");
});

const heartwoodJob = { id: "HW-9233", type: "clean", client: "Torsion", address: "Torsion site" };

test("the certificate panel is only on a pest control company", () => {
  assert.equal(certificatePanelHtml(heartwoodJob, { trades: ["earthworks"], skills: ["Licence: PMT-12345"], canEmail: true }), "");
  assert.equal(certificatePanelHtml(heartwoodJob, { trades: ["cleaning"], canEmail: true }), "");
  const pest = certificatePanelHtml(heartwoodJob, { trades: ["pest-control"], skills: ["Licence: PMT-12345"], canEmail: true });
  assert.match(pest, /id="certsave"/);
  assert.match(pest, /id="certemail"/);
  assert.match(pest, /Pest treatment certificate/);
  const mixed = certificatePanelHtml(heartwoodJob, { trades: ["earthworks", "pest-control"], canEmail: false });
  assert.match(mixed, /id="certsave"/);
  assert.doesNotMatch(mixed, /id="certemail"/);
});

function emailDeps(company, stored, { companyId = "heartwood", send } = {}) {
  return {
    env: {},
    allowLiveMail: false,
    job: heartwoodJob,
    loadProfile: async () => ({ role: "admin", companyId }),
    loadCompany: async () => company,
    loadTrades: async () => stored,
    send: send || (async () => { throw new Error("mail should not leave the test"); }),
  };
}

test("sendCertificateEmail rejects Heartwood and any company that is not pest control", async () => {
  const pdf = Buffer.from("%PDF-1.4").toString("base64");
  const args = { uid: "admin1", to: "callup932+cert@gmail.com", fileName: "Pest treatment certificate.pdf", pdfBase64: pdf, companyId: "heartwood" };
  const heartwood = await sendCertificateWork(args, emailDeps(
    { name: "Heartwood", companyId: "heartwood", trade: "earthworks", trades: ["earthworks"] },
    { trades: ["earthworks"], checklists: [{ id: "ew-clean-arrive", label: "Walk the site and note what is in the way" }] },
  ));
  assert.equal(heartwood.ok, false);
  assert.equal(heartwood.code, "failed-precondition");
  assert.match(heartwood.message, /pest control/i);

  const bare = await sendCertificateWork(args, emailDeps({ name: "Heartwood", companyId: "heartwood" }, null));
  assert.equal(bare.ok, false);

  const cleaning = await sendCertificateWork(
    { ...args, companyId: "clean-co" },
    emailDeps({ name: "Clean Co", companyId: "clean-co", trades: ["cleaning"] }, { trades: ["cleaning"] }, { companyId: "clean-co" }),
  );
  assert.equal(cleaning.ok, false);

  let sent = false;
  const pest = await sendCertificateWork(
    { ...args, companyId: "bright" },
    emailDeps(
      { name: "Bright Pest", companyId: "bright", trades: ["pest-control"], email: "office@bright.test" },
      { trades: ["pest-control"], checklists: [{ id: "pc-id", label: "Identify the pest and the areas" }] },
      { companyId: "bright", send: async () => { sent = true; return { ok: true }; } },
    ),
  );
  assert.equal(pest.ok, true);
  assert.equal(pest.held, true);
  assert.equal(sent, false);

  const catalogOnly = await sendCertificateWork(
    { ...args, companyId: "mix" },
    emailDeps(
      { name: "Mix", companyId: "mix", trades: ["earthworks"] },
      { trades: ["earthworks", "pest-control"] },
      { companyId: "mix" },
    ),
  );
  assert.equal(catalogOnly.ok, true);
  assert.equal(catalogOnly.held, true);
});

test("the job modal still quotes and repeats, and only a pest company can open sendCertificateEmail", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  const modal = app.slice(app.indexOf("function editJob"), app.indexOf("function jobTabs"));
  assert.match(modal, /repeatFieldHtml\(j/);
  assert.match(modal, /id="quotethis"/);
  assert.match(modal, /certificatesEnabled\(certificateTrades\(\)\)/);
  assert.match(modal, /<h4>Photos<\/h4>/);
  assert.match(app, /\["details", "Details"\], \["chat", "Chat"\], \["photos", "Photos"\]/);
  const wire = app.slice(app.indexOf("function wireCertificate"), app.indexOf("function editJob"));
  assert.match(wire, /if \(!certificatesEnabled\(certificateTrades\(\)\)\) return;/);
  assert.match(wire, /callCompanyFunction\("sendCertificateEmail"/);
  assert.match(wire, /Certificates are only for pest control/);
  const fn = readFileSync(new URL("../cloud/functions/certificate-email.js", import.meta.url), "utf8");
  assert.match(fn, /certificatesEnabled\(tradeIdsFromCompany\(company, stored\)\)/);
  assert.match(fn, /Certificates are only for pest control/);
});
