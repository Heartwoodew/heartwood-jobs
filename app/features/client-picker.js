// Client list on the New Job and Edit Job form.
// Names come from the caller. This file does not read or write Firestore.
// Prices are never added to the list or the add-client row.

export const ADD_CLIENT_LABEL = "+ Add new client";
export const CLIENT_MENU_LIMIT = 40;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function cleanClientQuery(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

// Same people who see Add client on the Clients screen: role admin only.
// Crew, supervisors and managers do not. A staffRole of admin does not count.
export function canOfferNewClient(person) {
  return !!(person && person.role === "admin");
}

export function clientMenuModel(names, query, { canAdd = false } = {}) {
  const typed = cleanClientQuery(query);
  const needle = typed.toLowerCase();
  const seen = new Set();
  const matches = [];
  for (const raw of names || []) {
    const name = cleanClientQuery(raw);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    if (needle && !key.includes(needle)) continue;
    seen.add(key);
    matches.push(name);
    if (matches.length >= CLIENT_MENU_LIMIT) break;
  }
  const exact = !!needle && matches.some(name => name.toLowerCase() === needle);
  const items = matches.map(name => ({ type: "client", name }));
  if (canAdd) {
    const prefill = typed && !exact ? typed : "";
    items.push({
      type: "add",
      label: prefill ? `${ADD_CLIENT_LABEL} “${prefill}”` : ADD_CLIENT_LABEL,
      prefill,
    });
  }
  return { items, query: typed, canAdd: !!canAdd, noMatch: matches.length === 0 };
}

export function clientMenuHtml(model) {
  const items = model && Array.isArray(model.items) ? model.items : [];
  if (!items.length) return `<p class="client-empty">No matching client</p>`;
  return items.map(item => {
    if (item.type === "add") {
      return `<button type="button" class="client-add" role="option" data-add-client data-prefill="${esc(item.prefill || "")}">${esc(item.label || ADD_CLIENT_LABEL)}</button>`;
    }
    return `<button type="button" class="client-opt" role="option" data-client-name="${esc(item.name)}">${esc(item.name)}</button>`;
  }).join("");
}

// The job form client field. Free text, with our own list instead of the browser datalist,
// so "+ Add new client" can open a sheet even when the typed name is not in the list.
export function clientFieldHtml({ value = "", canAdd = false } = {}) {
  const flag = canAdd ? "add" : "pick";
  return `<div class="client-field">
    <label for="jf-client">Client</label>
    <input id="jf-client" name="client" value="${esc(value)}" required autocomplete="off" autocapitalize="words" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="jf-client-menu" data-client-combo="${flag}">
    <div id="jf-client-menu" class="client-menu" data-client-menu role="listbox" hidden></div>
  </div>`;
}

const DRAFT_FIELDS = ["client", "address", "description", "date", "time", "notes", "po", "contactName", "contactPhone", "contactEmail", "status", "type"];

export function readJobDraft(form) {
  const value = name => {
    const el = form && form.elements ? form.elements[name] : null;
    return el && el.value != null ? String(el.value) : "";
  };
  const draft = {};
  for (const name of DRAFT_FIELDS) draft[name] = value(name);
  return draft;
}

export function jobDraftAfterCancel(draft) {
  return { ...(draft || {}) };
}

// Selects the new client. Every other field on the draft is copied through unchanged.
export function jobDraftAfterCreate(draft, name) {
  const next = jobDraftAfterCancel(draft);
  const client = cleanClientQuery(name);
  if (client) next.client = client;
  return next;
}
