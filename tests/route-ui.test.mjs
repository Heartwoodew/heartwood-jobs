// Phone preview of Optimise order. Firebase is the local stub. Routing is a fixed table, not the network.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { launchChrome, openPage, waitReady, shot } from "./browse.mjs";

const PORT = 8772;
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

test("optimise order on a phone", async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore" });
  const chrome = await launchChrome(9342);
  try {
    await waitServer();
    const base = `http://127.0.0.1:${PORT}/tests/phone-preview.html`;
    async function run(name, query, width, height) {
      const { page, errors } = await openPage(chrome.port, base + query);
      await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 800 });
      await waitReady(page, 15000);
      const info = await page.send("Runtime.evaluate", {
        expression: "JSON.stringify({text:(document.querySelector('#routesheet')||document.body).innerText,errs:window.__errs||[],calls:window.__fbCalls||[],stops:[...document.querySelectorAll('.mob-list .mrow')].map(n=>n.dataset.id),approve:!!document.querySelector('#routeapprove'),opt:!!document.querySelector('#optorder')})",
        returnByValue: true,
      });
      const data = JSON.parse(info.result.value);
      const full = await page.send("Runtime.evaluate", {
        expression: "document.querySelector('.route-ov') ? window.innerHeight : Math.max(document.documentElement.scrollHeight, window.innerHeight)",
        returnByValue: true,
      });
      const buf = await shot(page, { x: 0, y: 0, width, height: Math.max(height, Math.min(1800, full.result.value || height)), scale: 1 });
      writeFileSync(`${shots}/${name}.png`, buf);
      assert.deepEqual(errors, [], name + " exceptions");
      assert.deepEqual(data.errs, [], name + " " + data.errs.join("\n"));
      return data;
    }

    const dispatch = await run("route-dispatch-phone", "?role=admin&open=dispatch", 390, 844);
    assert.equal(dispatch.opt, true);
    assert.match(dispatch.text, /Optimise order/);
    assert.equal(dispatch.approve, false);

    const suggestion = await run("route-suggestion-phone", "?role=admin&open=optimise", 390, 1500);
    assert.match(suggestion.text, /location is not used/);
    assert.match(suggestion.text, /Cedar Court/);
    assert.match(suggestion.text, /37 min/);
    assert.match(suggestion.text, /1 h 4 min/);
    assert.match(suggestion.text, /shorter than the current order/);
    assert.doesNotMatch(suggestion.text, /Could not geocode/);
    assert.equal(suggestion.approve, true);
    const cedar = suggestion.text.indexOf("Cedar Court");
    const lumen = suggestion.text.indexOf("Lumen Street");
    assert.ok(cedar >= 0 && cedar < lumen, "cedar is suggested before lumen");
    assert.equal(suggestion.calls.some(c => c.op === "setDoc" && c.col === "runSheets"), false);
    assert.equal(suggestion.calls.some(c => c.keys && c.keys.includes("geo")), false);

    const tweaked = await run("route-tweaked-phone", "?role=admin&open=optimise&tweak=1&approve=1", 390, 1500);
    assert.match(tweaked.text, /longer than the current order/);
    assert.match(tweaked.text, /Saved for Patrick/);
    const saved = tweaked.calls.find(c => c.op === "setDoc" && c.col === "runSheets");
    assert.ok(saved, "approve writes a run sheet");
    assert.deepEqual(saved.jobIds, ["j1", "j3", "j2"]);
    assert.equal(saved.workerUid, "patrick");
    assert.equal(saved.status, "approved");
    assert.equal(saved.keys.includes("approvedAt"), true);
    assert.equal(JSON.stringify(saved).includes("gps"), false);

    const staff = await run("route-operator-order", "?role=operator&run=1", 390, 1100);
    assert.match(staff.text, /Approved driving order/);
    assert.equal(staff.approve, false);
    assert.equal(staff.opt, false);
    assert.deepEqual(staff.stops.slice(0, 3), ["j3", "j1", "j2"]);
    assert.match(staff.text, /Stop 1/i);
    assert.doesNotMatch(staff.text, /Approve order/);
    assert.equal(staff.calls.some(c => c.op === "setDoc"), false);
  } finally {
    chrome.proc.kill("SIGKILL");
    server.kill("SIGKILL");
  }
});
