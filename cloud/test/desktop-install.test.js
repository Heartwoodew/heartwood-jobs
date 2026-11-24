import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WINDOWS_DOWNLOAD_URL, desktopInstallHtml, desktopInstallModel, readDesktopEnv, safeDownloadUrl, startDesktopInstall,
} from "../../app/features/desktop-install.js";
import { pickDashboardBanner } from "../../app/features/dashboard-banners.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const desktopChrome = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  platform: "Win32",
  maxTouchPoints: 0,
};

test("the Windows download link points at the signed v0.1.0 installer", () => {
  assert.equal(WINDOWS_DOWNLOAD_URL, "https://github.com/Heartwoodew/heartwood-jobs/releases/download/desktop-v0.1.0/CallUp_0.1.0_x64-setup.exe");
  assert.equal(safeDownloadUrl(WINDOWS_DOWNLOAD_URL), WINDOWS_DOWNLOAD_URL);
});

test("the Windows download link is hidden until an https URL is set", () => {

  assert.equal(safeDownloadUrl(""), "");
  assert.equal(safeDownloadUrl("http://example.com/CallUp.exe"), "");
  assert.equal(safeDownloadUrl("javascript:alert(1)"), "");
  assert.equal(safeDownloadUrl("https://user:pass@example.com/file"), "");
  const model = desktopInstallModel({ env: desktopChrome, promptReady: false, downloadUrl: "" });
  assert.equal(model.show, false);
  const linked = desktopInstallModel({
    env: desktopChrome,
    promptReady: false,
    downloadUrl: "https://github.com/Heartwoodew/heartwood-jobs/releases/latest",
  });
  assert.equal(linked.show, true);
  assert.equal(linked.install, false);
  assert.match(linked.downloadHref, /^https:\/\/github\.com\/Heartwoodew\/heartwood-jobs\/releases\/latest$/);
  const html = desktopInstallHtml(linked);
  assert.match(html, /Download for Windows/);
  assert.doesNotMatch(html, /Install on this PC/);
  assert.match(html, /target="_blank"/);
});

