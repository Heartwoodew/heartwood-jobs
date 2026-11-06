// CallUp guided Quotes (Nov 2026). Prices always ex GST.
// Rates from meta/quoteRates only — never invent business rates.
// Draft/Accepted are explicit quoteStatus fields (legacy sm8Status Quote still maps via app queueOf).
// Admins + app supervisors (canQuote / canSeeMoney). Rate *edits* are admin-only (canEditQuoteRates).
// Depot for travel guidance (Alex, Nov 2026): 208-220 Holdsworth Rd, Chuwar QLD 4306.
// Travel km helper uses Nominatim geocode + OSRM road route when available — never silently substitutes straight-line as billable km.

export const DEFAULT_DEPOT = {
  yardAddress: "208-220 Holdsworth Rd, Chuwar QLD 4306",
  yardMapsUrl: "https://maps.app.goo.gl/w4AX7X6VtPtqH75S7?g_st=ic"
};

const DEFAULT_RATE_KEYS = [
  ["travelPerKm", "Travel $ / km (ex GST)", "km"],
  ["hourlyOnSite", "Time on site $ / hour (ex GST)", "h"],
  ["materialPerUnit", "Materials $ / unit (ex GST)", "unit"],
  ["tipPerLoad", "Rubbish / tip $ / load (ex GST)", "load"]
];

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";
const geoCache = new Map();

let api = null;

export function installQuotes(a) {
  api = a;
  return {
    calcQuote, DEFAULT_RATE_KEYS, DEFAULT_DEPOT, quoteLines, roadDistanceKm,
    bindAdmin: bindAdminExtras,
    openQuoteWizard, openRatesEditor, refreshQuotes, ensureRates,
    adminViewRouter, quotesViewHtml
  };
}

function emptyRates() {
  return {
    travelPerKm: null, hourlyOnSite: null, materialPerUnit: null, tipPerLoad: null,
    materialUnitLabel: "unit", tipUnitLabel: "load",
    yardAddress: DEFAULT_DEPOT.yardAddress,
    yardMapsUrl: DEFAULT_DEPOT.yardMapsUrl,
    updatedAt: null
  };
}

function numOrNull(v) {
  if (v === "" || v == null || Number.isNaN(+v)) return null;
  return Math.round(+v * 100) / 100;
}

function canEditRates() {
  return typeof api.canEditQuoteRates === "function" ? !!api.canEditQuoteRates() : !!(api.isAdmin && api.isAdmin());
}

/** Quote math. If any line with qty > 0 is missing a rate, totalEx is null (not a partial sum). */
export function calcQuote(inputs, rates) {
  const travelKm = Math.max(0, +inputs.travelKm || 0);
  const hours = Math.max(0, +inputs.hoursOnSite || 0);
  const matQty = Math.max(0, +inputs.materialQty || 0);
  const tipLoads = Math.max(0, +inputs.tipLoads || 0);
  const r = rates || {};
  const lines = [
    { key: "travel", label: `Travel ${travelKm} km`, qty: travelKm, rate: r.travelPerKm, amount: r.travelPerKm != null ? travelKm * r.travelPerKm : null },
    { key: "time", label: `Time on site ${hours} h`, qty: hours, rate: r.hourlyOnSite, amount: r.hourlyOnSite != null ? hours * r.hourlyOnSite : null },
    { key: "materials", label: `Materials (${matQty} ${r.materialUnitLabel || "unit"})`, qty: matQty, rate: r.materialPerUnit, amount: r.materialPerUnit != null ? matQty * r.materialPerUnit : null },
    { key: "rubbish", label: `Rubbish removed (${tipLoads} ${r.tipUnitLabel || "load"})`, qty: tipLoads, rate: r.tipPerLoad, amount: r.tipPerLoad != null ? tipLoads * r.tipPerLoad : null }
  ].map(l => ({ ...l, amount: l.amount == null ? null : Math.round(l.amount * 100) / 100 }));
  const missingRates = lines.filter(l => l.qty > 0 && l.rate == null).map(l => l.key);
  const known = lines.filter(l => l.amount != null);
  const totalEx = missingRates.length ? null
    : (known.length ? Math.round(known.reduce((t, l) => t + l.amount, 0) * 100) / 100 : 0);
  return { lines, totalEx, missingRates, travelKm, hours, matQty, tipLoads, complete: !missingRates.length };
}

