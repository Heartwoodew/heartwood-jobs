// Type-ahead values for one company. Callers pass records the signed-in role can already read.
// Nothing here reads Firestore. Prices are never copied into a suggestion.
// A remembered book is ignored unless its companyId (and uid, when given) matches.

import { docCompanyId } from "./company.js";
import { suburbOf } from "./suburb.js";

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const PRICE_RE = /(?:A|AU)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:ex|inc|incl)\.?\s?GST)?/gi;

export const RECIPIENT_LIMIT = 40;
export const LIST_IDS = Object.freeze({
  client: "af-client",
  address: "af-address",
  suburb: "af-suburb",
  contactName: "af-contact",
  phone: "af-phone",
  email: "af-email",
  supervisor: "af-supervisor",
  supplier: "af-supplier",
  servicedBy: "af-serviced",
});

const FIELD_MAX = Object.freeze({
  client: 120,
  address: 160,
  suburb: 60,
  contactName: 80,
  phone: 40,
  email: 120,
  description: 300,
  supervisor: 80,
  supplier: 120,
  servicedBy: 120,
});

const ATTRS = Object.freeze({
  client: 'autocomplete="organization"',
  address: 'autocomplete="street-address"',
  suburb: 'autocomplete="address-level2"',
  contactName: 'autocomplete="name"',
  supervisor: 'autocomplete="name"',
  phone: 'type="tel" inputmode="tel" autocomplete="tel"',
  email: 'type="email" inputmode="email" autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false"',
  supplier: 'autocomplete="organization"',
  servicedBy: 'autocomplete="organization"',
});

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : "";
}

export function cleanText(value, { max = 160, redactMoney = false } = {}) {
  let s = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (redactMoney) s = s.replace(PRICE_RE, " ").replace(/\$/g, " ").replace(/\s+/g, " ").trim();
  if (!s || /^\[price removed\]$/i.test(s) || s.length > max) return "";
  return s;
}

export function cleanPhone(value) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!s || s.length > 40 || !/\d/.test(s) || /\$/.test(s)) return "";
  return s;
}

export function stampMs(value) {
  if (!value) return 0;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return 0;
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const t = Date.parse(text + "T00:00:00Z");
      return Number.isFinite(t) ? t : 0;
    }
    const t = Date.parse(text);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === "object") {
    if (typeof value.toMillis === "function") {
      const t = Number(value.toMillis());
      return Number.isFinite(t) ? t : 0;
    }
    if (typeof value.seconds === "number") return Math.round(value.seconds * 1000);
  }
  return 0;
}

function sameCompany(row, companyId) {
  return !!row && typeof row === "object" && docCompanyId(row) === companyId;
}

function bucket() {
  const map = new Map();
  return {
    add(value, { count = 1, recent = 0 } = {}) {
      const text = String(value || "");
      if (!text) return;
      const key = text.toLowerCase();
      const row = map.get(key) || { value: text, count: 0, recent: 0 };
      row.count += count > 0 ? count : 1;
      if (recent >= row.recent) {
        row.recent = recent;
        row.value = text;
      }
      map.set(key, row);
    },
    ranked(limit) {
      return [...map.values()]
        .sort((a, b) => b.recent - a.recent || b.count - a.count || a.value.localeCompare(b.value))
        .slice(0, limit)
        .map(row => row.value);
    },
  };
}