test("Install on this PC is offered on a desktop browser when Chrome asks, and nowhere else", () => {
  const ready = desktopInstallModel({ env: desktopChrome, promptReady: true, downloadUrl: "" });
  assert.equal(ready.show, true);
  assert.equal(ready.install, true);
  assert.match(desktopInstallHtml(ready), /Install on this PC/);
  assert.doesNotMatch(desktopInstallHtml(ready), /Download for Windows/);

  const phone = desktopInstallModel({
    env: { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile", platform: "Linux", maxTouchPoints: 5 },
    promptReady: true,
    downloadUrl: "https://example.com/CallUp.exe",
  });
  assert.equal(phone.show, false);
  const ipad = readDesktopEnv({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 });
  assert.equal(ipad.desktopBrowser, false);
  const installed = desktopInstallModel({ env: { ...desktopChrome, displayMode: "standalone" }, promptReady: true, downloadUrl: "https://example.com/a" });
  assert.equal(installed.show, false);
  const program = desktopInstallModel({ env: { ...desktopChrome, tauri: true }, promptReady: true, downloadUrl: "https://example.com/a" });
  assert.equal(program.show, false);
});

test("the download address is escaped and a nasty query cannot break out of the link", () => {
  const html = desktopInstallHtml(desktopInstallModel({
    env: desktopChrome,
    downloadUrl: "https://example.com/CallUp.exe?q=%22%3E%3Cscript%3E",
  }));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /href="https:\/\/example\.com\/CallUp\.exe\?q=/);
});

test("a phone keeps the browser install prompt, and the Windows program swallows it", () => {
  function fire(win) {
    const host = { hidden: true, innerHTML: "", querySelector() { return null; } };
    const listeners = {};
    win.addEventListener = (type, fn) => { listeners[type] = fn; };
    win.sessionStorage = { getItem() { return null; }, setItem() {} };
    startDesktopInstall({ getElementById: () => host }, win);
    let prevented = false;
    listeners.beforeinstallprompt({ preventDefault() { prevented = true; } });
    return { host, prevented };
  }
  const phone = fire({
    navigator: { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile", platform: "Linux", maxTouchPoints: 5 },
  });
  assert.equal(phone.prevented, false);
  assert.equal(phone.host.hidden, true);
  const program = fire({ navigator: desktopChrome, __CALLUP_DESKTOP__: true });
  assert.equal(program.prevented, true);
  assert.equal(program.host.hidden, true);
});

test("startDesktopInstall shows Download for Windows at once and adds Install on this PC after beforeinstallprompt", () => {
  const host = { hidden: true, innerHTML: "", querySelector() { return null; } };
  const listeners = {};
  const win = {
    navigator: desktopChrome,
    sessionStorage: { getItem() { return null; }, setItem() {} },
    addEventListener(type, fn) { listeners[type] = fn; },
  };
  startDesktopInstall({ getElementById: () => host }, win);
  assert.equal(host.hidden, false);
  assert.match(host.innerHTML, /Download for Windows/);
  assert.doesNotMatch(host.innerHTML, /Install on this PC/);
  let prevented = false;
  listeners.beforeinstallprompt({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(host.hidden, false);
  assert.match(host.innerHTML, /Install on this PC/);
});

test("the manifest can be installed on a desktop, and the shell is callup-shell-v154-last-seen", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "app/manifest.webmanifest"), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/app/");
  assert.ok(manifest.display_override.includes("standalone"));
  assert.equal(manifest.launch_handler.client_mode, "navigate-existing");
  const sizes = manifest.icons.map(icon => icon.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
  const sw = readFileSync(join(ROOT, "app/sw.js"), "utf8");
  assert.match(sw, /callup-shell-v154-last-seen/);
  assert.match(sw, /features\/desktop-install\.js/);
  const app = readFileSync(join(ROOT, "app/app.js"), "utf8");
  assert.match(app, /startDesktopInstall/);
});

test("the dashboard shows one banner, trial first, then notifications, then Windows", () => {
  assert.equal(pickDashboardBanner({ trial: true, notifications: true, windows: true }), "trial");
  assert.equal(pickDashboardBanner({ expired: true, notifications: true, windows: true }), "trial");
  assert.equal(pickDashboardBanner({ trial: false, notifications: true, windows: true }), "notifications");
  assert.equal(pickDashboardBanner({ notifications: false, windows: true }), "windows");
  assert.equal(pickDashboardBanner({}), "");
  const app = readFileSync(join(ROOT, "app/app.js"), "utf8");
  assert.match(app, /pickDashboardBanner/);
  assert.match(app, /bannerSlotHtml\(\)/);
  assert.doesNotMatch(app, /trialBannerNow\(\)\$\{PUSH\.bannerHtml\(\)\}/);
});

test("the Windows workflow builds both installers and only drafts a release for a desktop-v tag", () => {
  const yml = readFileSync(join(ROOT, ".github/workflows/desktop-windows.yml"), "utf8");
  assert.match(yml, /windows-latest/);
  assert.match(yml, /desktop-v\*/);
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /releaseDraft: true/);
  assert.match(yml, /--bundles nsis,msi/);
  assert.match(yml, /actions\/upload-artifact@v4/);
  assert.match(yml, /callup-windows/);
  assert.match(yml, /bundle\/nsis\/\*\.exe/);
  assert.match(yml, /bundle\/msi\/\*\.msi/);
  assert.match(yml, /tagName: \$\{\{ github\.ref_type == 'tag'/);
  assert.doesNotMatch(yml, /releaseDraft:\s*false/);
  const conf = JSON.parse(readFileSync(join(ROOT, "desktop/src-tauri/tauri.conf.json"), "utf8"));
  assert.equal(conf.productName, "CallUp");
  assert.equal(conf.identifier, "com.callupapp.desktop");
  assert.equal(conf.bundle.publisher, "Heartwood Earthworx Pty Ltd");
  assert.equal(conf.bundle.createUpdaterArtifacts, false);
  assert.deepEqual(conf.bundle.targets, ["nsis", "msi"]);
  assert.match(conf.plugins.updater.endpoints[0], /Heartwoodew\/heartwood-jobs\/releases\/latest\/download\/latest\.json$/);
  assert.match(readFileSync(join(ROOT, "desktop/src-tauri/src/nav.rs"), "utf8"), /https:\/\/app\.callupapp\.com\.au\/app\//);
});