function quoteLines(calc) { return calc.lines; }

async function ensureRates(force) {
  const ui = api.getUi();
  if (ui.quoteRates && !force) return ui.quoteRates;
  try {
    const s = await api.getDoc(api.doc(api.db, "meta", "quoteRates"));
    ui.quoteRates = s.exists() ? { ...emptyRates(), ...s.data() } : emptyRates();
    // Always keep depot defaults if unset in Firestore (address only — never invent $ rates).
    if (!ui.quoteRates.yardAddress) ui.quoteRates.yardAddress = DEFAULT_DEPOT.yardAddress;
    if (!ui.quoteRates.yardMapsUrl) ui.quoteRates.yardMapsUrl = DEFAULT_DEPOT.yardMapsUrl;
  } catch {
    ui.quoteRates = emptyRates();
  }
  return ui.quoteRates;
}

async function refreshQuotes() {
  const { getDocs, collection, db, getUi } = api;
  try {
    const s = await getDocs(collection(db, "quotes"));
    getUi().quotes = s.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("quotes", e.code || e.message);
    getUi().quotes = getUi().quotes || [];
  }
}

/* ---- road distance (geocode + OSRM). Returns null on failure — never invents km. */
async function geocodeAu(address) {
  const key = String(address || "").trim().toLowerCase();
  if (!key) return null;
  if (geoCache.has(key)) return geoCache.get(key);
  try {
    const cached = JSON.parse(localStorage.getItem("hwQuoteGeo:" + key) || "null");
    if (cached?.lat != null) { geoCache.set(key, cached); return cached; }
  } catch {}
  const ui = api.getUi();
  const wait = Math.max(0, 1100 - (Date.now() - (ui._nomAt || 0)));
  if (wait) await new Promise(r => setTimeout(r, wait));
  ui._nomAt = Date.now();
  const url = `${NOMINATIM}?format=json&limit=1&countrycodes=au&q=${encodeURIComponent(address + ", Queensland, Australia")}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "HeartwoodCallUp-Quotes/1.0 (alex@heartwoodew.com)" } });
    if (!res.ok) return null;
    const arr = await res.json();
    const hit = arr[0] ? { lat: +arr[0].lat, lng: +arr[0].lon } : null;
    geoCache.set(key, hit);
    try { if (hit) localStorage.setItem("hwQuoteGeo:" + key, JSON.stringify(hit)); } catch {}
    return hit;
  } catch { return null; }
}

/** One-way road distance in km via OSRM, or null if routing unavailable. Does not use straight-line as a substitute. */
export async function roadDistanceKm(fromAddress, toAddress) {
  const a = await geocodeAu(fromAddress);
  const b = await geocodeAu(toAddress);
  if (!a || !b) return { km: null, error: "Could not geocode depot or site (Nominatim)." };
  const url = `${OSRM}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { km: null, error: "Road router unavailable (OSRM)." };
    const data = await res.json();
    const metres = data?.routes?.[0]?.distance;
    if (metres == null) return { km: null, error: "No road route found." };
    return { km: Math.round((metres / 1000) * 10) / 10, error: null, source: "OSRM road" };
  } catch {
    return { km: null, error: "Road router request failed." };
  }
}

