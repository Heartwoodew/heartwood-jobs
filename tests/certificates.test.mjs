import test from "node:test";
import assert from "node:assert/strict";
import { buildCertificate, licenceNumbers, planCertificateEmail, templatesForTrades } from "../app/features/certificates.js";

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
  assert.equal(templatesForTrades(["cleaning"]).some(row => row.id === "pest-treatment"), false);
  assert.equal(templatesForTrades(["cleaning"]).some(row => row.id === "generic"), true);
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
