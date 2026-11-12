import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOGO_ACCEPT, LOGO_JPEG_QUALITY, LOGO_MAX_BYTES, LOGO_MAX_EDGE, acceptLogoValue,
  isLogoStoragePath, logoFailureText, logoFileOk, logoStoragePath, logoUploadPlan,
} from "../../app/features/company-logo.js";
import { companySettingsHtml, failureText, logoFieldHtml, signupFormHtml } from "../../app/features/company-ui.js";
import { companyDetailPatch, safeLogo, validateCompanyInput } from "../../app/features/company.js";

const BASE = {
  name: "Acme Civil", legalName: "Acme Civil Pty Ltd", abn: "12 345 678 901",
  address: "1 Yard St", phone: "", email: "office@acme.test", accountsEmail: "accounts@acme.test",
  hubdocAddress: "", logoUrl: "", signoff: "Acme", companyId: "acme-1",
};

test("logo path is company-scoped and existing http(s) or icons values still work", () => {
  assert.equal(logoStoragePath("acme-1"), "companies/acme-1/logo/logo.jpg");
  assert.equal(logoStoragePath("ACME-1"), "companies/acme-1/logo/logo.jpg");
  assert.equal(logoStoragePath("bad path"), "");
  assert.equal(isLogoStoragePath("companies/acme-1/logo/logo.jpg", "acme-1"), true);
  assert.equal(isLogoStoragePath("companies/other/logo/logo.jpg", "acme-1"), false);
  assert.equal(acceptLogoValue("https://cdn.example/logo.png"), "https://cdn.example/logo.png");
  assert.equal(acceptLogoValue("icons/callup-wordmark.svg"), "icons/callup-wordmark.svg");
  assert.equal(acceptLogoValue("companies/acme-1/logo/logo.jpg", "acme-1"), "companies/acme-1/logo/logo.jpg");
  assert.equal(acceptLogoValue("companies/other/logo/logo.jpg", "acme-1"), "");
  assert.equal(acceptLogoValue("tenants/heartwood/logo.png"), "");
  assert.equal(acceptLogoValue("javascript:alert(1)"), "");
  assert.equal(safeLogo("companies/acme-1/logo/logo.jpg", "acme-1"), "companies/acme-1/logo/logo.jpg");
  assert.equal(LOGO_MAX_EDGE, 512);
  assert.equal(LOGO_JPEG_QUALITY, 0.85);
  assert.equal(LOGO_MAX_BYTES, 2 * 1024 * 1024);
  assert.match(LOGO_ACCEPT, /image\/jpeg/);
  assert.match(LOGO_ACCEPT, /image\/png/);
});

test("logo file checks accept jpeg or png and reject other types or huge sources", () => {
  assert.equal(logoFileOk({ name: "logo.jpg", type: "image/jpeg", size: 120_000 }).ok, true);
  assert.equal(logoFileOk({ name: "logo.PNG", type: "image/png", size: 80_000 }).ok, true);
  assert.equal(logoFileOk({ name: "logo.jpg", type: "", size: 80_000 }).ok, true);
  assert.equal(logoFileOk({ name: "logo.gif", type: "image/gif", size: 80_000 }).reason, "type");
  assert.equal(logoFileOk({ name: "logo.jpg", type: "image/jpeg", size: 0 }).reason, "size");
  assert.equal(logoFileOk({ name: "logo.jpg", type: "image/jpeg", size: 21 * 1024 * 1024 }).reason, "size");
  assert.deepEqual(logoUploadPlan("acme-1", "owner-1"), {
    ok: true,
    path: "companies/acme-1/logo/logo.jpg",
    contentType: "image/jpeg",
    metadata: { purpose: "company-logo", uploaderUid: "owner-1", companyId: "acme-1" },
  });
  assert.equal(logoUploadPlan("", "owner-1").ok, false);
  assert.match(logoFailureText("type"), /JPEG or PNG/);
});

test("company details can store a Storage path and still accept a previous https logo", () => {
  const path = "companies/acme-1/logo/logo.jpg";
  const uploaded = validateCompanyInput({ ...BASE, logoUrl: path });
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.value.logoUrl, path);
  const patched = companyDetailPatch({ ...BASE, logoUrl: "https://cdn.example/old.png" }, { logoUrl: path });
  assert.equal(patched.ok, true);
  assert.equal(patched.patch.logoUrl, path);
  const kept = companyDetailPatch({ ...BASE, logoUrl: "https://cdn.example/old.png" }, { name: "Acme Civil" });
  assert.equal(kept.ok, true);
  assert.equal("logoUrl" in kept.patch, false);
  const cleared = companyDetailPatch({ ...BASE, logoUrl: path }, { logoUrl: "" });
  assert.equal(cleared.patch.logoUrl, "");
  assert.equal(validateCompanyInput({ ...BASE, logoUrl: "javascript:alert(1)" }).reason, "logo");
});

test("settings and signup replace the Logo URL box with a jpeg/png upload, preview, and Remove", () => {
  const settings = companySettingsHtml({ ...BASE, logoUrl: "https://cdn.example/old.png" }, { canEdit: true });
  assert.doesNotMatch(settings, /Logo URL/);
  assert.match(settings, /type="file"/);
  assert.match(settings, /name="logoFile"/);
  assert.match(settings, /accept="image\/jpeg,image\/png/);
  assert.match(settings, /orglogo-preview/);
  assert.match(settings, /https:\/\/cdn\.example\/old\.png/);
  assert.match(settings, /id="logoremove"/);
  assert.match(settings, /Remove logo/);
  const locked = companySettingsHtml({ ...BASE, logoUrl: "" }, { canEdit: false });
  assert.match(locked, /disabled/);
  assert.doesNotMatch(locked, /id="logoremove"/);
  const stored = logoFieldHtml({ ...BASE, logoUrl: "companies/acme-1/logo/logo.jpg" }, { canEdit: true });
  assert.match(stored, /data-logo-path="companies\/acme-1\/logo\/logo.jpg"/);
  const signup = signupFormHtml({});
  assert.doesNotMatch(signup, /Logo URL/);
  assert.match(signup, /name="logoFile"/);
  assert.match(signup, /accept="image\/jpeg,image\/png/);
  assert.equal(failureText("logo"), "Use a JPEG or PNG photo or file.");
});

test("service worker caches the logo module and the bumped shell version", () => {
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v96-tester-feedback/);
  assert.match(sw, /features\/company-logo\.js/);
});
