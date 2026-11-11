// Mobile + desktop shots of quote extra items. Preview stub only (fake data, no live project, no network).
// node tests/quote-extras-shots.mjs [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { launchChrome, openPage, waitReady, shot } from "./browse.mjs";
import { calcQuote, customerQuoteHtml } from "../app/features/quotes.js";

const PORT = 8807;
const out = process.argv[2] || "/opt/cursor/artifacts";
mkdirSync(out, { recursive: true });

async function waitServer() {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/tests/phone-preview.html`)).ok) return; } catch { /* */ }
    await sleep(100);
  }
  throw new Error("preview server did not start");
}

// Runs in the page: open the wizard, fill job + setup, add extras, adjust a price.
const DRIVE = role => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (sel, ms = 4000) => { const t = performance.now(); while (performance.now() - t < ms) { const el = document.querySelector(sel); if (el) return el; await sleep(30); } throw new Error("missing " + sel); };
  const fire = (el, v) => { el.value = v; el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); };
  if (${JSON.stringify(role)} === "admin") { (await waitFor('[data-view="quotes"]')).click(); }
  else { document.querySelector('[data-tab="more"]').click(); await sleep(40); (await waitFor('[data-go="quotes"]')).click(); }
  (await waitFor("#newquote")).click();
  await waitFor("#qwf");
  document.querySelector("[name=address]").value = "Lot 12 · 4 Cedar Court, Redbank Plains QLD 4301";
  document.querySelector("[name=hoursOnSite]").value = "4";
  document.querySelector("#qwnext").click(); await sleep(40);
  const p = document.querySelector('[name=preset][value=truck_skid]'); p.checked = true; p.dispatchEvent(new Event("change")); await sleep(30);
  document.querySelector("#qwnext").click(); await sleep(60);
  for (const k of ["rubbish", "concrete", "material", "misc"]) { (await waitFor('[data-xadd="' + k + '"]')).click(); await sleep(40); }
  const row = i => document.querySelector('[data-xi="' + i + '"]');
  const f = (i, n) => row(i).querySelector('[data-xf="' + n + '"]');
  fire(f(0, "qty"), "6"); fire(f(0, "unit"), "m3"); fire(f(0, "unitPrice"), "55"); fire(f(0, "material"), "Green waste");
  fire(f(1, "qty"), "3"); fire(f(1, "unit"), "t"); fire(f(1, "unitPrice"), "120"); fire(f(1, "note"), "Reinforced slab, break-up needed");
  fire(f(2, "material"), "Road base"); fire(f(2, "qty"), "10"); fire(f(2, "unit"), "t"); fire(f(2, "unitPrice"), "42.50");
  fire(f(3, "description"), "Traffic control"); fire(f(3, "unitPrice"), "250"); fire(f(3, "note"), "Half day, Cedar Ct entry");
  const ov = document.querySelector('[data-ov="machine:truck"]');
  if (ov) { ov.closest("details").open = true; fire(ov, "360"); }
  await sleep(60);
  return JSON.stringify({
    sum: document.querySelector("#qwsum")?.innerText || "",
    accept: !document.querySelector("#qwaccept")?.disabled,
    hasOv: !!ov, errs: window.__errs || []
  });
})()`;

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore" });
const chrome = await launchChrome(9387);
const results = {};
try {
  await waitServer();
  const runs = [
    ["quote-extras-admin-desktop", "admin", 1280, 900],
    ["quote-extras-admin-mobile", "admin", 390, 844],
    ["quote-extras-supervisor-mobile", "supervisor", 390, 844],
  ];
  for (const [name, role, width, height] of runs) {
    const { page, errors } = await openPage(chrome.port, `http://127.0.0.1:${PORT}/tests/phone-preview.html?role=${role}`);
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 800 });
    await waitReady(page, 12000);
    const r = await page.send("Runtime.evaluate", { expression: DRIVE(role), awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(name + ": " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    const data = JSON.parse(r.result.value);
    if (errors.length || data.errs.length) throw new Error(name + " errors: " + [...errors, ...data.errs].join("\n"));
    results[name] = data;
    // The wizard scrolls inside the dialog: take one frame per screenful, top to bottom (what the user sees).
    const scroller = `(() => { const d = document.querySelector("#dlg"); return [d, ...d.querySelectorAll("*")].find(el => el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY)); })()`;
    const meta = JSON.parse((await page.send("Runtime.evaluate", { expression: `(() => { const el = ${scroller}; return JSON.stringify(el ? { sh: el.scrollHeight, ch: el.clientHeight } : { sh: 0, ch: 0 }); })()`, returnByValue: true })).result.value);
    const frames = meta.sh ? Math.min(8, Math.ceil(meta.sh / Math.max(1, meta.ch - 60))) : 1;
    for (let i = 0; i < frames; i++) {
      await page.send("Runtime.evaluate", { expression: `(() => { const el = ${scroller}; if (el) el.scrollTop = ${i} * (el.clientHeight - 60); })()` });
      await sleep(80);
      writeFileSync(`${out}/${name}-${i + 1}.png`, await shot(page, { x: 0, y: 0, width, height, scale: 1 }));
    }
    results[name].frames = frames;
    page.close();
  }
  // Accept → job: the job carries extras on job.quote, price-free amounts, and a description with no dollars.
  {
    const { page, errors } = await openPage(chrome.port, `http://127.0.0.1:${PORT}/tests/phone-preview.html?role=admin`);
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitReady(page, 12000);
    await page.send("Runtime.evaluate", { expression: DRIVE("admin"), awaitPromise: true, returnByValue: true });
    const r = await page.send("Runtime.evaluate", { expression: `(async () => {
      document.querySelector("#qwaccept").click();
      await new Promise(r => setTimeout(r, 400));
      const calls = window.__fbCalls || [];
      const q = calls.find(c => c.op === "addDoc" && c.col === "quotes");
      const j = calls.find(c => c.op === "addDoc" && c.col === "jobs");
      return JSON.stringify({ q: q && q.data, j: j && j.data });
    })()`, awaitPromise: true, returnByValue: true });
    const { q, j } = JSON.parse(r.result.value);
    if (!q || !j) throw new Error("accept did not write a quote and a job");
    if (q.extraItems.length !== 4 || q.priceOverrides["machine:truck"] !== 360) throw new Error("quote extras/overrides not saved");
    if (q.totalEx !== 2085 || q.gst !== 208.5 || q.totalInc !== 2293.5) throw new Error("quote totals wrong " + [q.totalEx, q.gst, q.totalInc]);
    if (/\$\s?\d/.test(j.description)) throw new Error("job description shows a price: " + j.description);
    if (!j.workAmounts.some(a => /Concrete removal: 3 t/.test(a))) throw new Error("job amounts missing");
    if (j.quote.extraItems.length !== 4 || j.quoteAmount !== 2085) throw new Error("job quote snapshot wrong");
    if (errors.length) throw new Error(errors.join("\n"));
    results.acceptToJob = { description: j.description, workAmounts: j.workAmounts, quoteAmount: j.quoteAmount };
    page.close();
  }
  // Places dropdown with a fake library (no Google call): suggestions show, a pick fills the address + place.
  {
    const { page, errors } = await openPage(chrome.port, `http://127.0.0.1:${PORT}/tests/phone-preview.html?role=supervisor`);
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await waitReady(page, 12000);
    const r = await page.send("Runtime.evaluate", { expression: `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      document.querySelector('[data-tab="more"]').click(); await sleep(40);
      document.querySelector('[data-go="quotes"]').click(); await sleep(200);
      document.querySelector("#newquote").click(); await sleep(200);
      const { attachAddressSearch } = await import("../app/features/places.js");
      const addrs = ["4 Cedar Court, Redbank Plains QLD 4301, Australia", "4 Cedar Court, Springfield Lakes QLD 4300, Australia", "4 Cedar Ct, Brassall QLD 4305, Australia"];
      const fake = {
        AutocompleteSessionToken: function () {},
        AutocompleteSuggestion: { fetchAutocompleteSuggestions: async req => { window.__plcReq = req; return { suggestions: addrs.map((a, i) => ({ placePrediction: { text: { toString: () => a }, toPlace: () => ({ id: "fake" + i, formattedAddress: a, location: { lat: () => -27.65 - i / 100, lng: () => 152.87 }, fetchFields: async () => {} }) } })) }; } }
      };
      let picked = null;
      const input = document.querySelector("[name=address]");
      attachAddressSearch(input, { lib: fake, onPick: p => { picked = p; document.querySelector("#qaddrtag").hidden = false; } });
      input.value = "4 Cedar"; input.dispatchEvent(new Event("input")); await sleep(450);
      const shown = [...document.querySelectorAll(".plc-list li[role=option]")].map(li => li.textContent);
      return JSON.stringify({ shown, req: { regions: window.__plcReq.includedRegionCodes, bias: window.__plcReq.locationBias } });
    })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("places: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    const data = JSON.parse(r.result.value);
    if (data.shown.length !== 3 || data.req.regions[0] !== "au") throw new Error("places suggestions wrong " + r.result.value);
    writeFileSync(`${out}/places-suggestions-mobile.png`, await shot(page, { x: 0, y: 0, width: 390, height: 844, scale: 1 }));
    const r2 = await page.send("Runtime.evaluate", { expression: `(async () => {
      document.querySelector(".plc-list li[role=option]").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      return JSON.stringify({ value: document.querySelector("[name=address]").value, tag: !document.querySelector("#qaddrtag").hidden });
    })()`, awaitPromise: true, returnByValue: true });
    const after = JSON.parse(r2.result.value);
    if (!/Redbank Plains/.test(after.value) || !after.tag) throw new Error("places pick failed " + r2.result.value);
    writeFileSync(`${out}/places-picked-mobile.png`, await shot(page, { x: 0, y: 0, width: 390, height: 844, scale: 1 }));
    if (errors.length) throw new Error(errors.join("\n"));
    results.places = { ...data, after };
    page.close();
  }
  // Crew view: run sheet card + job detail show amounts, no prices.
  for (const [name, width, height, open] of [["crew-runsheet-amounts-mobile", 390, 844, false], ["crew-job-amounts-mobile", 390, 844, true]]) {
    const { page, errors } = await openPage(chrome.port, `http://127.0.0.1:${PORT}/tests/phone-preview.html?role=operator&amounts=1`);
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    await waitReady(page, 12000);
    if (open) { await page.send("Runtime.evaluate", { expression: `document.querySelector('.mrow[data-id="j3"]')?.click()` }); await sleep(150); }
    else { await page.send("Runtime.evaluate", { expression: `document.querySelector('.mrow[data-id="j3"]')?.scrollIntoView({block:"center"})` }); await sleep(80); }
    const t = await page.send("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true });
    const text = t.result.value;
    if (!/Concrete removal: 3 t/.test(text)) throw new Error(name + ": amounts missing");
    if (/\$\s?\d/.test(text)) throw new Error(name + ": a price is visible to the crew");
    if (errors.length) throw new Error(name + " " + errors.join("\n"));
    const sy = (await page.send("Runtime.evaluate", { expression: "window.scrollY", returnByValue: true })).result.value;
    writeFileSync(`${out}/${name}.png`, await shot(page, { x: 0, y: sy, width, height, scale: 1 }));
    results[name] = { ok: true };
    page.close();
  }
  // Customer quote page (print / PDF view).
  const calc = calcQuote({
    hoursOnSite: 4, machines: ["truck", "skid"], travelKm: 0, materialQty: 0, tipLoads: 0, priceOverrides: { "machine:truck": 360 },
    extraItems: [
      { id: "a", kind: "rubbish", description: "Rubbish removal", material: "Green waste", qty: 6, unit: "m3", unitPrice: 55 },
      { id: "b", kind: "concrete", description: "Concrete removal", qty: 3, unit: "t", unitPrice: 120, note: "Reinforced slab, break-up needed" },
      { id: "c", kind: "material", description: "Supply and deliver material", material: "Road base", qty: 10, unit: "t", unitPrice: 42.5 }
    ]
  }, { travelPerKm: 2, materialPerUnit: 30, tipPerLoad: 150, machineRates: { truck: { rate: 100, unit: "hour" }, skid: { rate: 80, unit: "hour" } } });
  const html = customerQuoteHtml({ client: "Test Builder Pty Ltd", address: "Lot 12 · 4 Cedar Court, Redbank Plains QLD 4301", description: "Backslab and clean-up", dateIso: "2026-11-11T00:00:00Z" }, calc, { legalName: "TEST Earthworks Pty Ltd", abn: "00 000 000 000" });
  writeFileSync(`${out}/customer-quote.html`, html);
  for (const [name, width] of [["customer-quote-desktop", 1000], ["customer-quote-mobile", 390]]) {
    const { page } = await openPage(chrome.port, "data:text/html;base64," + Buffer.from(html).toString("base64"));
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 800 });
    await sleep(300);
    writeFileSync(`${out}/${name}.png`, await shot(page, { x: 0, y: 0, width, height: 900, scale: 1 }));
    page.close();
  }
  console.log(JSON.stringify(results, null, 1));
} finally {
  chrome.proc.kill("SIGKILL");
  server.kill("SIGKILL");
}
