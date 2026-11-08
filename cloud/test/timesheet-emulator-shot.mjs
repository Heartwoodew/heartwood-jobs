// Phone screenshots of the timesheet against the local emulators. Fake data only.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { launchChrome, openPage } from "../../tests/browse.mjs";

const password = "test-pass-123";
const samEmail = "sam.timesheet@heartwood.test";
const rileyEmail = "riley.timesheet@heartwood.test";
const alexEmail = "alex.timesheet@heartwood.test";

async function signUp(address) {
  const res = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: address, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error("sign up failed " + JSON.stringify(body));
  return body.localId;
}
function at(iso) { return Timestamp.fromDate(new Date(iso)); }
function entry(partial) {
  return {
    status: "closed", start: "07:00", finish: "15:30", breakStart: "", breakEnd: "", note: "", job: "",
    edits: {}, lastEditId: "", ...partial,
  };
}

async function shot(page, name) {
  await sleep(350);
  const png = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = `/opt/cursor/artifacts/${name}.png`;
  writeFileSync(path, Buffer.from(png.data, "base64"));
  console.log("wrote", path);
}
async function waitFor(page, needle, ms = 12000) {
  const start = Date.now();
  let text = "";
  while (Date.now() - start < ms) {
    const read = await page.send("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true });
    text = read.result?.value || "";
    if (text.includes(needle)) return text;
    await sleep(200);
  }
  throw new Error("missing " + JSON.stringify(needle) + " in " + text.slice(0, 500));
}
async function signIn(page, email) {
  await page.send("Page.navigate", { url: "http://127.0.0.1:8788/app/index.html?emu=1" });
  const start = Date.now();
  let logged = false;
  while (Date.now() - start < 20000) {
    const hasLogin = await page.send("Runtime.evaluate", { expression: "!!document.querySelector('#login')", returnByValue: true });
    const ready = await page.send("Runtime.evaluate", { expression: "!!document.querySelector('#logout') && !document.querySelector('#logout').classList.contains('hidden')", returnByValue: true });
    if (ready.result?.value) return;
    if (hasLogin.result?.value && !logged) {
      logged = true;
      await page.send("Runtime.evaluate", {
        expression: `(() => { const f = document.querySelector('#login'); f.e.value = ${JSON.stringify(email)}; f.p.value = ${JSON.stringify(password)}; f.requestSubmit(); })()`,
      });
    }
    await sleep(200);
  }
  throw new Error("sign in failed for " + email);
}

async function main() {
  const samId = await signUp(samEmail);
  const rileyId = await signUp(rileyEmail);
  const alexId = await signUp(alexEmail);
  const env = await initializeTestEnvironment({
    projectId: "demo-heartwood",
    firestore: { rules: readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8") },
    storage: { rules: readFileSync(new URL("../emulator/storage.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", samId), { name: "Sam", role: "operator" });
    await setDoc(doc(db, "users", rileyId), { name: "Riley", role: "operator" });
    await setDoc(doc(db, "users", alexId), { name: "Alex", role: "admin" });
    const samClock = entry({
      id: "entry0006clock", source: "clock", date: "2026-11-06", start: "06:58", finish: "15:04",
      breakStart: "12:00", breakEnd: "12:30", job: "Lot 12 Brightvale", note: "Slab",
      enteredBy: samId, enteredByName: "Sam", enteredAt: at("2026-11-05T20:58:00Z"),
      clockOn: { at: at("2026-11-05T20:58:00Z"), fix: "gps", lat: -27.47, lng: 153.025, accuracy: 12 },
      clockOff: { at: at("2026-11-06T05:04:00Z"), fix: "gps", lat: -27.4712, lng: 153.0264, accuracy: 18 },
      breakOn: { at: at("2026-11-06T02:00:00Z"), fix: "no location" },
      breakOff: { at: at("2026-11-06T02:30:00Z"), fix: "gps", lat: -27.4704, lng: 153.0255, accuracy: 9 },
    });
    const samManual = entry({
      id: "entry0007manual", source: "manual", date: "2026-11-07", start: "07:00", finish: "15:30",
      job: "Depot", note: "Yard tidy", enteredBy: samId, enteredByName: "Sam", enteredAt: at("2026-11-07T07:05:00Z"),
    });
    await setDoc(doc(db, "timesheets", `${samId}_2026-11-02`), {
      uid: samId, name: "Sam", weekStart: "2026-11-02", weekEnd: "2026-11-08",
      days: {}, totalHrs: 16, updatedAt: at("2026-11-07T07:05:00Z"), updatedAtIso: "2026-11-07T07:05:00.000Z",
      entries: { entry0006clock: samClock, entry0007manual: samManual }, lastEntryId: "entry0007manual",
    });
    const rileyClock = entry({
      id: "entry0004riley", source: "clock", date: "2026-11-04", start: "07:01", finish: "15:11",
      job: "Creek Rd", note: "", enteredBy: rileyId, enteredByName: "Riley", enteredAt: at("2026-11-03T21:01:00Z"),
      clockOn: { at: at("2026-11-03T21:01:00Z"), fix: "no location" },
      clockOff: { at: at("2026-11-04T05:11:00Z"), fix: "no location" },
    });
    await setDoc(doc(db, "tenants/heartwood/fleet/ex1"), { type: "plant", name: "Excavator", rego: "EX 101", prestartKind: "excavator" });
    await setDoc(doc(db, "tenants/heartwood/fleet/ute1"), { type: "vehicle", name: "Colorado ute", rego: "UT 202", prestartKind: "ute" });
    await setDoc(doc(db, "tenants/heartwood/prestarts/done-ex1"), {
      assetId: "ex1", assetName: "Excavator", day: "2026-11-08", signerUid: samId, signerName: "Sam",
      signedAt: at("2026-11-07T21:05:00Z"),
    });
    await setDoc(doc(db, "timesheets", `${rileyId}_2026-11-02`), {
      uid: rileyId, name: "Riley", weekStart: "2026-11-02", weekEnd: "2026-11-08",
      days: {}, totalHrs: 7.7, updatedAt: at("2026-11-04T05:11:00Z"), updatedAtIso: "2026-11-04T05:11:00.000Z",
      entries: { entry0004riley: rileyClock }, lastEntryId: "entry0004riley",
    });
  });

  const probe = initializeApp({ apiKey: "demo-key", projectId: "demo-heartwood" }, "probe");
  const auth = getAuth(probe);
  const db = getFirestore(probe);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  await signInWithEmailAndPassword(auth, samEmail, password);
  const own = await getDoc(doc(db, "timesheets", `${samId}_2026-11-02`));
  if (!own.exists()) throw new Error("sam cannot read his sheet");
  let blocked = false;
  try { await getDoc(doc(db, "timesheets", `${rileyId}_2026-11-02`)); } catch { blocked = true; }
  if (!blocked) throw new Error("sam could read Riley's sheet");
  await signOut(auth);

  mkdirSync("/opt/cursor/artifacts", { recursive: true });
  const server = spawn("python3", ["-m", "http.server", "8788", "--bind", "127.0.0.1"], {
    cwd: new URL("../..", import.meta.url).pathname,
    stdio: "ignore",
  });
  const chrome = await launchChrome(9344);
  try {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch("http://127.0.0.1:8788/app/index.html")).ok) break; } catch { /* booting */ }
      await sleep(100);
    }
    const { page, errors } = await openPage(chrome.port, "about:blank");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await signIn(page, samEmail);
    await waitFor(page, "More");
    const opened = await page.send("Runtime.evaluate", { expression: "const b = document.querySelector('[data-tab=\"more\"]'); if (!b) 'missing'; else { b.click(); 'ok'; }", returnByValue: true });
    if (opened.result?.value !== "ok") throw new Error("more tab missing");
    await waitFor(page, "Clock on, or add hours manually");
    await page.send("Runtime.evaluate", { expression: "document.querySelector('[data-go=\"hours\"]').click()", returnByValue: true });
    await waitFor(page, "Clock on");
    await waitFor(page, "Yard tidy");
    await shot(page, "timesheet_worker_clock");
    await page.send("Runtime.evaluate", { expression: "document.querySelectorAll('.ts-entry')[1]?.scrollIntoView({ block: 'start' })" });
    await shot(page, "timesheet_worker_manual");
    await page.send("Runtime.evaluate", { expression: "window.scrollTo(0, 0)" });
    await page.send("Emulation.setGeolocationOverride", { latitude: -27.47, longitude: 153.025, accuracy: 14 });
    try { await page.send("Browser.grantPermissions", { origin: "http://127.0.0.1:8788", permissions: ["geolocation"] }); } catch { /* page target may not grant */ }
    await page.send("Runtime.evaluate", { expression: `(() => {
      window.__geo = 0;
      const geo = navigator.geolocation;
      const orig = geo.getCurrentPosition.bind(geo);
      const wrapped = function(ok, err, opts) { window.__geo += 1; orig(ok, err, opts); };
      try { Object.defineProperty(geo, "getCurrentPosition", { configurable: true, value: wrapped }); }
      catch (e) { window.__geoWrap = String(e); }
    })()` });
    await page.send("Runtime.evaluate", { expression: "document.querySelector('#tsclockon')?.click()", returnByValue: true });
    const consent = await waitFor(page, "does not track your location in the background");
    const geoDuringConsent = await page.send("Runtime.evaluate", { expression: "window.__geo", returnByValue: true });
    if (geoDuringConsent.result?.value !== 0) throw new Error("location ran before consent: " + consent.slice(0, 200));
    await shot(page, "timesheet_clock_consent");
    await page.send("Runtime.evaluate", { expression: "window.__toasts = []; setInterval(() => { const t = document.querySelector('#toast'); if (t && !t.classList.contains('hidden')) window.__toasts.push(t.textContent); }, 100);" });
    const agreed = await page.send("Runtime.evaluate", {
      expression: "(() => { const b = document.querySelector('.ts-consent .ts-go'); if (!b) return 'missing ' + (document.querySelector('.ts-consent')?.innerHTML || 'no-panel').slice(0, 180); b.click(); return 'ok ' + b.id; })()",
      returnByValue: true,
    });
    if (agreed.result?.value !== "ok tsagree") throw new Error("agree button: " + agreed.result?.value);
    const started = Date.now();
    let clocked = false;
    while (Date.now() - started < 20000) {
      const state = await page.send("Runtime.evaluate", { expression: "({ off: !!document.querySelector('#tsclockoff'), toast: window.__toasts || [], geo: window.__geo, text: document.querySelector('.ts-live')?.textContent || '' })", returnByValue: true });
      const v = state.result?.value || {};
      if (v.off) { clocked = true; break; }
      if ((v.toast || []).some(t => String(t).startsWith("Not saved"))) throw new Error("clock on rejected: " + JSON.stringify(v));
      await sleep(200);
    }
    if (!clocked) {
      const v = await page.send("Runtime.evaluate", { expression: "JSON.stringify({ toast: window.__toasts, geo: window.__geo, wrap: window.__geoWrap, live: document.querySelector('.ts-live')?.textContent })", returnByValue: true });
      throw new Error("did not clock on " + v.result?.value + " errors " + errors.join(" | "));
    }
    await waitFor(page, "Which machine are you on today?");
    await waitFor(page, "Excavator");
    await page.send("Runtime.evaluate", { expression: "window.scrollTo(0, 0)" });
    await shot(page, "timesheet_machine_prompt");
    const clicked = await page.send("Runtime.evaluate", { expression: "(() => { const b = [...document.querySelectorAll('.tsmach')].find(el => el.textContent.includes('Excavator')); if (!b) return 'missing'; b.click(); return b.dataset.asset + '|' + b.dataset.name; })()", returnByValue: true });
    console.log("clicked", clicked.result?.value);
    await sleep(1500);
    const after = await page.send("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true });
    if (!(after.result?.value || "").includes("Prestart done")) {
      throw new Error("after machine click: " + (after.result?.value || "").slice(0, 1200));
    }
    await page.send("Runtime.evaluate", { expression: "document.querySelector('.ts-prestart')?.scrollIntoView({ block: 'center' })" });
    await shot(page, "timesheet_prestart_done");
    await waitFor(page, "±14 m");
    const geoAfter = await page.send("Runtime.evaluate", { expression: "window.__geo", returnByValue: true });
    if (geoAfter.result?.value !== 1) throw new Error("expected one GPS fix, got " + geoAfter.result?.value);
    await page.send("Runtime.evaluate", { expression: "document.querySelector('.ts-entry:last-of-type')?.scrollIntoView({ block: 'center' })" });
    await shot(page, "timesheet_clocked_on");
    await page.send("Runtime.evaluate", { expression: "document.querySelector('#logout').click()" });
    await waitFor(page, "Sign in");
    await signIn(page, alexEmail);
    await page.send("Runtime.evaluate", { expression: "document.querySelector('#burger')?.click()", returnByValue: true });
    await sleep(200);
    await page.send("Runtime.evaluate", { expression: "document.querySelector('[data-grp=\"money\"]')?.click()", returnByValue: true });
    await sleep(200);
    await page.send("Runtime.evaluate", { expression: "document.querySelector('[data-view=\"timesheet\"]')?.click()", returnByValue: true });
    await waitFor(page, "no location");
    await waitFor(page, "Yard tidy");
    await page.send("Runtime.evaluate", { expression: "const s = document.querySelector('#tsstaff'); if (s) { const o = [...s.options].find(x => x.textContent === 'Sam'); s.value = o.value; s.dispatchEvent(new Event('change')); }" });
    await waitFor(page, "Lot 12");
    await shot(page, "timesheet_admin");
    if (errors.length) console.warn("page errors", errors);
  } finally {
    chrome.proc.kill("SIGKILL");
    server.kill("SIGKILL");
    await env.cleanup();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
