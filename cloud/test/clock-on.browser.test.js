// Headless Chrome against the Auth and Firestore emulators. Fake data only; does not touch heartwood-9f37f.
// Patrick's account (a rules admin with an operator profile) opens today's jobs from the morning alert,
// goes to Hours, clocks on and picks a machine. Run with `npm run test:clock-browser` from cloud/.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PATRICK = "R7t41e54Ykcdk9WPdVZnDd697iI2";
const email = "patrick.clock@heartwood.test";
const password = "test-pass-123";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };

function startStatic() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try {
      const body = readFileSync(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch { res.writeHead(404); res.end("missing"); }
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("clocking on from My jobs does not throw or stall, and the machine answer saves", { timeout: 150000 }, async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "start this with npm run test:clock-browser");
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
  const made = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/projects/demo-heartwood/accounts`, {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer owner" },
    body: JSON.stringify({ email, password, localId: PATRICK }),
  });
  assert.ok(made.ok, await made.text());
  const env = await initializeTestEnvironment({ projectId: "demo-heartwood", firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") } });
  const today = "2026-11-26", ws = "2026-11-23";
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", PATRICK), { name: "Patrick", staffName: "Patrick", role: "operator", companyId: "heartwood" });
    for (const [id, name] of [["f1", "Bobcat T450"], ["f2", "Isuzu truck"]]) await setDoc(doc(db, "tenants", "heartwood", "fleet", id), { name });
    for (let i = 1; i <= 2; i++) {
      await setDoc(doc(db, "jobs", "job" + i), { companyId: "heartwood", client: "Builder " + i, type: "backslab", address: `${i} Example Street, Testville QLD 4000`, date: today, time: "07:00", durationHrs: 3, status: "Scheduled", assigned: [PATRICK], assignedNames: ["Patrick"], log: [] });
    }
    await setDoc(doc(db, "timesheets", `${PATRICK}_${ws}`), {
      uid: PATRICK, name: "Patrick", companyId: "heartwood", weekStart: ws, weekEnd: "2026-11-29", days: {}, entries: {}, totalHrs: 0,
      locationConsentAt: Timestamp.now(), updatedAt: Timestamp.now(), updatedAtIso: new Date().toISOString(), lastEntryId: "",
    });
  });
  const server = await startStatic();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, geolocation: { latitude: -27.47, longitude: 153.03, accuracy: 10 }, permissions: ["geolocation"] });
    await ctx.addInitScript(t => { window.HW_TODAY = t; try { localStorage.setItem("hwTsLocConsent", "1"); } catch { /* private mode */ } }, today);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${server.address().port}/app/index.html?emu=1&jobs=today`);
    await page.locator("#login input[name=e]").waitFor({ timeout: 20000 });
    await page.fill("#login input[name=e]", email);
    await page.fill("#login input[name=p]", password);
    await page.click("#login button.primary");
    await page.locator("[data-tab=more]").first().waitFor({ timeout: 20000 });
    await page.locator("[data-tab=more]").first().click();
    await page.locator("[data-go=hours]").click();
    await page.locator("#tsclockon").waitFor({ timeout: 20000 });
    await page.locator("#tsclockon").click();
    await page.locator("#tsmachine .tsmach").first().waitFor({ timeout: 20000 });
    // The page keeps answering after the clock on.
    for (let i = 0; i < 10; i++) {
      const alive = await Promise.race([page.evaluate(() => true), new Promise(r => setTimeout(() => r(false), 3000))]);
      assert.equal(alive, true, "page stalled after clock on");
      await page.waitForTimeout(300);
    }
    assert.match(await page.locator(".ts-live").innerText(), /Clocked on/);
    await page.locator("#tsmachine .tsmach", { hasText: "Bobcat T450" }).click();
    await page.locator("#tsmachine").waitFor({ state: "detached", timeout: 15000 });
    assert.deepEqual(errors.filter(e => /Error/.test(e)), [], "clock on threw: " + errors.join("\n"));
    await env.withSecurityRulesDisabled(async c => {
      const snap = await getDoc(doc(c.firestore(), "timesheets", `${PATRICK}_${ws}`));
      const shifts = Object.values(snap.data().entries || {});
      assert.equal(shifts.length, 1);
      assert.equal(shifts[0].status, "open");
      assert.equal(shifts[0].machineChoice, "asset");
      assert.equal(shifts[0].machineName, "Bobcat T450");
    });
  } finally {
    await browser.close();
    server.close();
    await env.cleanup();
  }
});
