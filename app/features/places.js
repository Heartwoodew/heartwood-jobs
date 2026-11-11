// Google Places address search for the quote site address (Places API New: AutocompleteSuggestion + Place.fetchFields).
// Restricted to Australia, biased to South East Queensland. Off (plain typing) when no key is configured,
// when the script fails to load, or when Google rejects the key / API — the input keeps working either way.
import { mapsConfig } from "../maps-config.js";

// SE QLD: roughly Toowoomba to the coast, Gympie to the NSW border.
export const SEQ_BOUNDS = { south: -28.35, west: 151.8, north: -26.1, east: 153.65 };
const LOAD_TIMEOUT_MS = 8000;
let loadP = null;
let failed = "";

export function placesEnabled(cfg = mapsConfig) {
  return !failed && !!(cfg && typeof cfg.placesApiKey === "string" && /^[A-Za-z0-9_-]{20,}$/.test(cfg.placesApiKey.trim()));
}
export function placesStatus(cfg = mapsConfig) {
  if (failed) return failed;
  return placesEnabled(cfg) ? "on" : "no-key";
}

/** Clean a picked place for storage: { formattedAddress, lat, lng, placeId, source }. Null if unusable. */
export function sanitizePlace(p) {
  if (!p || typeof p !== "object") return null;
  const lat = +p.lat, lng = +p.lng;
  const formattedAddress = String(p.formattedAddress || "").trim().slice(0, 200);
  const placeId = String(p.placeId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 300);
  if (!formattedAddress || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { formattedAddress, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, placeId, source: "google-places" };
}

/** Turn a Places API (New) Place object (after fetchFields) into our stored shape. */
export function placeFromGoogle(place) {
  if (!place) return null;
  const loc = place.location;
  const lat = loc && (typeof loc.lat === "function" ? loc.lat() : loc.lat);
  const lng = loc && (typeof loc.lng === "function" ? loc.lng() : loc.lng);
  return sanitizePlace({ formattedAddress: place.formattedAddress, lat, lng, placeId: place.id });
}

function loadPlaces(cfg = mapsConfig) {
  if (!placesEnabled(cfg) || typeof document === "undefined") return Promise.resolve(null);
  if (loadP) return loadP;
  loadP = new Promise(resolve => {
    const done = lib => { clearTimeout(t); resolve(lib); };
    const fail = why => { failed = why; loadP = null; done(null); };
    const t = setTimeout(() => fail("load-timeout"), LOAD_TIMEOUT_MS);
    // Google calls this when the key is wrong, restricted to other sites, or billing / API is off.
    window.gm_authFailure = () => { failed = "auth-failed"; console.warn("Places: Google rejected the Maps key — address search off"); };
    window.__hwPlacesReady = async () => {
      try { done(await window.google.maps.importLibrary("places")); }
      catch (e) { fail("import-failed"); }
    };
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(cfg.placesApiKey.trim())
      + "&v=weekly&loading=async&language=en-AU&region=AU&callback=__hwPlacesReady";
    s.onerror = () => fail("script-blocked");
    document.head.appendChild(s);
  });
  return loadP;
}

/**
 * Add a suggestion list under an existing <input>. The input stays a normal text field.
 * onPick(place) gets the sanitized place. Returns a detach function. No-op when Places is off.
 */
export function attachAddressSearch(input, { onPick, cfg = mapsConfig, lib: injected = null } = {}) {
  // `lib` lets the isolated preview inject a fake Places library (no network); the app never passes it.
  if (!input || (!injected && !placesEnabled(cfg))) return () => {};
  const list = document.createElement("ul");
  list.className = "plc-list"; list.hidden = true; list.setAttribute("role", "listbox");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("aria-autocomplete", "list");
  input.insertAdjacentElement("afterend", list);
  let timer = 0, token = null, seq = 0, lib = injected;
  const hide = () => { list.hidden = true; list.innerHTML = ""; };
  const pick = async pred => {
    hide();
    try {
      const place = pred.toPlace();
      await place.fetchFields({ fields: ["formattedAddress", "location", "id"] });
      const p = placeFromGoogle(place);
      token = null; // a pick ends the billing session
      if (p) { input.value = p.formattedAddress; onPick && onPick(p); }
    } catch (e) { console.warn("Places details", e && e.message); }
  };
  const search = async () => {
    const q = input.value.trim();
    if (q.length < 3) return hide();
    lib = lib || await loadPlaces(cfg);
    if (!lib || (failed && !injected)) return hide();
    const my = ++seq;
    try {
      token = token || new lib.AutocompleteSessionToken();
      const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: q, sessionToken: token, includedRegionCodes: ["au"], locationBias: SEQ_BOUNDS, language: "en-AU", region: "au"
      });
      if (my !== seq) return;
      const preds = (suggestions || []).map(s => s.placePrediction).filter(Boolean).slice(0, 5);
      if (!preds.length) return hide();
      list.innerHTML = "";
      preds.forEach(pred => {
        const li = document.createElement("li");
        li.setAttribute("role", "option"); li.tabIndex = -1;
        li.textContent = pred.text ? pred.text.toString() : "";
        li.addEventListener("mousedown", ev => { ev.preventDefault(); pick(pred); });
        list.appendChild(li);
      });
      const foot = document.createElement("li");
      foot.className = "plc-foot"; foot.textContent = "Powered by Google";
      list.appendChild(foot);
      list.hidden = false;
    } catch (e) {
      // API not enabled / quota / network: stop suggesting, keep plain typing.
      failed = "request-failed"; hide();
      console.warn("Places autocomplete off:", e && (e.code || e.message));
    }
  };
  const onInput = () => { clearTimeout(timer); timer = setTimeout(search, 250); };
  const onKey = ev => {
    const items = [...list.querySelectorAll("li[role=option]")];
    if (list.hidden || !items.length) return;
    const cur = items.indexOf(document.activeElement);
    if (ev.key === "ArrowDown") { ev.preventDefault(); (items[cur + 1] || items[0]).focus(); }
    if (ev.key === "Escape") hide();
  };
  list.addEventListener("keydown", ev => {
    const items = [...list.querySelectorAll("li[role=option]")];
    const cur = items.indexOf(document.activeElement);
    if (ev.key === "ArrowDown") { ev.preventDefault(); (items[cur + 1] || items[0]).focus(); }
    if (ev.key === "ArrowUp") { ev.preventDefault(); cur <= 0 ? input.focus() : items[cur - 1].focus(); }
    if (ev.key === "Enter") { ev.preventDefault(); document.activeElement.dispatchEvent(new MouseEvent("mousedown")); }
    if (ev.key === "Escape") { hide(); input.focus(); }
  });
  const onBlur = () => setTimeout(() => { if (!list.contains(document.activeElement)) hide(); }, 150);
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKey);
  input.addEventListener("blur", onBlur);
  return () => { clearTimeout(timer); input.removeEventListener("input", onInput); input.removeEventListener("keydown", onKey); input.removeEventListener("blur", onBlur); list.remove(); };
}

// Test hook only.
export function _resetPlacesForTests() { loadP = null; failed = ""; }