export function quotesViewHtml(ui, esc, $$, helpers = {}) {
  const rates = ui.quoteRates || emptyRates();
  const list = (ui.quotes || []).slice().sort((a, b) => String(b.updatedAtIso || "").localeCompare(String(a.updatedAtIso || "")));
  const drafts = list.filter(q => q.quoteStatus === "Draft");
  const accepted = list.filter(q => q.quoteStatus === "Accepted").slice(0, 30);
  const rateWarn = DEFAULT_RATE_KEYS.some(([k]) => rates[k] == null);
  const editRates = helpers.canEditQuoteRates != null ? helpers.canEditQuoteRates() : canEditRates();
  const money = v => (v != null && $$) ? `${esc($$(v))} <span class="sub">ex GST</span>` : `<span class="unal">incomplete</span>`;
  const row = q => `<tr class="jr" data-qid="${esc(q.id)}"><td><span class="qpill ${q.quoteStatus === "Draft" ? "q-quote" : "q-wo"}">${esc(q.quoteStatus)}</span></td>
    <td><b>${esc(q.client || "")}</b><div class="sub">${esc(q.address || "")}</div></td>
    <td>${esc(q.description || q.type || "")}</td>
    <td>${q.totalEx != null ? money(q.totalEx) : `<span class="unal">rates needed</span>`}</td>
    <td>${q.quoteStatus === "Draft" ? `<button type="button" class="sm-btn" data-qaccept="${esc(q.id)}">Accept → job</button>` : `<span class="sub">Job ${esc(q.jobId || "—")}</span>`}</td></tr>`;
  return `<div class="sm-head"><h1>Quotes</h1>
    <div class="row gap"><button type="button" class="sm-btn primary" id="newquote">＋ New quote</button>
    ${editRates ? `<button type="button" class="sm-btn" id="editrates">Quote rates &amp; depot</button>` : `<span class="sub pad">Rates are set by an admin · depot ${esc(rates.yardAddress || DEFAULT_DEPOT.yardAddress)}</span>`}</div></div>
    <p class="pad sub">Guided quote: travel → time on site → materials → rubbish removed → price (ex GST). Accepting creates an unscheduled job with the quote kept on it. Admins and supervisors only — staff never see Quotes or dollars.</p>
    <p class="pad sub">Depot (travel start): <b>${esc(rates.yardAddress || DEFAULT_DEPOT.yardAddress)}</b>
      · <a href="${esc(rates.yardMapsUrl || DEFAULT_DEPOT.yardMapsUrl)}" target="_blank" rel="noopener">Maps</a></p>
    ${rateWarn ? `<p class="pad warnt">Set travel, hourly, materials and tip rates before quoting — nothing is invented for you.</p>` : ""}
    <div class="sm-head"><h2>Drafts <span class="cnt">${drafts.length}</span></h2></div>
    <div class="tablewrap"><table class="jobs"><thead><tr><th>Status</th><th>Client / site</th><th>Scope</th><th>Total</th><th></th></tr></thead>
    <tbody>${drafts.map(row).join("") || `<tr><td colspan="5" class="muted pad">No draft quotes yet.</td></tr>`}</tbody></table></div>
    <div class="sm-head"><h2>Recently accepted</h2></div>
    <div class="tablewrap"><table class="jobs"><thead><tr><th>Status</th><th>Client / site</th><th>Scope</th><th>Total</th><th></th></tr></thead>
    <tbody>${accepted.map(row).join("") || `<tr><td colspan="5" class="muted pad">None yet.</td></tr>`}</tbody></table></div>`;
}

function bindAdminExtras(ctx) {
  const { ui, A } = ctx;
  if (ui.view !== "quotes") return;
  ensureRates(false);
  A.querySelector("#newquote")?.addEventListener("click", () => openQuoteWizard(null));
  A.querySelector("#editrates")?.addEventListener("click", () => openRatesEditor());
  A.querySelectorAll("[data-qid]").forEach(b => b.onclick = () => {
    const q = (ui.quotes || []).find(x => x.id === b.dataset.qid);
    if (q) openQuoteWizard(q);
  });
  A.querySelectorAll("[data-qaccept]").forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const q = (ui.quotes || []).find(x => x.id === b.dataset.qaccept);
    if (q) openQuoteWizard(q, { jumpToPrice: true });
  });
}

