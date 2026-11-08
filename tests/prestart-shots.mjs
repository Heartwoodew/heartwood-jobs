// Phone shots of the prestart checklist. Preview stub only.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { launchChrome, openPage, waitReady, shot } from "./browse.mjs";

const PORT = 8786;
const shots = "/opt/cursor/artifacts";
mkdirSync(shots, { recursive: true });
const pages = [
  ["prestart_safety_menu_phone", "?role=operator&open=more", 390, 844],
  ["prestart_checklist_phone", "?role=operator&fleet=1&prestart=1&open=prestart", 390, 844],
  ["prestart_admin_phone", "?role=admin&fleet=1&prestart=1&open=prestartadmin", 390, 844],
  ["prestart_home_banner_phone", "?role=admin&fleet=1&prestart=1", 390, 844],
];

async function waitServer() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/tests/phone-preview.html`)).ok) return; } catch { /* */ }
    await sleep(100);
  }
  throw new Error("preview server did not start");
}

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: new URL("..", import.meta.url).pathname, stdio: "ignore",
});
const chrome = await launchChrome(9360);
try {
  await waitServer();
  for (const [name, query, width, height] of pages) {
    const { page, errors } = await openPage(chrome.port, `http://127.0.0.1:${PORT}/tests/phone-preview.html${query}`);
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    await waitReady(page, 12000);
    const info = await page.send("Runtime.evaluate", {
      expression: "JSON.stringify({text:document.body.innerText, errs:window.__errs||[]})",
      returnByValue: true,
    });
    const data = JSON.parse(info.result.value);
    if (errors.length || data.errs.length) throw new Error(name + " " + [...errors, ...data.errs].join("\n"));
    if (name.includes("menu") && !/Prestart/.test(data.text)) throw new Error("safety menu missing prestart");
    if (name.includes("checklist") && !/Hydraulics/.test(data.text)) throw new Error("checklist missing\n" + data.text.slice(0, 400));
    if (name.includes("checklist") && !/History/.test(data.text)) throw new Error("staff history missing");
    if (name.includes("admin") && !/Defect — check before use/.test(data.text)) throw new Error("defect missing\n" + data.text.slice(0, 500));
    if (name.includes("admin") && !/Sam/.test(data.text)) throw new Error("missing person not shown");
    if (name.includes("banner") && !/check before use/i.test(data.text)) throw new Error("home alert missing\n" + data.text.slice(0, 500));
    const heightPx = Math.min(2600, (await page.send("Runtime.evaluate", {
      expression: "Math.max(document.documentElement.scrollHeight, window.innerHeight)",
      returnByValue: true,
    })).result.value);
    const buf = await shot(page, { x: 0, y: 0, width, height: Math.max(height, heightPx), scale: 1 });
    writeFileSync(`${shots}/${name}.png`, buf);
    console.log("wrote", name);
  }
} finally {
  chrome.proc.kill("SIGKILL");
  server.kill("SIGKILL");
}
