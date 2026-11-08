// Headless Chrome against the Auth, Firestore and Storage emulators. Fake data only.
// Does not touch heartwood-9f37f. Run with `npm run test:hours-browser` from cloud/.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { collection, connectFirestoreEmulator, doc, getDocs, getFirestore, setDoc, terminate, Timestamp } from "firebase/firestore";
import { connectStorageEmulator, getBytes, getMetadata, getStorage, ref } from "firebase/storage";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const password = "test-pass-123";
const adminEmail = "alex.hours@heartwood.test";
const patrickEmail = "patrick.hours@heartwood.test";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };

function hostPort(value, fallbackPort) {
  const raw = value || `127.0.0.1:${fallbackPort}`;
  const [host, port] = raw.split(":");
  return { host, port: Number(port) };
}

function startStatic() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try {
      const body = readFileSync(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("missing");
    }
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function signUp(address) {
  const auth = hostPort(process.env.FIREBASE_AUTH_EMULATOR_HOST, 9099);
  const res = await fetch(`http://${auth.host}:${auth.port}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: address, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error("sign up failed " + JSON.stringify(body));
  return body.localId;
}

async function signInPage(page, email) {
  if (page.url() === "about:blank") await page.goto(page._hoursUrl);
  await page.locator("#login").waitFor({ timeout: 20000 });
  await page.locator("#login input[name=e]").fill(email);
  await page.locator("#login input[name=p]").fill(password);
  await page.locator("#login button").click();
  const logout = page.locator("#logout");
  const err = page.locator("#lerr");
  const start = Date.now();
  while (Date.now() - start < 20000) {
    if (await logout.isVisible().catch(() => false) && !(await logout.evaluate(el => el.classList.contains("hidden")).catch(() => true))) return;
    const message = await err.textContent().catch(() => "");
    if (message) throw new Error(message);
    await page.waitForTimeout(200);
  }
  throw new Error("sign in did not finish: " + await page.locator("body").innerText());
}

test("timesheet download and make-and-send work against the emulator", { timeout: 120000 }, async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "start this with npm run test:hours-browser");
  const adminId = await signUp(adminEmail);
  const patrickId = await signUp(patrickEmail);
  const env = await initializeTestEnvironment({
    projectId: "demo-heartwood",
    firestore: { rules: readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8") },
    storage: { rules: readFileSync(new URL("../emulator/storage.rules", import.meta.url), "utf8") },
  });
  const server = await startStatic();
  const { port } = server.address();
  const browser = await chromium.launch({
    executablePath: "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const errors = [];
  try {
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users", adminId), { name: "Alex Admin", role: "admin" });
      await setDoc(doc(db, "users", patrickId), { name: "Patrick", role: "operator" });
      await setDoc(doc(db, "timesheets", `${patrickId}_2026-11-02`), {
        uid: patrickId, name: "Patrick", weekStart: "2026-11-02", weekEnd: "2026-11-08",
        days: {
          "2026-11-02": { start: "06:00", finish: "14:00", note: "" },
          "2026-11-03": { start: "05:30", finish: "13:00", note: "30min lunch" },
        },
        entries: {}, totalHrs: 14.5, updatedAt: Timestamp.now(), updatedAtIso: "2026-11-08T06:00:00.000Z",
      });
    });

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page._hoursUrl = `http://127.0.0.1:${port}/app/index.html?emu=1`;
    page.on("pageerror", err => errors.push(String(err)));
    await page.addInitScript(() => { window.HW_TODAY = "2026-11-08"; });
    await page.goto(page._hoursUrl);
    await signInPage(page, adminEmail);
    await page.locator("[data-view=timesheet]").click();
    await page.locator("#hxdl").waitFor({ timeout: 15000 });
    await page.locator(".ts-card h3", { hasText: "Patrick" }).waitFor({ timeout: 10000 });
    assert.match(await page.locator(".ts-card h3", { hasText: "Patrick" }).innerText(), /14\.5 h/);

    const downloadOnly = page.waitForEvent("download", { timeout: 10000 });
    await page.locator("#hxdl").click();
    const only = await downloadOnly;
    assert.match(only.suggestedFilename(), /^Heartwood_Earthworx_hours_2026-11-02_to_2026-11-08\.xlsx$/);
    const onlyBytes = readFileSync(await only.path());
    assert.equal(onlyBytes[0], 0x50);
    assert.equal(onlyBytes[1], 0x4b);
    assert.match(onlyBytes.toString("utf8"), /Patrick/);
    assert.equal(await page.locator("#hxerr").count(), 0);

    const sentDownload = page.waitForEvent("download");
    await page.locator("#hxgo").click();
    const sent = await sentDownload;
    assert.match(sent.suggestedFilename(), /\.xlsx$/);
    await page.locator(".qpill", { hasText: "Queued, emails within ~15 min" }).waitFor({ timeout: 15000 });
    assert.equal(await page.locator("#hxerr").count(), 0, await page.locator("#hxerr").innerText().catch(() => ""));
    const row = await page.locator(".hx-row").innerText();
    assert.match(row, /Heartwood_Earthworx_hours_2026-11-02_to_2026-11-08\.xlsx/);
    assert.match(row, /14\.5 h/);
    assert.match(row, /Queued/);

    const iosDownload = page.waitForEvent("download");
    const ios = await page.evaluate(async () => {
      const mod = await import("./features/hours-export.js");
      const nav = {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
        canShare() { throw new TypeError("xlsx is not a shareable type"); },
        share() { throw new Error("share should not run"); },
      };
      return mod.deliverHoursFile({ bytes: new Uint8Array([0x50, 0x4b, 3, 4, 1]), filename: "ios-fallback.xlsx", nav, doc: document });
    });
    const iosFile = await iosDownload;
    assert.equal(ios.via, "download");
    assert.equal(ios.ok, true);
    assert.equal(iosFile.suggestedFilename(), "ios-fallback.xlsx");
    const shared = await page.evaluate(async () => {
      const mod = await import("./features/hours-export.js");
      let name = "";
      const nav = {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
        canShare() { return true; },
        async share(data) { name = data.files[0].name; },
      };
      const saved = await mod.deliverHoursFile({ bytes: new Uint8Array([0x50, 0x4b, 3, 4]), filename: "ios-share.xlsx", nav, doc: document });
      return { saved, name };
    });
    assert.equal(shared.saved.via, "share");
    assert.equal(shared.name, "ios-share.xlsx");

    const fsHost = hostPort(process.env.FIRESTORE_EMULATOR_HOST, 8080);
    const stHost = hostPort(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 9199);
    const auHost = hostPort(process.env.FIREBASE_AUTH_EMULATOR_HOST, 9099);
    const probe = initializeApp({
      apiKey: "demo-key",
      projectId: "demo-heartwood",
      storageBucket: "heartwood-9f37f.firebasestorage.app",
    }, "hours-probe");
    const auth = getAuth(probe);
    const db = getFirestore(probe);
    const storage = getStorage(probe);
    connectAuthEmulator(auth, `http://${auHost.host}:${auHost.port}`, { disableWarnings: true });
    connectFirestoreEmulator(db, fsHost.host, fsHost.port);
    connectStorageEmulator(storage, stHost.host, stHost.port);
    await signInWithEmailAndPassword(auth, adminEmail, password);
    const snap = await getDocs(collection(db, "hoursExports"));
    assert.equal(snap.size, 1);
    const data = snap.docs[0].data();
    assert.equal(data.status, "queued");
    assert.equal(data.to, "accounts@heartwoodew.com");
    assert.equal(data.weekStart, "2026-11-02");
    assert.equal(data.weekEnd, "2026-11-08");
    assert.equal(data.people, 1);
    assert.equal(data.totalHours, 14.5);
    assert.equal(data.attempts, 0);
    assert.equal(data.createdBy, adminId);
    assert.equal(data.createdByName, "Alex Admin");
    assert.equal(data.storagePath, `hoursExports/${snap.docs[0].id}/${data.fileName}`);
    const meta = await getMetadata(ref(storage, data.storagePath));
    assert.equal(meta.contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(meta.customMetadata.purpose, "hours-export");
    assert.equal(meta.customMetadata.uploaderUid, adminId);
    assert.equal(meta.customMetadata.exportId, snap.docs[0].id);
    const stored = new Uint8Array(await getBytes(ref(storage, data.storagePath)));
    assert.equal(stored[0], 0x50);
    assert.equal(stored[1], 0x4b);
    assert.match(Buffer.from(stored).toString("utf8"), /Patrick/);
    assert.equal(errors.filter(e => /rerender|hxRun|ReferenceError/.test(e)).join("\n"), "");
    await terminate(db);
    await deleteApp(probe);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await env.cleanup();
  }
});
