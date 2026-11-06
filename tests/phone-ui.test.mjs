// Isolated phone + desktop render. Firebase is the local stub — no live project.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { launchChrome, openPage, waitReady, shot } from "./browse.mjs";

const PORT = 8771;
const shots = "/opt/cursor/artifacts";
mkdirSync(shots, { recursive: true });

async function waitServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/tests/phone-preview.html`);
      if (r.ok) return;
    } catch { /* */ }
    await sleep(100);
  }
  throw new Error("preview server did not start");
}

test("phone shell, quote gate and handlers", async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore" });
  const chrome = await launchChrome(9341);
  try {
    await waitServer();
    const base = `http://127.0.0.1:${PORT}/tests/phone-preview.html`;
    async function run(name, query, width, height) {
      const { page, errors } = await openPage(chrome.port, base + query);
      await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 800 });
      await waitReady(page, 12000);
      const info = await page.send("Runtime.evaluate", {
        expression: "JSON.stringify({check:document.body.dataset.check||'',fails:document.body.dataset.fails||'',errs:window.__errs||[],ready:document.body.dataset.ready})",
        returnByValue: true
      });
      const data = JSON.parse(info.result.value);
      const full = /detail|check-/.test(name);
      const heightPx = full
        ? Math.min(2400, (await page.send("Runtime.evaluate", { expression: "Math.max(document.documentElement.scrollHeight, window.innerHeight)", returnByValue: true })).result.value)
        : height;
      const buf = await shot(page, { x: 0, y: 0, width, height: Math.max(height, heightPx), scale: 1 });
      writeFileSync(`${shots}/${name}.png`, buf);
      assert.deepEqual(errors, [], name + " exceptions");
      assert.deepEqual(data.errs, [], name + " page errors " + data.errs.join("\n"));
      if (query.includes("check=1")) assert.equal(data.check, "pass", data.fails);
      return page;
    }
    await run("after-phone-today", "?role=operator", 390, 844);
    await run("after-phone-detail", "?role=operator&open=detail", 390, 844);
    await run("after-phone-jobs", "?role=operator&open=jobs", 390, 844);
    await run("after-phone-photos", "?role=operator&open=photos", 390, 844);
    await run("after-phone-more", "?role=operator&open=more", 390, 844);
    await run("after-desktop-operator", "?role=operator", 1280, 800);
    await run("after-desktop-admin", "?role=admin", 1280, 800);
    await run("after-quote-wizard", "?role=supervisor&open=wizard", 390, 844);
    await run("check-operator", "?role=operator&check=1", 390, 900);
    await run("check-supervisor", "?role=supervisor&check=1", 390, 900);
    await run("check-supervisor-blank", "?role=supervisor&rates=blank&check=1", 390, 900);
    await run("check-admin", "?role=admin&check=1", 1280, 800);
  } finally {
    chrome.proc.kill("SIGKILL");
    server.kill("SIGKILL");
  }
});
