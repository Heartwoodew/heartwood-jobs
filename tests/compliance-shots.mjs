// Phone shots of Compliance using the local preview stub. No live Firebase project.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { launchChrome, openPage, waitReady, shot } from "./browse.mjs";

const PORT = 8773;
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
  ["compliance_home_banner_phone", "?role=admin&fleet=1", 390, 844],
  ["compliance_fleet_list_phone", "?role=admin&fleet=1&open=fleet", 390, 844],
  ["compliance_fleet_edit_phone", "?role=admin&fleet=1&open=fleetedit", 390, 844],
  ["compliance_policies_phone", "?role=admin&fleet=1&open=policies", 390, 844],
  ["compliance_staff_fleet_phone", "?role=operator&fleet=1&open=stafffleet", 390, 844],
];

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: new URL("..", import.meta.url).pathname, stdio: "ignore",
});
const chrome = await launchChrome(9344);
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
        edit: !!document.querySelector("#compform"),
        rego: document.querySelector("[name=rego]")?.value || "",
        coiOn: !!document.querySelector("[name=coiRequired]")?.checked,
        editBtns: document.querySelectorAll("[data-comp-edit]").length,
        policies: document.querySelectorAll("[data-policy]").length,
        calls: (window.__fbCalls || []).map(c => c.path || c.col || c.op)
      })`,
      returnByValue: true,
    });
    const data = JSON.parse(info.result.value);
    if (errors.length) throw new Error(name + " " + errors.join("\n"));
    if (data.errs.length) throw new Error(name + " " + data.errs.join("\n"));
    const text = data.text;
    if (name.includes("banner")) {
      if (!/Compliance needs attention/.test(text)) throw new Error("banner missing\n" + text.slice(0, 500));
      if (!/policy/.test(text)) throw new Error("policy reminder missing\n" + text.slice(0, 500));
      if (!/Preview tipper/.test(text)) throw new Error("fleet name missing from banner");
    }
    if (name.includes("fleet_list")) {
      for (const badge of ["Expired", "Due within 30 days", "OK"]) {
        if (!text.includes(badge)) throw new Error(name + " missing " + badge);
      }
      if (!/not insurance/i.test(text)) throw new Error("COI explanation missing");
      if (!data.editBtns) throw new Error("admin list has no edit");
    }
    if (name.includes("edit")) {
      if (!data.edit) throw new Error("edit form missing");
      if (!/COI required/.test(text)) throw new Error("COI field missing");
      if (!/certificate of inspection/i.test(text)) throw new Error("COI meaning missing");
      if (data.rego !== "PRE001" || !data.coiOn) throw new Error("rego or COI missing " + data.rego);
    }
    if (name.includes("policies")) {
      if (!/WorkCover/.test(text) || !/\$20,000,000/.test(text)) throw new Error("policy details missing\n" + text.slice(0, 700));
      if (!/Preview tipper/.test(text)) throw new Error("linked asset missing");
      if (!data.policies) throw new Error("no policy cards");
    }
    if (name.includes("staff")) {
      if (!/read only/i.test(text)) throw new Error("staff screen is not marked read only");
      if (data.editBtns) throw new Error("staff can edit");
      if (/WorkCover|\$20,000,000|Public liability/.test(text)) throw new Error("staff can see policies\n" + text.slice(0, 700));
      if (!/Expired/.test(text) || !/OK/.test(text)) throw new Error("staff missing status");
      if (data.calls.some(c => String(c).includes("policies"))) throw new Error("staff subscribed to policies");
    }
    const heightPx = Math.min(2200, (await page.send("Runtime.evaluate", {
      expression: "Math.max(document.documentElement.scrollHeight, window.innerHeight)",
      returnByValue: true,
    })).result.value);
    const buf = await shot(page, { x: 0, y: 0, width, height: Math.max(height, heightPx), scale: 1 });
    writeFileSync(`${shots}/${name}.png`, buf);
    console.log("wrote", name, buf.length);
  }
} finally {
  chrome.proc.kill("SIGKILL");
  server.kill("SIGKILL");
}