function appendUnique(primary, extra, limit) {
  const out = [];
  const seen = new Set();
  for (const value of [...primary, ...extra]) {
    const text = String(value || "");
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function bookFields(remembered, companyId, uid) {
  if (!remembered || remembered.companyId !== companyId) return {};
  if (uid && remembered.uid !== uid) return {};
  return remembered.fields && typeof remembered.fields === "object" ? remembered.fields : {};
}

function addBook(target, rows, clean) {
  for (const row of rows || []) {
    const value = clean(row && row.value);
    if (!value) continue;
    target.add(value, { count: Number(row.count) > 0 ? Number(row.count) : 1, recent: stampMs(row.lastUsed) });
  }
}

export function collectSuggestions({
  companyId = "heartwood",
  uid = "",
  jobs = [],
  clients = [],
  receipts = [],
  claims = [],
  services = [],
  directoryNames = [],
  remembered = null,
  remoteEmails = [],
  redactMoney = false,
  now = Date.now(),
} = {}) {
  const cid = String(companyId || "heartwood");
  const text = (value, field) => cleanText(value, { max: FIELD_MAX[field] || 160, redactMoney });
  const clientB = bucket();
  const addressB = bucket();
  const suburbB = bucket();
  const contactB = bucket();
  const phoneB = bucket();
  const emailB = bucket();
  const descB = bucket();
  const supB = bucket();
  const supplierB = bucket();
  const placeB = bucket();
  const clientEmails = [];

  for (const job of jobs || []) {
    if (!sameCompany(job, cid)) continue;
    const recent = stampMs(job.updatedAt) || stampMs(job.createdAt) || stampMs(job.date);
    const client = text(job.client, "client");
    if (client) clientB.add(client, { recent });
    const address = text(job.address, "address");
    if (address) {
      addressB.add(address, { recent });
      const sub = text(suburbOf(address), "suburb");
      if (sub) suburbB.add(sub, { recent });
    }
    const description = text(job.description, "description");
    if (description) descB.add(description, { recent });
    for (const raw of [job.contactEmail, job.clientEmail, job.supervisorEmail]) {
      const email = cleanEmail(raw);
      if (email) emailB.add(email, { recent });
    }
    const contact = text(job.contactName, "contactName");
    if (contact) contactB.add(contact, { recent });
    const supervisor = text(job.supervisorName, "supervisor");
    if (supervisor) {
      supB.add(supervisor, { recent });
      if (!contact) contactB.add(supervisor, { recent });
    }
    for (const raw of [job.contactPhone, job.supervisorPhone]) {
      const phone = cleanPhone(raw);
      if (phone) phoneB.add(phone, { recent });
    }
  }

  for (const client of clients || []) {
    if (!sameCompany(client, cid)) continue;
    const name = text(client.name, "client");
    if (name) clientB.add(name);
    const office = client.office && typeof client.office === "object" ? client.office : {};
    const address = text(office.address || client.address, "address");
    if (address) {
      addressB.add(address);
      const sub = text(suburbOf(address), "suburb");
      if (sub) suburbB.add(sub);
    }
    const phone = cleanPhone(office.phone || client.phone);
    if (phone) phoneB.add(phone);
    const contacts = Array.isArray(client.contacts) ? client.contacts : [];
    for (const person of contacts) {
      if (!person || typeof person !== "object") continue;
      const who = text(person.name, "contactName");
      if (who) {
        contactB.add(who);
        if (person.kind === "supervisor") supB.add(who);
      }
      const mail = cleanEmail(person.email);
      if (mail) clientEmails.push(mail);
      const mobile = cleanPhone(person.mobile || person.phone);
      if (mobile) phoneB.add(mobile);
    }
    const direct = cleanEmail(client.email);
    if (direct) clientEmails.push(direct);
  }

  for (const name of directoryNames || []) {
    const textName = text(name, "client");
    if (textName) clientB.add(textName);
  }

  for (const row of receipts || []) {
    if (!sameCompany(row, cid)) continue;
    const recent = stampMs(row.createdAt) || stampMs(row.createdAtIso) || stampMs(row.date);
    const supplier = text(row.supplier, "supplier");
    if (supplier) supplierB.add(supplier, { recent });
  }
  for (const row of claims || []) {
    if (!sameCompany(row, cid)) continue;
    const supplier = text(row.supplier, "supplier");
    if (supplier) supplierB.add(supplier, { recent: stampMs(row.date) });
  }
  for (const row of services || []) {
    if (!sameCompany(row, cid)) continue;
    const place = text(row.servicedBy, "servicedBy");
    if (place) placeB.add(place, { recent: stampMs(row.doneOn) || stampMs(row.updatedAt) });
  }

  const saved = bookFields(remembered, cid, uid);
  addBook(clientB, saved.client, value => text(value, "client"));
  addBook(addressB, saved.address, value => text(value, "address"));
  addBook(suburbB, saved.suburb, value => text(value, "suburb"));
  addBook(contactB, saved.contactName, value => text(value, "contactName"));
  addBook(phoneB, saved.phone, value => cleanPhone(value));
  addBook(emailB, saved.email, cleanEmail);
  addBook(descB, saved.description, value => text(value, "description"));
  addBook(supB, saved.supervisor, value => text(value, "supervisor"));
  addBook(supplierB, saved.supplier, value => text(value, "supplier"));
  addBook(placeB, saved.servicedBy, value => text(value, "servicedBy"));

  (remoteEmails || []).forEach((raw, index) => {
    const email = cleanEmail(raw);
    if (email) emailB.add(email, { recent: now - index });
  });

  return {
    client: clientB.ranked(24),
    address: addressB.ranked(12),
    suburb: suburbB.ranked(12),
    contactName: contactB.ranked(12),
    phone: phoneB.ranked(12),
    email: appendUnique(emailB.ranked(12), clientEmails, 20),
    description: descB.ranked(8),
    supervisor: supB.ranked(12),
    supplier: supplierB.ranked(12),
    servicedBy: placeB.ranked(12),
  };
}

export function detailsFromClient(client) {
  const empty = { address: "", suburb: "", contactName: "", phone: "", email: "" };
  if (!client || typeof client !== "object") return empty;
  const contacts = Array.isArray(client.contacts) ? client.contacts.filter(c => c && typeof c === "object") : [];
  const preferred = contacts.find(c => c.default) || contacts[0] || {};
  const withEmail = contacts.find(c => cleanEmail(c.email)) || {};
  const emailSource = cleanEmail(preferred.email) ? preferred : withEmail;
  const office = client.office && typeof client.office === "object" ? client.office : {};
  const address = cleanText(office.address || client.address || "", { max: 160 });
  const phone = cleanPhone(preferred.mobile) || cleanPhone(preferred.phone) || cleanPhone(office.phone) || cleanPhone(client.phone);
  return {
    address,
    suburb: suburbOf(address),
    contactName: cleanText(preferred.name || client.contactName || "", { max: 80 }),
    phone,
    email: cleanEmail(emailSource.email),
  };
}

export function prefillPatch(current, details) {
  const out = {};
  const src = details || {};
  const cur = current || {};
  for (const key of ["address", "suburb", "contactName", "phone", "email"]) {
    if (!String(cur[key] || "").trim() && String(src[key] || "").trim()) out[key] = src[key];
  }
  return out;
}

function normName(value) {
  return String(value || "").toLowerCase().replace(/\(.*?\)|pty|ltd|homes?|built|[^a-z]/g, "");
}

export function matchClient(name, clients) {
  const raw = String(name || "").trim().toLowerCase();
  if (!raw) return null;
  const list = Array.isArray(clients) ? clients : [];
  const exact = list.find(c => c && String(c.name || "").trim().toLowerCase() === raw);
  if (exact) return exact;
  const needle = normName(raw);
  if (!needle) return null;
  return list.find(c => c && normName(c.name) === needle) || null;
}

export function bookKey(companyId, uid) {
  return `callup-autofill:${companyId}:${uid}`;
}

export function loadBook(storage, companyId, uid) {
  const empty = { companyId, uid, fields: {} };
  if (!storage || typeof storage.getItem !== "function" || !companyId || !uid) return empty;
  try {
    const raw = JSON.parse(storage.getItem(bookKey(companyId, uid)) || "null");
    if (!raw || raw.companyId !== companyId || raw.uid !== uid || !raw.fields || typeof raw.fields !== "object") return empty;
    return { companyId, uid, fields: raw.fields };
  } catch {
    return empty;
  }
}

export function saveBook(storage, book) {
  if (!storage || typeof storage.setItem !== "function" || !book || !book.companyId || !book.uid) return;
  try {
    storage.setItem(bookKey(book.companyId, book.uid), JSON.stringify({
      companyId: book.companyId,
      uid: book.uid,
      fields: book.fields || {},
    }));
  } catch { /* private mode */ }
}

export function deriveRemembered(entries) {
  const next = { ...(entries || {}) };
  if (next.address && !String(next.suburb || "").trim()) {
    const sub = suburbOf(next.address);
    if (sub) next.suburb = sub;
  }
  return next;
}

function cleanField(field, value) {
  if (field === "email") return cleanEmail(value);
  if (field === "phone") return cleanPhone(value);
  return cleanText(value, { max: FIELD_MAX[field] || 160, redactMoney: false });
}

export function rememberBook(book, { companyId, uid, entries, now = Date.now() } = {}) {
  const base = book && book.companyId === companyId && book.uid === uid
    ? { companyId, uid, fields: { ...(book.fields || {}) } }
    : { companyId, uid, fields: {} };
  const incoming = deriveRemembered(entries);
  for (const [field, raw] of Object.entries(incoming || {})) {
    if (!Object.prototype.hasOwnProperty.call(FIELD_MAX, field)) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    let list = Array.isArray(base.fields[field]) ? base.fields[field].slice() : [];
    for (const value of values) {
      const text = cleanField(field, value);
      if (!text) continue;
      const key = text.toLowerCase();
      const idx = list.findIndex(row => String(row && row.value || "").toLowerCase() === key);
      const count = idx >= 0 ? (Number(list[idx].count) || 1) + 1 : 1;
      if (idx >= 0) list.splice(idx, 1);
      list.unshift({ value: text, count, lastUsed: now });
    }
    const cap = field === "email" ? RECIPIENT_LIMIT : 20;
    base.fields[field] = list.slice(0, cap);
  }
  return base;
}

export function pushRecentEmail(list, email, limit = RECIPIENT_LIMIT) {
  const clean = cleanEmail(email);
  const kept = (Array.isArray(list) ? list : []).map(cleanEmail).filter(Boolean);
  if (!clean) return [...new Set(kept)].slice(0, limit);
  return [clean, ...kept.filter(item => item !== clean)].slice(0, limit);
}

export function unionEmails(primary, extra, limit = RECIPIENT_LIMIT) {
  return appendUnique(
    (primary || []).map(cleanEmail).filter(Boolean),
    (extra || []).map(cleanEmail).filter(Boolean),
    limit,
  );
}

export function emailsFromRecipientDoc(data, companyId) {
  if (!data || typeof data !== "object" || data.companyId !== companyId || !Array.isArray(data.emails)) return [];
  return unionEmails(data.emails, [], RECIPIENT_LIMIT);
}

export function inputAttrs(field) {
  const id = LIST_IDS[field];
  const bits = [];
  if (id) bits.push(`list="${id}"`);
  if (ATTRS[field]) bits.push(ATTRS[field]);
  return bits.join(" ");
}

export function listsHtml(groups) {
  return Object.entries(LIST_IDS).map(([field, id]) => {
    const values = groups && Array.isArray(groups[field]) ? groups[field] : [];
    const opts = values.map(value => `<option value="${esc(value)}"></option>`).join("");
    return `<datalist id="${id}">${opts}</datalist>`;
  }).join("");
}

export function descriptionPickerHtml(values) {
  const list = (Array.isArray(values) ? values : []).map(value => cleanText(value, { max: 300 })).filter(Boolean);
  if (!list.length) return "";
  const opts = list.map(value => {
    const label = value.length > 80 ? value.slice(0, 77) + "…" : value;
    return `<option value="${esc(value)}">${esc(label)}</option>`;
  }).join("");
  return `<label class="sub af-pick">Previous description<select data-af-fill="description" aria-label="Use a previous description"><option value="">Choose…</option>${opts}</select></label>`;
}

export function bindDescriptionPicker(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll("[data-af-fill]").forEach(sel => {
    if (sel.dataset && sel.dataset.afBound) return;
    if (sel.dataset) sel.dataset.afBound = "1";
    sel.addEventListener("change", () => {
      const name = sel.getAttribute("data-af-fill") || "";
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) return;
      const field = root.querySelector(`[name="${name}"]`);
      if (field && sel.value) field.value = sel.value;
      sel.value = "";
    });
  });
}