function openRatesEditor() {
  if (!canEditRates()) return api.toast("Only an admin can change quote rates");
  const { $, esc, toast, db, doc, setDoc, serverTimestamp, getUi, renderAdmin, getMe } = api;
  const me = getMe();
  ensureRates(false).then(rates => {
    const d = $("#dlg"); d.className = ""; d.onclose = () => renderAdmin();
    d.innerHTML = `<form method="dialog" id="qrf" class="jf"><h2>Quote rates &amp; depot</h2>
      <p class="sub">Stored in meta/quoteRates. Dollar rates are ex GST — leave blank until you know them (nothing is invented). Depot is the travel start for Calculate travel.</p>
      ${DEFAULT_RATE_KEYS.map(([k, lab]) => `<label>${esc(lab)}<input name="${k}" type="number" step="0.01" min="0" value="${esc(rates[k] ?? "")}"></label>`).join("")}
      <label>Materials unit label<input name="materialUnitLabel" value="${esc(rates.materialUnitLabel || "unit")}"></label>
      <label>Rubbish unit label<input name="tipUnitLabel" value="${esc(rates.tipUnitLabel || "load")}"></label>
      <label>Depot / yard address<input name="yardAddress" value="${esc(rates.yardAddress || DEFAULT_DEPOT.yardAddress)}"></label>
      <label>Depot Maps link (optional)<input name="yardMapsUrl" value="${esc(rates.yardMapsUrl || DEFAULT_DEPOT.yardMapsUrl)}"></label>
      <div class="btns"><button value="cancel" formnovalidate class="ghost">Cancel</button><button value="save" class="primary">Save</button></div></form>`;
    d.showModal();
    $("#qrf").onsubmit = async ev => {
      if (ev.submitter?.value !== "save") return;
      ev.preventDefault(); const f = ev.target;
      const data = {
        travelPerKm: numOrNull(f.travelPerKm.value), hourlyOnSite: numOrNull(f.hourlyOnSite.value),
        materialPerUnit: numOrNull(f.materialPerUnit.value), tipPerLoad: numOrNull(f.tipPerLoad.value),
        materialUnitLabel: f.materialUnitLabel.value.trim() || "unit", tipUnitLabel: f.tipUnitLabel.value.trim() || "load",
        yardAddress: f.yardAddress.value.trim() || DEFAULT_DEPOT.yardAddress,
        yardMapsUrl: f.yardMapsUrl.value.trim() || DEFAULT_DEPOT.yardMapsUrl,
        updatedAt: serverTimestamp(), updatedBy: me.uid
      };
      try {
        await setDoc(doc(db, "meta", "quoteRates"), data, { merge: true });
        getUi().quoteRates = { ...emptyRates(), ...data, updatedAt: new Date().toISOString() };
        d.close(); toast("Quote rates saved"); renderAdmin();
      } catch (e) { toast("Not saved: " + (e.code || e.message)); }
    };
  });
}

