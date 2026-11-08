// Phone screenshots of Helper. Firebase is not contacted. The model reply is mocked.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { launchChrome, openPage, waitReady, shot } from "./browse.mjs";

const PORT = 8783;
const shots = "/opt/cursor/artifacts";
mkdirSync(shots, { recursive: true });

async function waitServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/tests/helper-preview.html`);
      if (res.ok) return;
    } catch { /* booting */ }
    await sleep(100);
  }
  throw new Error("preview server did not start");
}

async function text(page, expression) {
  const info = await page.send("Runtime.evaluate", { expression, returnByValue: true });
  return info.result.value;
}

async function click(page, selector) {
  const ok = await text(page, `(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return false; n.click(); return true; })()`);
  assert.equal(ok, true, selector);
}

test("phone helper answers, hides prices, and speaks only with an Australian voice", async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  const chrome = await launchChrome(9353);
  try {
    await waitServer();
    const base = `http://127.0.0.1:${PORT}/tests/helper-preview.html`;
    async function open(query) {
      const { page, errors } = await openPage(chrome.port, base + query);
      await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await waitReady(page, 12000);
      return { page, errors };
    }

    const closed = await open("?voice=other");
    assert.deepEqual(closed.errors, []);
    const job = await text(closed.page, "document.querySelector('[data-demo-job]')?.innerText || ''");
    assert.match(job, /12 Ironbark Street/);
    assert.equal(job.includes("$"), false);
    const launch = await text(closed.page, "document.querySelector('.helper-launch')?.innerText || ''");
    assert.equal(launch, "Helper");
    const closedShot = await shot(closed.page, { x: 0, y: 0, width: 390, height: 844, scale: 1 });
    writeFileSync(`${shots}/helper-phone-button.png`, closedShot);

    const chat = await open("?open=1&voice=other");
    assert.deepEqual(chat.errors, []);
    await text(chat.page, `document.querySelector('.helper-input').value = ${JSON.stringify("How do I add a job?")}`);
    await click(chat.page, ".helper-send");
    for (let i = 0; i < 40; i++) {
      const body = await text(chat.page, "document.querySelector('.helper-log')?.innerText || ''");
      if (body.includes("can't create a job")) break;
      await sleep(50);
    }
    await text(chat.page, `document.querySelector('.helper-input').value = ${JSON.stringify("What am I on at Ironbark?")}`);
    await click(chat.page, ".helper-send");
    let log = "";
    for (let i = 0; i < 40; i++) {
      log = await text(chat.page, "document.querySelector('.helper-log')?.innerText || ''");
      if (log.includes("12 Ironbark Street") && log.includes("12 November 2026")) break;
      await sleep(50);
    }
    const panel = await text(chat.page, "document.querySelector('.helper-panel')?.innerText || ''");
    assert.match(log, /can't create a job/);
    assert.match(log, /12 Ironbark Street/);
    assert.match(log, /12 November 2026/);
    assert.match(log, /12\.5 km/);
    assert.match(log, /2468/);
    assert.match(panel, /placeholder/);
    assert.equal(panel.includes("$"), false);
    assert.equal(log.includes("9999"), false);
    assert.equal(await text(chat.page, "document.querySelector('.helper-input').value"), "");
    assert.equal(await text(chat.page, "document.querySelectorAll('[data-act=play]').length"), 0);
    const chatShot = await shot(chat.page, { x: 0, y: 0, width: 390, height: 844, scale: 1 });
    writeFileSync(`${shots}/helper-phone-chat.png`, chatShot);

    await click(chat.page, ".helper-speech");
    const note = await text(chat.page, "document.querySelector('.helper-voice-note')?.innerText || ''");
    assert.equal(note, "Australian voice not available on this device");
    const afterToggle = await text(chat.page, "document.querySelector('.helper-log')?.innerText || ''");
    assert.match(afterToggle, /12 Ironbark Street/);
    assert.equal(await text(chat.page, "document.querySelectorAll('[data-act=play]').length"), 0);
    assert.equal(await text(chat.page, "window.__synth.calls.length"), 0);
    assert.equal((await text(chat.page, "document.body.innerText")).includes("Australian English"), false);
    const voiceShot = await shot(chat.page, { x: 0, y: 0, width: 390, height: 844, scale: 1 });
    writeFileSync(`${shots}/helper-phone-voice-missing.png`, voiceShot);

    const speak = await open("?open=1&voice=au");
    assert.deepEqual(speak.errors, []);
    await text(speak.page, `document.querySelector('.helper-input').value = ${JSON.stringify("What am I on at Ironbark?")}`);
    await click(speak.page, ".helper-send");
    for (let i = 0; i < 40; i++) {
      const body = await text(speak.page, "document.querySelector('.helper-log')?.innerText || ''");
      if (body.includes("Gate code 2468")) break;
      await sleep(50);
    }
    await click(speak.page, ".helper-speech");
    assert.equal(await text(speak.page, "window.__synth.calls.length"), 0);
    assert.equal(await text(speak.page, "document.querySelector('.helper-voice-note')"), null);
    await click(speak.page, "[data-act=play]");
    const calls = JSON.parse(await text(speak.page, "JSON.stringify(window.__synth.calls)"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].lang, "en-AU");
    assert.equal(calls[0].voiceLang, "en-AU");
    assert.match(calls[0].text, /12 Ironbark Street/);
    const stopped = await text(speak.page, "window.__synth.cancelled");
    await click(speak.page, "[data-act=stop]");
    const stoppedAfter = await text(speak.page, "window.__synth.cancelled");
    assert.equal(stoppedAfter, stopped + 1);
    const playShot = await shot(speak.page, { x: 0, y: 0, width: 390, height: 844, scale: 1 });
    writeFileSync(`${shots}/helper-phone-play.png`, playShot);
  } finally {
    chrome.proc.kill("SIGKILL");
    server.kill("SIGKILL");
  }
});
