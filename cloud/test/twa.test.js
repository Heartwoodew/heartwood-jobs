import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("web manifest is ready for the Android Trusted Web Activity", () => {
  const m = JSON.parse(read("app/manifest.webmanifest"));
  assert.equal(m.name, "CallUp");
  assert.equal(m.start_url, "/app/");
  assert.equal(m.scope, "/app/");
  assert.equal(m.display, "standalone");
  const has = (size, purpose) => m.icons.some((i) => i.sizes === size && i.purpose.split(" ").includes(purpose));
  for (const size of ["192x192", "512x512"]) {
    assert.ok(has(size, "any"), `any ${size}`);
    assert.ok(has(size, "maskable"), `maskable ${size}`);
  }
  for (const icon of m.icons) assert.ok(fs.existsSync(path.join(root, "app", icon.src)), icon.src);
  const sw = read("app/sw.js");
  assert.match(sw, /icons\/icon-maskable-512\.png/);
  assert.match(sw, /addEventListener\("fetch"/);
});

test("assetlinks.json delegates to com.callupapp.app and is served by the callupapp hosting build", () => {
  const links = JSON.parse(read("cloud/android/assetlinks.json"));
  const entry = links.find((l) => l.target.package_name === "com.callupapp.app");
  assert.ok(entry);
  assert.deepEqual(entry.relation, ["delegate_permission/common.handle_all_urls"]);
  assert.equal(entry.target.namespace, "android_app");
  for (const fp of entry.target.sha256_cert_fingerprints) assert.match(fp, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.match(read("tools/build-callup-hosting.sh"), /\.well-known\/assetlinks\.json/);
  const hosting = JSON.parse(read("cloud/firebase.hosting.json")).hosting;
  assert.equal(hosting.appAssociation, "NONE");
  assert.equal(hosting.ignore, undefined, "a hosting ignore list could drop the .well-known folder");
  const h = hosting.headers.find((x) => x.source === "/.well-known/assetlinks.json");
  assert.ok(h.headers.some((x) => x.key === "Content-Type" && x.value === "application/json"));
});