function openQuoteWizard(existing, opts = {}) {
  const { $, esc, toast, db, doc, addDoc, updateDoc, serverTimestamp, getUi, renderAdmin, CLIENTS, TYPES, canSeeMoney, $$, getMe } = api;
  const me = getMe();
  ensureRates(false).then(rates => {
    if (existing?.jobId && existing?.quoteStatus === "Accepted" && opts.jumpToPrice) {
      toast("Already accepted — job kept as " + existing.jobId);
    }
    const state = Object.assign({
      quoteStatus: "Draft", client: CLIENTS[0], type: "spoil", travelKm: "", hoursOnSite: "",
      materialQty: "", tipLoads: "", address: "", description: "",
      travelMode: "oneway", travelNote: ""
    }, existing || {});
    let step = opts.jumpToPrice ? 5 : 0;
    const steps = ["Site", "Travel", "Time on site", "Materials", "Rubbish", "Price"];
    const d = $("#dlg"); d.className = "jobcard"; d.onclose = () => renderAdmin();
    const paint = () => {
      const draft = { ...state };
      const calc = calcQuote(draft, rates);
      const already = !!(existing?.jobId && (existing.quoteStatus === "Accepted" || state.quoteStatus === "Accepted"));
      const canAccept = !already && calc.complete && calc.totalEx != null && !!(draft.client && draft.address);
      d.innerHTML = `<form method="dialog" id="qwf" class="jc qw"><div class="jc-top q-quote"><div><div class="jc-no">${existing ? "Edit quote" : "New quote"}</div>
        <div class="jc-q">Step ${step + 1} of ${steps.length}: ${esc(steps[step])}</div></div>
        <button value="cancel" formnovalidate class="jc-x">✕</button></div>
        <div class="jc-body qw-body"><div class="qw-steps">${steps.map((s, i) => `<span class="qw-dot ${i === step ? "on" : i < step ? "done" : ""}">${i + 1}</span>`).join("<span class=\"qw-line\"></span>")}</div>
        ${stepHtml(step, draft, calc, rates, esc, TYPES, CLIENTS, canSeeMoney, $$)}
        ${step === 5 && !calc.complete ? `<p class="warnt pad">Missing rates for: ${esc(calc.missingRates.join(", "))}. Save as draft, or ask an admin to set rates. Total is not shown as valid until every used line has a rate.</p>` : ""}
        ${already ? `<p class="pad sub">Already accepted → job <b>${esc(existing.jobId)}</b>. Accept will not create another job.</p>` : ""}
        </div>
        <p id="qerr" class="err"></p>
        <div class="btns jc-foot">
          <button type="button" class="sm-btn" id="qwback" ${step === 0 ? "disabled" : ""}>Back</button>
          ${step < 5 ? `<button type="button" class="sm-btn primary" id="qwnext">Next</button>` :
            `<button type="button" class="sm-btn" id="qwsave">Save draft</button>
             <button type="button" class="sm-btn primary" id="qwaccept" ${canAccept ? "" : "disabled"} title="${canAccept ? "" : already ? "Already accepted" : "Complete site + rates first"}">Accept → create job</button>`}
        </div></form>`;
      d.showModal();
      $("#qwback").onclick = () => { syncFormToState(); step--; paint(); };
      $("#qwnext")?.addEventListener("click", () => {
        syncFormToState();
        if (!validateStep(step, state)) return;
        step++; paint();
      });
      $("#qwsave")?.addEventListener("click", () => { syncFormToState(); saveQuote(false); });
      $("#qwaccept")?.addEventListener("click", () => { syncFormToState(); saveQuote(true); });
      $("#qwcalc")?.addEventListener("click", () => calcTravel());
      d.querySelectorAll("[name=travelMode]").forEach(r => r.onchange = () => {
        state.travelMode = r.value;
        if (state._oneWayKm != null) {
          const k = state.travelMode === "return" ? Math.round(state._oneWayKm * 2 * 10) / 10 : state._oneWayKm;
          state.travelKm = String(k);
          state.travelNote = state.travelMode === "return"
            ? `Return road trip ≈ ${k} km (2 × ${state._oneWayKm} km one-way, OSRM)`
            : `One-way road ≈ ${state._oneWayKm} km (OSRM depot → site)`;
          paint();
        }
      });
    };
    const syncFormToState = () => {
      const f = $("#qwf"); if (!f) return;
      if (f.client) state.client = f.client.value.trim();
      if (f.address) state.address = f.address.value.trim();
      if (f.type) state.type = f.type.value;
      if (f.description) state.description = f.description.value.trim();
      if (f.travelKm) state.travelKm = f.travelKm.value;
      if (f.hoursOnSite) state.hoursOnSite = f.hoursOnSite.value;
      if (f.materialQty) state.materialQty = f.materialQty.value;
      if (f.tipLoads) state.tipLoads = f.tipLoads.value;
      const mode = f.querySelector("[name=travelMode]:checked");
      if (mode) state.travelMode = mode.value;
    };
    const validateStep = (s, data) => {
      const err = $("#qerr");
      if (s === 0 && (!data.client || !data.address)) { err.textContent = "Client and site address are required."; return false; }
      err.textContent = ""; return true;
    };
    const calcTravel = async () => {
      syncFormToState();
      const depot = rates.yardAddress || DEFAULT_DEPOT.yardAddress;
      const site = state.address;
      const status = $("#qwtravelst");
      if (!site) { if (status) status.textContent = "Enter the site address on step 1 first."; return; }
      if (status) status.textContent = "Looking up road distance (Nominatim + OSRM)…";
      const r = await roadDistanceKm(depot, site);
      if (r.km == null) {
        if (status) status.textContent = (r.error || "Could not calculate") + " — enter kilometres manually. Straight-line is not used as travel km.";
        return;
      }
      state._oneWayKm = r.km;
      const mode = state.travelMode || "oneway";
      const k = mode === "return" ? Math.round(r.km * 2 * 10) / 10 : r.km;
      state.travelKm = String(k);
      state.travelNote = mode === "return"
        ? `Return road trip ≈ ${k} km (2 × ${r.km} km one-way, ${r.source})`
        : `One-way road ≈ ${r.km} km (${r.source} depot → site)`;
      paint();
    };
    const saveQuote = async (accept) => {
      const data = { ...state }; if (!validateStep(0, data)) return;
      const calc = calcQuote(data, rates);
      if (accept && !calc.complete) { $("#qerr").textContent = "Set quote rates for every used line before accepting."; return; }
      // Idempotent accept: never create a second job for the same quote.
      if (accept && existing?.jobId && existing?.quoteStatus === "Accepted") {
        toast("Already accepted — existing job " + existing.jobId);
        d.close(); renderAdmin(); return;
      }
      const payload = {
        client: data.client, address: data.address, type: data.type, description: data.description,
        travelKm: +data.travelKm || 0, hoursOnSite: +data.hoursOnSite || 0,
        materialQty: +data.materialQty || 0, tipLoads: +data.tipLoads || 0,
        travelMode: data.travelMode || "oneway", travelNote: data.travelNote || "",
        yardAddress: rates.yardAddress || DEFAULT_DEPOT.yardAddress,
        lines: calc.lines, totalEx: calc.complete ? calc.totalEx : null, ratesSnapshot: {
          travelPerKm: rates.travelPerKm, hourlyOnSite: rates.hourlyOnSite,
          materialPerUnit: rates.materialPerUnit, tipPerLoad: rates.tipPerLoad,
          materialUnitLabel: rates.materialUnitLabel, tipUnitLabel: rates.tipUnitLabel,
          yardAddress: rates.yardAddress || DEFAULT_DEPOT.yardAddress
        },
        quoteStatus: accept ? "Accepted" : "Draft", source: "app",
        updatedAt: serverTimestamp(), updatedBy: me.uid, updatedAtIso: new Date().toISOString()
      };
      try {
        let qid = existing?.id;
        if (qid) await updateDoc(doc(db, "quotes", qid), payload);
        else {
          const ref = await addDoc(api.collection(db, "quotes"), { ...payload, createdAt: serverTimestamp(), createdBy: me.uid, createdByName: me.name });
          qid = ref.id;
          existing = { id: qid, ...payload };
        }
        if (accept) {
          // Re-read idempotency in case of double-click
          if (existing?.jobId) { toast("Already accepted"); d.close(); renderAdmin(); return; }
          const jobId = await createJobFromQuote(qid, payload);
          await updateDoc(doc(db, "quotes", qid), { jobId, quoteStatus: "Accepted", acceptedAt: serverTimestamp() });
          toast("Quote accepted — unscheduled job created");
        } else toast("Draft quote saved");
        d.close();
        api.getUi()._quotesFetched = false;
        await refreshQuotes();
        renderAdmin();
      } catch (e) { $("#qerr").textContent = e.code || e.message; }
    };
    paint();
  });
}

