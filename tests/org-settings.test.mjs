import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ORG, PRODUCT_NAME, POWERED_BY, orgSettings, safeLogo } from "../app/org-settings.js";

test("CallUp stays the product and Heartwood Earthworx stays the default organisation", () => {
  assert.equal(PRODUCT_NAME, "CallUp");
  assert.equal(POWERED_BY, "Powered by CallUp");
  assert.equal(DEFAULT_ORG.name, "Heartwood Earthworx");
  assert.equal(DEFAULT_ORG.legalName, "Heartwood Earthworx Pty Ltd");
  assert.equal(DEFAULT_ORG.abn, "31 667 738 098");
  assert.equal(DEFAULT_ORG.signoff, "Heartwood Earthworx");
  const org = orgSettings();
  assert.equal(org.legalName, DEFAULT_ORG.legalName);
  assert.equal(org.logoUrl, "");
});

test("organisation logo accepts an https URL or an icons path", () => {
  assert.equal(safeLogo("https://cdn.example/logo.png"), "https://cdn.example/logo.png");
  assert.equal(safeLogo("icons/callup-wordmark.svg"), "icons/callup-wordmark.svg");
  assert.equal(safeLogo("javascript:alert(1)"), "");
  assert.equal(safeLogo("tenants/heartwood/logo.png"), "");
});
