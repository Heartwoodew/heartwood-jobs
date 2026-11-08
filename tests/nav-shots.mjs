// Phone shots of the admin menu and staff More list. Preview stub only.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { launchChrome, openPage, waitReady, shot } from "./browse.mjs";

const label = process.argv[2] || "nav";
const PORT = 8782;
const shots = "/opt/cursor/artifacts";
mkdirSync(shots, { recursive: true });

async function waitServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/tests/phone-preview.html`);
      if (r.ok) return;
    } catch { /* booting */ }
    await sleep(100);
  }
  throw new Error("preview server did not start");
}

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: new URL("..", import.meta.url).pathname, stdio: "ignore",
});
const chrome = await launchChrome(9355);
try {
  await waitServer();
  async function grab(name, query, prepare) {
    const { page, errors } = await openPage(chrome.port, `http://127.0.0.1:${PORT}/tests/phone-preview.html${query}`);
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await waitReady(page, 12000);
    if (prepare) await page.send("Runtime.evaluate", { expression: prepare, returnByValue: true });
    await sleep(200);
    const info = await page.send("Runtime.evaluate", {
      expression: "JSON.stringify({errs:window.__errs||[],text:document.body.innerText})",
      returnByValue: true,
    });
    const data = JSON.parse(info.result.value);
    if (errors.length || data.errs.length) throw new Error(name + " " + [...errors, ...data.errs].join("\n"));
    const heightPx = Math.min(2200, (await page.send("Runtime.evaluate", {
      expression: "Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, window.innerHeight)",
      returnByValue: true,
    })).result.value);
    const buf = await shot(page, { x: 0, y: 0, width: 390, height: Math.max(844, heightPx), scale: 1 });
    writeFileSync(`${shots}/${name}.png`, buf);
    console.log("wrote", name, "textHasCompliance", data.text.includes("Compliance"), "textHasSWMS", data.text.includes("SWMS"));
  }
  const openMenu = `(() => {
    document.querySelector("#burger")?.click();
    const side = document.querySelector(".sm-side");
    if (side) { side.style.position = "relative"; side.style.maxHeight = "none"; side.style.top = "auto"; side.style.display = "flex"; }
    return true;
  })()`;
  await grab(`${label}_admin_menu_phone`, "?role=admin", openMenu);
  await grab(`${label}_staff_more_phone`, "?role=operator&open=more", "");
} finally {
  chrome.proc.kill("SIGKILL");
  server.kill("SIGKILL");
}
