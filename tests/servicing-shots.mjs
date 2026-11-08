// Phone shots of fleet servicing. Preview stub only. No live project.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { launchChrome, openPage, waitReady, shot } from "./browse.mjs";

const PORT = 8784;
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

const pages = [
  ["servicing_home_banner_phone", "?role=admin&fleet=1", 390, 844],
  ["servicing_list_phone", "?role=admin&fleet=1&open=servicing", 390, 844],
  ["servicing_form_phone", "?role=admin&fleet=1&open=serviceedit", 390, 844],
  ["servicing_staff_phone", "?role=operator&fleet=1&open=staffservice", 390, 844],
];

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: new URL("..", import.meta.url).pathname, stdio: "ignore",
});
const chrome = await launchChrome(9358);
try {
  await waitServer();
  for (const [name, query, width, height] of pages) {
    const { page, errors } = await openPage(chrome.port, `http://127.0.0.1:${PORT}/tests/phone-preview.html${query}`);
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    await waitReady(page, 12000);
    const info = await page.send("Runtime.evaluate", {
      expression: `JSON.stringify({
        text: document.body.innerText,
        errs: window.__errs || [],
        form: !!document.querySelector("#compform"),
        cost: document.querySelector("[name=amount]")?.value || "",
        who: document.querySelector("[name=servicedBy]")?.value || "",
        calls: (window.__fbCalls || []).map(c => c.col || "")
      })`,
      returnByValue: true,
    });
    const data = JSON.parse(info.result.value);
    if (errors.length || data.errs.length) throw new Error(name + " " + [...errors, ...data.errs].join("\n"));
    const text = data.text;
    if (name.includes("banner")) {
      if (!/services overdue/i.test(text)) throw new Error("service reminder missing\n" + text.slice(0, 600));
    }
    if (name.includes("list")) {
      if (!text.includes("Overdue") || !text.includes("Due within 30 days")) throw new Error("status badges missing");
      if (!text.includes("$840")) throw new Error("admin cost missing");
    }
    if (name.includes("form")) {
      if (!data.form || data.cost !== "$840" || data.who !== "Chuwar Diesel") throw new Error("service form missing " + data.cost + " " + data.who);
    }
    if (name.includes("staff")) {
      if (/\$840|\$220|\$150/.test(text)) throw new Error("staff can see cost\n" + text.slice(0, 500));
      if (text.includes("Add service") || text.includes("Edit last")) throw new Error("staff can edit");
      if (!text.includes("Overdue")) throw new Error("staff missing status");
      if (data.calls.includes("serviceCosts")) throw new Error("staff loaded costs");
    }
    const heightPx = Math.min(2400, (await page.send("Runtime.evaluate", {
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
