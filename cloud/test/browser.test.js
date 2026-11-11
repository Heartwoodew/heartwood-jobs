import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };

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

test("browser capture allows a Heartwood photo and rejects another tenant", async () => {
  const server = await start();
  const { port } = server.address();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome", headless: true });
  try {
    const page = await browser.newPage();
    const storageCalls = [];
    await page.route("**/*firebasestorage.googleapis.com/**", route => {
      storageCalls.push(route.request().url());
      route.fulfill({ status: 403, body: "stub-denied" });
    });
    await page.route("**/*googleapis.com/**", route => route.fulfill({ status: 204, body: "" }));
    await page.goto(`http://127.0.0.1:${port}/cloud/test/browser/harness.html`);
    await page.setInputFiles("#file", { name: "site.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
    await page.click("#photo");
    await page.click("#wrong");
    await page.click("#receipt");
    await page.click("#read");
    const raw = await page.locator("#out").innerText();
    const data = JSON.parse(raw);
    assert.deepEqual(data.calls, [
      "tenants/heartwood/jobs/job1/photos/pphoto001",
      "tenants/heartwood/receipts/r1/original",
    ]);
    assert.equal(data.log.find(r => r.action === "wrong-tenant").reason, "wrong-tenant");
    assert.equal(data.log.find(r => r.action === "wrong-tenant").callsUnchanged, true);
    assert.equal(data.log.find(r => r.action === "receipt").read, "receipt-hidden");
    assert.equal(data.log.find(r => r.action === "receipt").dollarsShown, "");
    assert.equal(await page.locator("#amount").innerText(), "");
    assert.equal(data.log.find(r => r.action === "read").finance, "finance-denied");
    assert.equal(storageCalls.length, 0);

    const app = await browser.newPage();
    const failed = [];
    app.on("pageerror", err => failed.push(String(err)));
    await app.goto(`http://127.0.0.1:${port}/app/index.html`, { waitUntil: "domcontentloaded" });
    await app.getByRole("heading", { name: "Sign in" }).waitFor({ timeout: 20000 });
    assert.equal(failed.length, 0, failed.join("\n"));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
