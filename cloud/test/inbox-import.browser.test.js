// UI check against the preview stub. Fake emails only. No live Firebase project.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = "/opt/cursor/artifacts";
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json",
};

function start() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("missing");
    }
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function shot(page, name) {
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, name), fullPage: true });
}

test("import reviews a fake email before anything is saved", async () => {
  const server = await start();
  const { port } = server.address();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", err => errors.push(String(err)));
    await page.goto(`http://127.0.0.1:${port}/tests/phone-preview.html?role=admin&open=inbox`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-iimport='fake-orbit-spoil']").waitFor({ timeout: 15000 });
    await shot(page, "inbox-list.png");
    const before = await page.evaluate(() => (window.__fbCalls || []).filter(c => (c.op === "addDoc" || c.op === "setDoc") && c.col === "jobs").length);
    assert.equal(before, 0);

    await page.locator("[data-iimport='fake-orbit-spoil']").click();
    await page.locator("#jf").waitFor();
    const form = await page.locator("#jf").evaluate(f => ({
      client: f.client.value,
      address: f.address.value,
      lot: f.ilot.value,
      street: f.istreet.value,
      suburb: f.isuburb.value,
      type: f.type.value,
      po: f.po.value,
      date: f.date.value,
      notes: f.notes.value,
      supervisor: f.isup.value,
      phone: f.iphone.value,
      email: f.iemail.value,
    }));
    assert.equal(form.client, "Orbit Homes (Qld) Pty Ltd");
    assert.equal(form.address, "Lot 45, 12 Wattle St, Springfield Lakes");
    assert.equal(form.lot, "45");
    assert.equal(form.suburb, "Springfield Lakes");
    assert.equal(form.type, "spoil");
    assert.equal(form.po, "JOB/900/02");
    assert.equal(form.date, "2026-11-14");
    assert.match(form.notes, /nature strip/);
    assert.equal(form.supervisor, "Dave Brown");
    assert.equal(form.phone, "0412 345 678");
    assert.equal(form.email, "dave.brown@example.test");
    await page.locator("#dlg").screenshot({ path: join(OUT, "inbox-import-form.png") });

    await page.locator("#jf button[value=save]").click();
    await page.waitForFunction(() => (window.__fbCalls || []).some(c => (c.op === "addDoc" || c.op === "setDoc") && c.col === "jobs"));
    const calls = await page.evaluate(() => window.__fbCalls);
    const created = calls.filter(c => (c.op === "addDoc" || c.op === "setDoc") && c.col === "jobs").pop();
    assert.equal(created.data.client, "Orbit Homes (Qld) Pty Ltd");
    assert.equal(created.data.source, "inbox");
    assert.equal(created.data.inboxId, "fake-orbit-spoil");
    assert.equal(created.data.po, "JOB/900/02");
    assert.equal(created.data.type, "spoil");
    assert.equal(created.data.supervisorName, "Dave Brown");
    const marked = calls.filter(c => c.op === "updateDoc" && c.col === "inbox" && c.id === "fake-orbit-spoil").pop();
    assert.ok(marked.keys.includes("imported"));
    await page.locator("[data-iimport='fake-orbit-spoil']").waitFor({ state: "detached", timeout: 5000 });
    assert.match(await page.locator(".irow").filter({ hasText: "JOB/900/02" }).innerText(), /Imported/);

    await page.locator("[data-iimport='fake-orbit-slab']").click();
    await page.locator("#importdate").waitFor();
    assert.match(await page.locator(".import-banner").innerText(), /already exists/);
    assert.match(await page.locator(".import-banner").innerText(), /2402/);
    await page.locator("#dlg").screenshot({ path: join(OUT, "inbox-duplicate.png") });
    await page.locator("#dlg").evaluate(d => d.close());

    await page.locator("#toast").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.locator("#ibulk").click();
    await page.locator("[data-isel]").first().waitFor();
    const bulkText = await page.locator(".ilist").innerText();
    assert.match(bulkText, /Brightvale/);
    assert.match(bulkText, /Oak Cct/);
    assert.match(bulkText, /Banksia/);
    assert.doesNotMatch(bulkText, /Wattle/);
    assert.doesNotMatch(bulkText, /Remittance/);
    assert.doesNotMatch(bulkText, /Already imported/);
    await page.locator("#iall").click();
    await page.locator("#ireview").click();
    await page.locator("#isave").waitFor();
    assert.match(await page.locator("body").innerText(), /Nothing is written until you save/);
    const slab = page.locator(".ireview").filter({ hasText: "110565/900/01" });
    await slab.locator("input[value=date]").waitFor();
    assert.equal(await slab.locator("input[value=date]").isChecked(), true);
    await shot(page, "inbox-bulk-review.png");
    const writesBeforeSave = await page.evaluate(() => (window.__fbCalls || []).filter(c => (c.op === "addDoc" || c.op === "setDoc") && c.col === "jobs").length);
    assert.equal(writesBeforeSave, 1);
    assert.equal(errors.length, 0, errors.join("\n"));

    const staff = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await staff.goto(`http://127.0.0.1:${port}/tests/phone-preview.html?role=operator&open=inbox`, { waitUntil: "domcontentloaded" });
    await staff.locator(".mob-menu").waitFor({ timeout: 15000 });
    assert.equal(await staff.locator("[data-go=inbox]").count(), 0);
    assert.equal(await staff.locator("[data-iimport]").count(), 0);
    await staff.screenshot({ path: join(OUT, "inbox-staff-hidden.png") });

    const sup = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await sup.goto(`http://127.0.0.1:${port}/tests/phone-preview.html?role=supervisor&open=inbox`, { waitUntil: "domcontentloaded" });
    await sup.locator("[data-iimport='fake-torsion']").waitFor({ timeout: 15000 });
    await sup.screenshot({ path: join(OUT, "inbox-supervisor.png"), fullPage: true });
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