function stepHtml(step, d, calc, rates, esc, TYPES, CLIENTS, canSeeMoney, $$) {
  const depot = rates.yardAddress || DEFAULT_DEPOT.yardAddress;
  const maps = rates.yardMapsUrl || DEFAULT_DEPOT.yardMapsUrl;
  if (step === 0) return `<div class="qw-pane"><h4>Who and where</h4>
    <label>Client<input name="client" list="qclients" value="${esc(d.client || "")}" required><datalist id="qclients">${CLIENTS.map(c => `<option value="${esc(c)}">`).join("")}</datalist></label>
    <label>Site address<input name="address" value="${esc(d.address || "")}" required></label>
    <label>Category<select name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${d.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <label>Scope / notes<textarea name="description" rows="3">${esc(d.description || "")}</textarea></label></div>`;
  if (step === 1) return `<div class="qw-pane"><h4>Travel distance</h4>
    <p class="sub">Depot (start): <b>${esc(depot)}</b> · <a href="${esc(maps)}" target="_blank" rel="noopener">Maps link</a></p>
    <p class="sub">Use <b>Calculate travel</b> for a <b>road</b> distance (OSRM) depot → site. Straight-line is never filled in as travel km. Choose one-way or return (return = 2 × one-way). You can still type kilometres yourself.</p>
    <div class="row gap" style="margin:8px 0">
      <label class="ck"><input type="radio" name="travelMode" value="oneway" ${d.travelMode !== "return" ? "checked" : ""}> One-way</label>
      <label class="ck"><input type="radio" name="travelMode" value="return" ${d.travelMode === "return" ? "checked" : ""}> Return (×2)</label>
      <button type="button" class="sm-btn" id="qwcalc">Calculate travel</button>
    </div>
    <p id="qwtravelst" class="sub">${esc(d.travelNote || "")}</p>
    <label>Kilometres (billable)<input name="travelKm" type="number" min="0" step="0.1" value="${esc(d.travelKm)}" inputmode="decimal"></label>
    <p class="sub">Rate: ${rates.travelPerKm != null && canSeeMoney() ? $$(rates.travelPerKm) + "/km ex GST" : "not set yet"}</p></div>`;
  if (step === 2) return `<div class="qw-pane"><h4>Time on site</h4>
    <label>Hours<input name="hoursOnSite" type="number" min="0" step="0.25" value="${esc(d.hoursOnSite)}" inputmode="decimal"></label>
    <p class="sub">Rate: ${rates.hourlyOnSite != null && canSeeMoney() ? $$(rates.hourlyOnSite) + "/h ex GST" : "not set yet"}</p></div>`;
  if (step === 3) return `<div class="qw-pane"><h4>Materials used</h4>
    <label>Quantity (${esc(rates.materialUnitLabel || "unit")})<input name="materialQty" type="number" min="0" step="0.1" value="${esc(d.materialQty)}" inputmode="decimal"></label>
    <p class="sub">Rate: ${rates.materialPerUnit != null && canSeeMoney() ? $$(rates.materialPerUnit) + " each ex GST" : "not set yet"}</p></div>`;
  if (step === 4) return `<div class="qw-pane"><h4>Material / rubbish removed</h4>
    <label>Loads removed<input name="tipLoads" type="number" min="0" step="1" value="${esc(d.tipLoads)}" inputmode="numeric"></label>
    <p class="sub">Tip / disposal rate: ${rates.tipPerLoad != null && canSeeMoney() ? $$(rates.tipPerLoad) + " / load ex GST" : "not set yet"}</p></div>`;
  const lines = calc.lines.map(l => {
    let amt = "—";
    if (l.qty > 0 && l.rate == null) amt = `<span class="unal">rate missing</span>`;
    else if (l.amount != null && canSeeMoney()) amt = esc($$(l.amount));
    else if (l.qty === 0) amt = canSeeMoney() ? esc($$(0)) : "—";
    return `<div class="qw-line-row"><span>${esc(l.label)}</span><b>${amt}</b></div>`;
  }).join("");
  const total = !calc.complete
    ? `<span class="unal">Incomplete — set rates first</span>`
    : (canSeeMoney() ? esc($$(calc.totalEx)) : "—");
  return `<div class="qw-pane"><h4>Calculated quote</h4>
    ${d.travelNote ? `<p class="sub">${esc(d.travelNote)}</p>` : ""}
    <div class="qw-sum">${lines}
    <div class="qw-total"><span>Total ex GST</span><b>${total}</b></div></div>
    <p class="sub">Accepting creates a pending unscheduled job with this quote and amount preserved. GST is not added here.</p></div>`;
}

