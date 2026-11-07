// Phone-width preview of SWMS sign-off. Firebase is the local stub — no live project.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { launchChrome, openPage, waitReady, shot } from "./browse.mjs";

const PORT = 8774;
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

async function evalJson(page, expression) {
  const info = await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (info.exceptionDetails) throw new Error(info.exceptionDetails.text || "evaluate failed");
  return info.result.value;
}

test("phone SWMS sign-off, admin list, and signed PDF", async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname, stdio: "ignore",
  });
  const chrome = await launchChrome(9344);
  try {
    await waitServer();
    const base = `http://127.0.0.1:${PORT}/tests/phone-preview.html`;

    const remind = await openPage(chrome.port, base + "?role=operator");
    await remind.page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await waitReady(remind.page, 12000);
    const banner = await evalJson(remind.page, "document.querySelector('.swremind')?.innerText || ''");
    assert.match(banner, /SWMS need/);
    assert.match(banner, /due soon/);
    assert.doesNotMatch(banner, /Sam/);
    writeFileSync(`${shots}/swms_phone_reminder.png`, await shot(remind.page, { x: 0, y: 0, width: 390, height: 844, scale: 1 }));
    await evalJson(remind.page, "document.querySelector('.swremind')?.click()");
    await sleep(200);
    const list = await evalJson(remind.page, "document.querySelector('.swlist')?.innerText || ''");
    assert.match(list, /Expired/);
    assert.match(list, /Due soon/);
    assert.match(list, /Not signed|Re-sign/);
    assert.doesNotMatch(list, /Download signed PDF/);
    assert.doesNotMatch(list, /Sam/);
    assert.deepEqual(remind.errors, []);

    const sign = await openPage(chrome.port, base + "?role=operator&open=sign");
    await sign.page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await waitReady(sign.page, 15000);
    const form = await evalJson(sign.page, `(() => {
      const job = document.querySelector('#swjob');
      const opt = job && job.selectedOptions[0];
      return {
        enabled: document.querySelector('#swgo') ? !document.querySelector('#swgo').disabled : false,
        name: document.querySelector('#swnm')?.value || '',
        job: opt ? opt.textContent : '',
        note: document.querySelector('#swph')?.textContent || '',
        ink: document.querySelector('.swsignov')?.classList.contains('inked') || false,
        err: document.querySelector('#swerr')?.textContent || '',
      };
    })()`);
    assert.equal(form.enabled, true, JSON.stringify(form));
    assert.equal(form.name, "Patrick");
    assert.match(form.job, /Brightvale/);
    assert.match(form.note, /placeholder, not the SWMS/);
    assert.equal(form.ink, true);
    writeFileSync(`${shots}/swms_phone_sign.png`, await shot(sign.page, { x: 0, y: 0, width: 390, height: 844, scale: 1 }));
    await evalJson(sign.page, "document.querySelector('#swgo').click()");
    await sleep(250);
    const saved = await evalJson(sign.page, `JSON.stringify((window.__fbCalls || []).filter(c => c.op === 'addDoc' && c.col === 'swmsSignatures').map(c => c.data))`);
    const rec = JSON.parse(saved).at(-1);
    assert.ok(rec, saved);
    assert.equal(rec.uid, "patrick");
    assert.equal(rec.name, "Patrick");
    assert.equal(rec.swmsId, "electrical");
    assert.equal(rec.jobId, "j2");
    assert.match(rec.jobLabel, /2402/);
    assert.match(rec.jobLabel, /Brightvale/);
    assert.equal(rec.version, "2026-07");
    assert.equal(typeof rec.signedAtMs, "number");
    assert.ok(rec.expiresAtMs > rec.signedAtMs);
    assert.deepEqual(sign.errors, []);

    const admin = await openPage(chrome.port, base + "?role=admin&open=adminswms");
    await admin.page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await waitReady(admin.page, 12000);
    const team = await evalJson(admin.page, "document.querySelector('.swpeople')?.innerText || ''");
    assert.match(team, /Alex/);
    assert.match(team, /Patrick/);
    assert.match(team, /Sam/);
    assert.match(team, /Not signed/);
    assert.match(team, /Expired/);
    assert.match(team, /Due /);
    assert.match(team, /Old version/);
    const flags = await evalJson(admin.page, "document.body.innerText");
    assert.match(flags, /overdue or missing/);
    assert.match(flags, /Download signed PDF/);
    const box = await evalJson(admin.page, `(() => {
      const el = [...document.querySelectorAll('.swh')].find(n => n.textContent.includes('Team status'));
      const r = el.getBoundingClientRect();
      return { y: Math.max(0, r.top + window.scrollY - 8), h: Math.min(1500, document.querySelector('.swpeople').offsetHeight + 90) };
    })()`);
    writeFileSync(`${shots}/swms_phone_admin.png`, await shot(admin.page, { x: 0, y: box.y, width: 390, height: Math.max(844, box.h), scale: 1 }));
    assert.deepEqual(admin.errors, []);

    const pdf = await openPage(chrome.port, base + "?role=admin&open=swmspdf");
    await pdf.page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await waitReady(pdf.page, 15000);
    const ready = await evalJson(pdf.page, `(() => {
      const t = document.querySelector('.swdlov')?.innerText || '';
      const meta = window.HW_LAST_PDF || null;
      return { text: t, placeholder: !!(meta && meta.placeholder), name: meta && meta.name, size: meta && meta.size };
    })()`);
    assert.match(ready.text, /Placeholder cover only/);
    assert.match(ready.text, /do not send this file to a client as the SWMS/i);
    assert.equal(ready.placeholder, true);
    assert.match(ready.name, /Working_near_roads/);
    const b64 = await evalJson(pdf.page, `(async () => {
      const buf = await (await fetch(window.HW_LAST_PDF.url)).arrayBuffer();
      const bytes = new Uint8Array(buf);
      let s = '';
      const chunk = 0x2000;
      for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
      return btoa(s);
    })()`);
    const file = Buffer.from(b64, "base64");
    assert.equal(file.subarray(0, 5).toString(), "%PDF-");
    writeFileSync(`${shots}/swms_signed.pdf`, file);
    writeFileSync(`${shots}/swms_phone_pdf_ready.png`, await shot(pdf.page, { x: 0, y: 0, width: 390, height: 844, scale: 1 }));
    assert.deepEqual(pdf.errors, []);
  } finally {
    chrome.proc.kill("SIGKILL");
    server.kill("SIGKILL");
  }
});
