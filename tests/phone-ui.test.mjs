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
      const full = /detail|check-|empty|job-photos|gallery|photos|staff|accept/.test(name);
      const heightPx = full
        ? Math.min(2400, (await page.send("Runtime.evaluate", { expression: "Math.max(document.documentElement.scrollHeight, window.innerHeight)", returnByValue: true })).result.value)
        : height;
      const buf = await shot(page, { x: 0, y: 0, width, height: Math.max(height, heightPx), scale: 1 });
      writeFileSync(`${shots}/${name}.png`, buf);
      assert.deepEqual(errors, [], name + " exceptions");
      assert.deepEqual(data.errs, [], name + " page errors " + data.errs.join("\n"));
      if (query.includes("check=1")) assert.equal(data.check, "pass", data.fails);
      if (query.includes("open=chat")) {
        const text = await page.send("Runtime.evaluate", { expression: "document.querySelector('.chat-log')?.innerText || ''", returnByValue: true });
        assert.match(text.result.value, /Brightvale slab is clear/, name);
        assert.match(text.result.value, /See you there/, name);
        const order = await page.send("Runtime.evaluate", { expression: "(() => { const t=[...document.querySelectorAll('.chat-msg')].map(n=>n.innerText); return t.findIndex(s=>s.includes('Brightvale')) < t.findIndex(s=>s.includes('See you there')); })()", returnByValue: true });
        assert.equal(order.result.value, true, name + " newest last");
        const img = await page.send("Runtime.evaluate", { expression: "!!document.querySelector('.chat-pic img')", returnByValue: true });
        assert.equal(img.result.value, true, name);
        const scrolled = await page.send("Runtime.evaluate", { expression: "(() => { const log=document.querySelector('.chat-log'); if(!log) return false; return log.scrollHeight - log.scrollTop - log.clientHeight < 80; })()", returnByValue: true });
        assert.equal(scrolled.result.value, true, name + " stuck to bottom");
        const calls = await page.send("Runtime.evaluate", { expression: "JSON.stringify((window.__fbCalls||[]).map(c=>c.op))", returnByValue: true });
        assert.doesNotMatch(calls.result.value, /getDownloadURL/, name);
        assert.match(calls.result.value, /getBlob/, name);
      }
      if (query.includes("open=staff")) {
        const text = await page.send("Runtime.evaluate", { expression: "document.querySelector('#invitef')?.innerText || ''", returnByValue: true });
        assert.match(text.result.value, /Invite staff/, name);
        assert.match(text.result.value, /Operator/, name);
        assert.match(text.result.value, /Supervisor/, name);
        assert.match(text.result.value, /Labourer/, name);
        const options = await page.send("Runtime.evaluate", { expression: "[...document.querySelectorAll('#invitef select option')].map(o => o.value).join(',')", returnByValue: true });
        // Heartwood admin (fixed list or a heartwoodAdmins grant): all four roles.
        assert.equal(options.result.value, "labourer,operator,supervisor,admin", name);
        const list = await page.send("Runtime.evaluate", { expression: "document.querySelector('.invitelist')?.innerText || ''", returnByValue: true });
        assert.match(list.result.value, /Casey Nguyen/, name);
        assert.match(list.result.value, /Pending/, name);
        assert.match(list.result.value, /Sam Lee/, name);
        assert.match(list.result.value, /Accepted/, name);
        assert.match(list.result.value, /Riley Chen/, name);
        assert.match(list.result.value, /Expired/, name);
        assert.match(list.result.value, /Resend/, name);
        assert.match(list.result.value, /Cancel/, name);
        assert.match(list.result.value, /https:\/\/jobs\.heartwoodew\.com\/app\?invite=/, name);
        assert.doesNotMatch(list.result.value, /admin@|alex@heartwoodew/i, name);
      }
      if (query.includes("open=accept")) {
        const text = await page.send("Runtime.evaluate", { expression: "document.querySelector('#acceptf')?.innerText || ''", returnByValue: true });
        assert.match(text.result.value, /Set your password/, name);
        assert.match(text.result.value, /Casey Nguyen/, name);
        assert.match(text.result.value, /casey\.nguyen@example\.com/, name);
        assert.match(text.result.value, /Operator/, name);
        const controls = await page.send("Runtime.evaluate", { expression: "document.querySelectorAll('#acceptf select, #acceptf [name=role]').length", returnByValue: true });
        assert.equal(controls.result.value, 0, name);
        await page.send("Runtime.evaluate", { expression: "(() => { const f = document.querySelector('#acceptf'); f.p.value = 'preview-pass'; f.p2.value = 'preview-pass'; f.requestSubmit(); })()" });
        await sleep(50);
        const err = await page.send("Runtime.evaluate", { expression: "document.querySelector('#aceerr')?.textContent || ''", returnByValue: true });
        assert.match(err.result.value, /Preview only/, name);
        const calls = await page.send("Runtime.evaluate", { expression: "JSON.stringify((performance.getEntriesByType('resource')||[]).map(r => r.name))", returnByValue: true });
        assert.doesNotMatch(calls.result.value, /cloudfunctions|5001|sendgrid|smtp/i, name);
      }
      if (query.includes("open=jobchat")) {
        const text = await page.send("Runtime.evaluate", { expression: "document.querySelector('.job-chat')?.innerText || ''", returnByValue: true });
        assert.match(text.result.value, /Road base is on the truck/, name);
        assert.match(text.result.value, /backblade/, name);
      }
      if (query.includes("open=gallery")) {
        const g = await page.send("Runtime.evaluate", { expression: "document.querySelector('[data-photoslot]')?.innerText || ''", returnByValue: true });
        assert.match(g.result.value, /2027-02-06/, name);
        assert.match(g.result.value, /not scheduled/i, name);
        assert.doesNotMatch(g.result.value, /2099/, name);
        if (query.includes("view=large")) {
          const img = await page.send("Runtime.evaluate", { expression: "!!document.querySelector('.pview img') && !!document.querySelector('.pview .pn') && !!document.querySelector('.pview .px')", returnByValue: true });
          assert.equal(img.result.value, true, name);
        } else {
          const n = await page.send("Runtime.evaluate", { expression: "document.querySelectorAll('[data-photo-grid] button.pth').length", returnByValue: true });
          assert.equal(n.result.value, 2, name);
        }
      }
      if (query.includes("photos=none") && query.includes("open=job&")) {
        const text = await page.send("Runtime.evaluate", { expression: "document.querySelector('[data-photos-state=\"empty\"]')?.textContent || ''", returnByValue: true });
        assert.match(text.result.value, /No cloud copies on this job yet/, name);
        const grid = await page.send("Runtime.evaluate", { expression: "document.querySelectorAll('[data-photo-grid] img').length", returnByValue: true });
        assert.equal(grid.result.value, 0, name);
      }
      if (query.includes("open=job674")) {
        const text = await page.send("Runtime.evaluate", { expression: "document.querySelector('#jf')?.innerText || ''", returnByValue: true });
        assert.match(text.result.value, /Email history \(4 photos\)/, name);
        assert.match(text.result.value, /Email photos/, name);
        if (query.includes("shot=empty")) {
          assert.match(text.result.value, /No cloud copies on this job yet\. The 4 emailed photos are separate from this gallery/, name);
          const n = await page.send("Runtime.evaluate", { expression: "document.querySelectorAll('[data-photo-grid] button.pth').length", returnByValue: true });
          assert.equal(n.result.value, 0, name);
        }
        if (query.includes("cloud=4")) {
          const n = await page.send("Runtime.evaluate", { expression: "document.querySelectorAll('[data-photo-grid] button.pth').length", returnByValue: true });
          assert.equal(n.result.value, 4, name);
          const grid = await page.send("Runtime.evaluate", { expression: "document.querySelector('[data-photo-grid]')?.innerText || ''", returnByValue: true });
          assert.doesNotMatch(grid.result.value, /Receipt/, name);
        }
      }
      if (query.includes("open=jobphotos")) {
        const text = await page.send("Runtime.evaluate", { expression: "document.querySelector('#jf')?.innerText || ''", returnByValue: true });
        assert.match(text.result.value, /Email photos/, name);
        assert.doesNotMatch(text.result.value, /📷 Photos/, name);
        if (query.includes("shot=empty")) {
          assert.match(text.result.value, /No cloud copies on this job yet/, name);
          assert.match(text.result.value, /The 4 emailed photos are separate from this gallery/, name);
          assert.match(text.result.value, /Email history \(4 photos\)/, name);
        }
        if (query.includes("shot=gallery")) {
          const n = await page.send("Runtime.evaluate", { expression: "document.querySelectorAll('[data-photo-grid] button.pth').length", returnByValue: true });
          assert.ok(n.result.value >= 1, name);
        }
      }
      if (query.includes("photos=error") || query.includes("photos=meta")) {
        const state = await page.send("Runtime.evaluate", { expression: "document.querySelector('[data-photos-state=\"error\"]')?.textContent || ''", returnByValue: true });
        assert.match(state.result.value, /Couldn't load photos \(storage\/unauthorized\)/, name);
        assert.match(state.result.value, /Try again/, name);
        const empty = await page.send("Runtime.evaluate", { expression: "document.body.innerText.includes('No cloud copies on this job yet')", returnByValue: true });
        if (query.includes("photos=meta")) assert.equal(empty.result.value, false, name);
      }
      return page;
    }
    await run("after-phone-today", "?role=operator", 390, 844);
    await run("after-phone-detail", "?role=operator&open=detail", 390, 844);
    await run("after-phone-jobs", "?role=operator&open=jobs", 390, 844);
    await run("after-phone-photos", "?role=operator&open=photos", 390, 844);
    await run("after-admin-job-photos", "?role=admin&open=jobphotos&photos=none", 390, 844);
    await run("after-admin-job-photos-empty", "?role=admin&open=jobphotos&photos=none&shot=empty", 390, 844);
    await run("after-admin-job-photos-gallery", "?role=admin&open=jobphotos&shot=gallery", 390, 844);
    await run("after-job674-emailed", "?role=admin&open=job674&photos=none", 390, 844);
    await run("after-job674-empty", "?role=admin&open=job674&photos=none&shot=empty", 390, 844);
    await run("after-job674-gallery", "?role=admin&open=job674&cloud=4&shot=gallery", 390, 844);
    await run("after-phone-gallery", "?role=operator&open=gallery", 390, 844);
    await run("after-phone-gallery-large", "?role=operator&open=gallery&view=large", 390, 844);
    await run("after-phone-detail-empty", "?role=operator&open=job&job=j4&photos=none", 390, 844);
    await run("after-phone-photos-error", "?role=operator&open=detail&photos=error", 390, 844);
    await run("after-phone-photos-meta", "?role=operator&open=detail&photos=meta", 390, 844);
    await run("after-phone-more", "?role=operator&open=more", 390, 844);
    await run("staff-invites-phone", "?role=admin&open=staff", 390, 844);
    await run("staff-accept-phone", "?open=accept&invite=pendingpreviewtoken00000000000000000000000", 390, 844);
    await run("chat-phone", "?role=operator&open=chat", 390, 844);
    await run("chat-job-phone", "?role=operator&open=jobchat", 390, 844);
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