async function createJobFromQuote(qid, q) {
  const { db, addDoc, collection, serverTimestamp, getMe } = api;
  const me = getMe();
  if (q.totalEx == null) throw new Error("Cannot create job from incomplete quote");
  const desc = [q.description || "", "", "Quoted (ex GST):",
    q.travelNote ? `Travel: ${q.travelNote}` : "",
    ...(q.lines || []).map(l => `• ${l.label}${l.amount != null ? `: $${Number(l.amount).toFixed(2)}` : " (rate missing)"}`),
    `Total ex GST: $${Number(q.totalEx).toFixed(2)}`].filter(Boolean).join("\n");
  const ref = await addDoc(collection(db, "jobs"), {
    client: q.client, address: q.address, type: q.type || "other", description: desc,
    date: "", time: "", status: "Scheduled", assigned: [], assignedNames: [],
    source: "quote", quoteId: qid, quoteStatus: "Accepted",
    quote: {
      travelKm: q.travelKm, hoursOnSite: q.hoursOnSite, materialQty: q.materialQty, tipLoads: q.tipLoads,
      lines: q.lines, totalEx: q.totalEx, travelMode: q.travelMode || "oneway", travelNote: q.travelNote || "",
      yardAddress: q.yardAddress || DEFAULT_DEPOT.yardAddress
    },
    quoteAmount: q.totalEx, poAmount: q.totalEx, poAmountBasis: "accepted quote (ex GST)", poAmountSource: "quote",
    log: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: me.uid, editedInApp: true
  });
  return ref.id;
}

export function adminViewRouter(view, ui, helpers) {
  if (view !== "quotes") return null;
  if (!ui._quotesFetched) {
    ui._quotesFetched = true;
    Promise.all([refreshQuotes(), ensureRates(false)]).finally(() => {
      helpers.rerender();
    });
  }
  return quotesViewHtml(ui, helpers.esc, helpers.$$, helpers);
}
