// Phone-width check of the job ticket supervisor button. Fake preview data only.
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

test("the job ticket adds a supervisor on a phone, and staff do not see the button", async () => {
  const server = await start();
  const { port } = server.address();
  const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
    const errors = [];
    page.on("pageerror", err => errors.push(String(err)));
    await page.addInitScript(() => {
      window.HW_CLIENTS = [{
        id: "orbit-homes",
        name: "Orbit Homes (Qld) Pty Ltd",
        contacts: [
          { kind: "accounts", name: "Accounts", email: "accounts@example.test" },
          { kind: "supervisor", name: "Dana Lee", role: "Supervisor", mobile: "0400 111 222", email: "dana@example.test" },
          { kind: "supervisor", name: "Pat Stone", role: "Supervisor", mobile: "0411 222 333", email: "pat@example.test" },
        ],
      }];
    });
    await page.goto(`http://127.0.0.1:${port}/tests/phone-preview.html?role=admin`, { waitUntil: "domcontentloaded" });
    await page.locator('.hrow[data-id="j2"]').click();
    await page.locator("#jf").waitFor();
    await page.locator('[data-jt="sup"]').click();
    const add = page.locator("[data-supedit]");
    await add.waitFor();
    assert.equal(await add.innerText(), "Add supervisor");
    await page.locator(".supcard").scrollIntoViewIfNeeded();
    await mkdir(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, "supervisor-button-mobile.png") });

    await add.click();
    await page.locator("#supform").waitFor();
    const before = await page.locator("#supform").evaluate(f => ({
      title: f.querySelector("h2").textContent,
      checked: f.saveclient.checked,
      saved: [...f.pick.options].map(o => o.textContent),
    }));
    assert.equal(before.title, "Add supervisor");
    assert.equal(before.checked, true);
    assert.ok(before.saved.some(t => t.includes("Dana Lee")));
    await page.locator("#supform select[name=pick]").selectOption("0");
    const filled = await page.locator("#supform").evaluate(f => ({ name: f.name.value, mobile: f.mobile.value, email: f.email.value }));
    assert.equal(filled.name, "Dana Lee");
    assert.equal(filled.mobile, "0400 111 222");
    assert.equal(filled.email, "dana@example.test");
    await page.locator("#supform input[name=name]").fill("Dave Brown");
    await page.locator("#supform input[name=mobile]").fill("0412 345 678");
    await page.locator("#supform input[name=email]").fill("dave.brown@example.test");
    await page.screenshot({ path: join(OUT, "supervisor-dialog-mobile.png") });
    await page.locator("#supform button[value=ok]").click();
    await page.locator(".sup b", { hasText: "Dave Brown" }).waitFor();
    assert.equal(await page.locator("[data-supedit]").innerText(), "Change");

    const writes = await page.evaluate(() => (window.__fbCalls || []).filter(c => c.op === "updateDoc"));
    const job = writes.find(c => c.col === "jobs" && c.id === "j2");
    const client = writes.find(c => c.col === "clients" && c.id === "orbit-homes");
    assert.ok(job, "job update");
    assert.deepEqual(job.data, {
      supervisorName: "Dave Brown",
      contactName: "Dave Brown",
      supervisorEmail: "dave.brown@example.test",
      contactPhone: "0412 345 678",
      updatedAt: "server",
      updatedBy: "admin-preview",
    });
    assert.equal(client.data.contacts.filter(x => x.kind === "supervisor").length, 3);
    assert.equal(client.data.contacts.find(x => x.name === "Dave Brown").mobile, "0412 345 678");
    assert.equal(client.data.updatedBy, "admin-preview");

    await page.locator("[data-supedit]").click();
    await page.locator("#supform h2", { hasText: "Change supervisor" }).waitFor();
    await page.locator("#supform button[value=cancel]").click();

    const staff = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    await staff.goto(`http://127.0.0.1:${port}/tests/phone-preview.html?role=operator&open=detail`, { waitUntil: "domcontentloaded" });
    await staff.locator(".sup").waitFor();
    assert.equal(await staff.locator("[data-supedit]").count(), 0);
    assert.match(await staff.locator(".sup").innerText(), /Not known for this job/);

    const sup = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    await sup.goto(`http://127.0.0.1:${port}/tests/phone-preview.html?role=supervisor&open=detail`, { waitUntil: "domcontentloaded" });
    await sup.locator("[data-supedit]").waitFor();
    assert.equal(await sup.locator("[data-supedit]").innerText(), "Add supervisor");
    await sup.locator("[data-supedit]").click();
    await sup.locator("#supform").waitFor();
    assert.equal(await sup.locator("#supform input[name=saveclient]").count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
