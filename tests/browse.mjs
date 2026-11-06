// Headless Chrome driver for the isolated preview. Uses the system binary, not the wrapper.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export async function launchChrome(port = 9333) {
  const dir = mkdtempSync(join(tmpdir(), "hw-chrome-"));
  const proc = spawn("/usr/bin/google-chrome-stable", [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    "--window-size=1280,900", "about:blank"
  ], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return { proc, port };
    } catch { /* booting */ }
    await sleep(100);
  }
  proc.kill("SIGKILL");
  throw new Error("Chrome did not open a debugging port");
}

export function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const waits = [];
  ws.addEventListener("message", ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else {
      for (const w of waits) w(msg);
    }
  });
  const ready = new Promise(resolve => ws.addEventListener("open", () => resolve()));
  return {
    ready,
    on(fn) { waits.push(fn); },
    send(method, params = {}) {
      const msgId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    },
    close() { ws.close(); }
  };
}

export async function openPage(port, url) {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const target = await created.json();
  const page = connect(target.webSocketDebuggerUrl);
  await page.ready;
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  const errors = [];
  page.on(msg => {
    if (msg.method === "Runtime.exceptionThrown") {
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
  });
  return { page, errors, targetId: target.id };
}

export async function waitReady(page, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await page.send("Runtime.evaluate", { expression: "document.body && document.body.dataset.ready || ''", returnByValue: true });
    if (r.result?.value === "1") return;
    await sleep(50);
  }
  throw new Error("preview did not become ready");
}

export async function shot(page, clip) {
  const r = await page.send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
  return Buffer.from(r.data, "base64");
}
