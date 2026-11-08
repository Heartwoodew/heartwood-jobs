// Parse builder emails into a job draft in the browser. No network and no model.
// Orbit BusinessCraft: cost code 900 is spoil or slab. Spoil is normally PO …/900/02.
// Slab is normally …/900/01. 901 roof clean, 902 scaffold clean, 903 final clean.
// The reviewer saves. This module never writes.

export const BUILDER_CLIENTS = Object.freeze({
  orbit: "Orbit Homes (Qld) Pty Ltd",
  torsion: "Torsion Built Pty Ltd",
  silkwood: "Silkwood Homes",
});

const STREET = "Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Crt|Crescent|Cres|Circuit|Cct|Place|Pl|Parade|Pde|Terrace|Tce|Lane|Ln|Boulevard|Blvd|Way|Close|Cl|Grove|Gr";
const STREET_RE = new RegExp(`\\b(?:${STREET})\\b`, "i");
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const DATE_LABEL = /(?:required(?:\s+date)?|date\s+required|call[-\s]?up(?:\s+date)?|booked\s+for|on\s+site(?:\s+date)?|needed\s+by|due\s+(?:date|on)|attend(?:\s+on)?)\s*[:\-]?\s*/i;
const NOISE = /\b(remittance|statement of account|payment advice|out of office|automatic reply|newsletter|password reset)\b/i;

export function canImportInbox(me) {
  return !!(me && (me.role === "admin" || me.role === "supervisor" || me.staffRole === "supervisor"));
}

export function isImported(email) {
  return !!(email && (email.imported === true || email.importedJobId));
}

function cleanText(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[·•]/g, ", ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function emailBlob(email) {
  const m = email || {};
  const files = Array.isArray(m.attachments) ? m.attachments.join(" ") : "";
  return cleanText([m.subject, m.snippet, m.body, m.text, m.plain, m.html, m.jobLabel, m.matchKey, files].filter(Boolean).join("\n"));
}

function titleStreet(type) {
  const map = {
    street: "St", st: "St", road: "Rd", rd: "Rd", avenue: "Ave", ave: "Ave", drive: "Dr", dr: "Dr",
    court: "Crt", ct: "Ct", crt: "Crt", crescent: "Cres", cres: "Cres", circuit: "Cct", cct: "Cct",
    place: "Pl", pl: "Pl", parade: "Pde", pde: "Pde", terrace: "Tce", tce: "Tce", lane: "Ln", ln: "Ln",
    boulevard: "Blvd", blvd: "Blvd", way: "Way", close: "Cl", cl: "Cl", grove: "Gr", gr: "Gr",
  };
  return map[String(type || "").toLowerCase()] || "";
}

function tidySuburb(value) {
  let s = String(value || "").replace(/\s+/g, " ").trim();
  s = s.replace(/\b(?:QLD|Queensland|NSW|VIC|SA|WA|TAS|NT|ACT)\b.*$/i, "").replace(/[,\s]+$/, "").trim();
  s = s.replace(/\b\d{4}\b.*$/, "").trim();
  const stop = /^(on|at|for|the|and|by|to|from|po|cost|required|call|please|supervisor|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
  const kept = [];
  for (const w of s.split(" ").filter(Boolean)) {
    if (stop.test(w) || STREET_RE.test(w)) break;
    kept.push(w);
    if (kept.length === 3) break;
  }
  s = kept.join(" ");
  if (!s || /^(qld|lot)$/i.test(s)) return "";
  return s;
}

function tidyName(value) {
  const skip = /^(notes?|comments?|spoil|access|please|supervisor|call|lot|site|cost|required|from|the|and|slab|clean|final|roof|scaffold)$/i;
  const words = String(value || "")
    .replace(/[^A-Za-z'’ .-]/g, " ")
    .split(/\s+/)
    .filter(w => /^[A-Z][a-z'’-]{1,20}$/.test(w) && !skip.test(w));
  const name = words.slice(0, 2).join(" ");
  if (!name || /homes|built|business|craft|accounts|noreply|admin|orbit|torsion|silkwood/i.test(name)) return "";
  return name;
}

export function tidyPhone(value) {
  let d = String(value || "").replace(/\D/g, "");
  if (d.startsWith("61")) d = "0" + d.slice(2);
  if (d.length === 9 && d.startsWith("4")) d = "0" + d;
  if (!/^0[23478]\d{8}$/.test(d)) return "";
  return d.replace(/^(\d{4})(\d{3})(\d{3})$/, "$1 $2 $3");
}

function pad(n) { return String(n).padStart(2, "0"); }

function validYmd(y, month, day) {
  y = +y; month = +month; day = +day;
  if (y < 2024 || y > 2035 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const dt = new Date(Date.UTC(y, month - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return "";
  return `${y}-${pad(month)}-${pad(day)}`;
}

function nextWeekday(refYmd, weekday) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(refYmd || "");
  if (!m) return "";
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const add = (weekday - dt.getUTCDay() + 7) % 7;
  dt.setUTCDate(dt.getUTCDate() + add);
  return dt.toISOString().slice(0, 10);
}

export function brisbaneDay(value, today) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  let ms = null;
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) ms = Date.parse(value);
  else if (value && typeof value.seconds === "number") ms = value.seconds * 1000;
  else if (value instanceof Date) ms = value.getTime();
  if (ms == null) return today || "";
  return new Date(ms + 10 * 3600 * 1000).toISOString().slice(0, 10);
}

function parseDateToken(chunk, refYmd) {
  const text = String(chunk || "");
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return validYmd(iso[1], iso[2], iso[3]);
  const slash = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (slash) {
    let y = +slash[3];
    if (y < 100) y += 2000;
    return validYmd(y, slash[2], slash[1]);
  }
  const mon = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(20\d{2}))?\b/i);
  if (mon) {
    const y = mon[3] ? +mon[3] : (refYmd ? +refYmd.slice(0, 4) : 0);
    const month = MONTHS[mon[2].slice(0, 3).toLowerCase()];
    return y ? validYmd(y, month, mon[1]) : "";
  }
  const day = text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (day && refYmd) return nextWeekday(refYmd, WEEKDAYS[day[1].toLowerCase()]);
  return "";
}

function findDate(text, refYmd) {
  const labeled = text.match(new RegExp(DATE_LABEL.source + "([^\\n]{0,48})", "i"));
  if (labeled) {
    const hit = parseDateToken(labeled[1], refYmd);
    if (hit) return hit;
  }
  const tokens = [];
  const re = /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+20\d{2})?|20\d{2}-\d{2}-\d{2})\b/ig;
  let m;
  while ((m = re.exec(text))) {
    const hit = parseDateToken(m[1], refYmd);
    if (hit) tokens.push(hit);
  }
  if (tokens.length) return tokens[0];
  const day = text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  return day && refYmd ? nextWeekday(refYmd, WEEKDAYS[day[1].toLowerCase()]) : "";
}

function scoreAddress(part, index, src) {
  let score = 0;
  if (part.lot) score += 3;
  if (part.number) score += 2;
  if (part.street) score += 3;
  if (part.suburb) score += 2;
  const before = src.slice(Math.max(0, index - 48), index);
  if (/\b(site|address|location|lot)\b/i.test(before)) score += 2;
  return score;
}

function streetNameKey(street) {
  return String(street || "").toLowerCase()
    .replace(new RegExp(`\\b(?:${STREET})\\b`, "ig"), " ")
    .replace(/\b\d+[a-z]?\b/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

export function parseAddress(text) {
  const src = cleanText(text);
  const found = [];
  const withLot = new RegExp(
    `\\blot\\s*(?:no\\.?\\s*)?(\\d+[a-z]?)\\s*(?:\\(\\s*(\\d+[a-z]?)\\s*\\))?\\s*[,/]?\\s*(?:(\\d+[a-z]?)\\s+)?([A-Za-z][A-Za-z'\\-]*(?:\\s+[A-Za-z][A-Za-z'\\-]*){0,3}?)\\s+(${STREET})\\b\\.?\\s*,?\\s*([A-Za-z][A-Za-z'\\-]*(?:\\s+[A-Za-z][A-Za-z'\\-]*){0,3})?`,
    "ig",
  );
  const bare = new RegExp(
    `\\b(\\d+[a-z]?)\\s+([A-Za-z][A-Za-z'\\-]*(?:\\s+[A-Za-z][A-Za-z'\\-]*){0,3}?)\\s+(${STREET})\\b\\.?\\s*,?\\s*([A-Za-z][A-Za-z'\\-]*(?:\\s+[A-Za-z][A-Za-z'\\-]*){0,3})?`,
    "ig",
  );
  let m;
  while ((m = withLot.exec(src))) {
    const number = m[2] || m[3] || "";
    const street = [number, m[4], titleStreet(m[5])].filter(Boolean).join(" ");
    const part = { lot: m[1], number, street, suburb: tidySuburb(m[6] || ""), index: m.index };
    part.score = scoreAddress(part, m.index, src);
    found.push(part);
  }
  while ((m = bare.exec(src))) {
    if (/\blot\s*(?:no\.?\s*)?\d/i.test(src.slice(Math.max(0, m.index - 16), m.index))) continue;
    const street = [m[1], m[2], titleStreet(m[3])].filter(Boolean).join(" ");
    const part = { lot: "", number: m[1], street, suburb: tidySuburb(m[4] || ""), index: m.index };
    part.score = scoreAddress(part, m.index, src);
    found.push(part);
  }
  found.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = found[0];
  if (!best || !best.street) return { lot: "", number: "", street: "", suburb: "", address: "" };
  return { lot: best.lot, number: best.number, street: best.street, suburb: best.suburb, address: composeAddress(best) };
}

export function composeAddress({ lot, street, suburb } = {}) {
  const lotBit = lot ? `Lot ${String(lot).replace(/^lot\s*/i, "")}` : "";
  const left = [lotBit, street].filter(Boolean).join(lotBit && street ? ", " : "");
  const sub = tidySuburb(suburb);
  return [left, sub].filter(Boolean).join(", ");
}

export function addressWithSuburb(address, suburb) {
  const addr = String(address || "").trim();
  const sub = tidySuburb(suburb);
  if (!sub) return addr;
  if (addr.toLowerCase().includes(sub.toLowerCase())) return addr;
  return addr ? `${addr}, ${sub}` : sub;
}

function normAddr(value) {
  return cleanText(value).toLowerCase()
    .replace(/\b(queensland|qld|nsw|vic|sa|wa|tas|nt|act)\b/g, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/\bstreet\b/g, "st").replace(/\broad\b/g, "rd").replace(/\bavenue\b/g, "ave")
    .replace(/\bdrive\b/g, "dr").replace(/\bcourt\b/g, "ct").replace(/\bcrescent\b/g, "cres")
    .replace(/\bcircuit\b/g, "cct").replace(/\bplace\b/g, "pl").replace(/\bparade\b/g, "pde")
    .replace(/\bterrace\b/g, "tce").replace(/\bboulevard\b/g, "blvd")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sameSite(a, b) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left || !right) return false;
  const pa = parseAddress(left);
  const pb = parseAddress(right);
  if (pa.street && pb.street && streetNameKey(pa.street) && streetNameKey(pa.street) === streetNameKey(pb.street)) {
    if (pa.lot && pb.lot) return String(pa.lot).toLowerCase() === String(pb.lot).toLowerCase();
    if (pa.number && pb.number) return String(pa.number).toLowerCase() === String(pb.number).toLowerCase();
  }
  const na = normAddr(left);
  const nb = normAddr(right);
  return na.length > 10 && na === nb;
}

export function normPo(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "").replace(/^PO(?=[A-Z0-9])/, "");
}

function poParts(po) {
  const m = /^([A-Z0-9-]{2,12})\/(900|901|902|903)\/(\d{1,2})$/.exec(normPo(po));
  if (!m) return null;
  return { job: m[1], code: m[2], line: m[3].padStart(2, "0"), po: `${m[1]}/${m[2]}/${m[3].padStart(2, "0")}` };
}

function findPos(text) {
  const src = String(text || "").replace(/\s*\/\s*/g, "/");
  const out = [];
  const seen = new Set();
  const add = raw => {
    const po = normPo(raw).replace(/[.,;:]+$/, "");
    if (!po || po.length < 4 || seen.has(po)) return;
    if (/^(REMITTANCE|INVOICE|STATEMENT)$/.test(po)) return;
    seen.add(po);
    out.push(po);
  };
  const coded = /\b([A-Z]{2,8}|\d{3,8})\/(900|901|902|903)\/(\d{1,2})\b/gi;
  let m;
  while ((m = coded.exec(src))) add(`${m[1]}/${m[2]}/${m[3]}`);
  const labeled = /\b(?:purchase\s*order|p\/o|\bpo)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/-]{2,40})/gi;
  while ((m = labeled.exec(src))) add(m[1]);
  return out;
}

function clientFor(email, text) {
  const blob = `${email.builder || ""} ${email.fromEmail || ""} ${email.subject || ""} ${text.slice(0, 240)}`;
  if (/orbit/i.test(blob)) return BUILDER_CLIENTS.orbit;
  if (/torsion/i.test(blob)) return BUILDER_CLIENTS.torsion;
  if (/silkwood/i.test(blob)) return BUILDER_CLIENTS.silkwood;
  return "";
}

function workSignals(text) {
  const body = text.replace(/900\s*spoil\s*\/\s*slab/ig, " ");
  return {
    spoil: /\bspoil\b/i.test(body),
    slab: /\b(back\s?slab|slab\s+clean|back\s?blade|backblade|\bslab\b)/i.test(body),
    roof: /\broof\s+clean\b/i.test(body),
    scaffold: /\bscaffold\s+clean\b/i.test(body),
    finalClean: /\bfinal\s+clean\b/i.test(body),
    siteClean: /\b(site\s+clean|\bclean\b)/i.test(body),
    waterproof: /\bwater\s?proof/i.test(body),
  };
}

function codeLabel(code, line) {
  if (code === "901") return { type: "clean", label: "Roof clean" };
  if (code === "902") return { type: "clean", label: "Scaffold clean" };
  if (code === "903") return { type: "clean", label: "Final clean" };
  if (code === "900" && line === "02") return { type: "spoil", label: "Spoil removal" };
  if (code === "900" && line === "01") return { type: "backslab", label: "Backslab" };
  if (code === "900") return { type: "other", label: "Cost code 900" };
  return { type: "other", label: "" };
}

function notesOf(text) {
  const m = /(?:notes?|comments?|instructions?)\s*[:\-]\s*([\s\S]{0,800})/i.exec(text);
  if (!m) return "";
  return m[1].split(/\n\s*(?:supervisor|regards|cheers|thanks|kind regards)\b/i)[0].replace(/\s+/g, " ").trim();
}

function supervisorOf(text, email) {
  const line = /supervisor\s*[:\-]?\s+([^\n]{3,140})/i.exec(text);
  const chunk = line ? line[1].split(/\b(?:notes?|comments?|instructions?)\b/i)[0] : "";
  const mailIn = chunk.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneIn = chunk.match(/(?:\+?61[\s()-]*)?0?4[\d\s()-]{8,14}|\b0[2378][\s()-]*\d{4}[\s()-]*\d{4}\b/);
  let name = tidyName(chunk.replace(mailIn ? mailIn[0] : "", " ").replace(phoneIn ? phoneIn[0] : "", " "));
  let emailAddr = mailIn ? mailIn[0].toLowerCase() : "";
  let phone = phoneIn ? tidyPhone(phoneIn[0]) : "";
  const fromMail = String(email.fromEmail || "").trim().toLowerCase();
  const generic = /noreply|no-reply|businesscraft|donotreply|accounts@|notifications?@/i.test(fromMail);
  if (!name) name = tidyName(email.fromName);
  if (!emailAddr && fromMail && !generic && fromMail.includes("@")) emailAddr = fromMail;
  if (!phone) {
    const any = text.match(/(?:\+?61[\s()-]*)?04[\d\s()-]{8,12}/);
    if (any) phone = tidyPhone(any[0]);
  }
  return { name, email: emailAddr, phone };
}

function jobLike(parsed, text) {
  if (parsed.imported) return false;
  const site = !!(parsed.lot || parsed.street);
  const coded = /\/(?:900|901|902|903)\//.test(parsed.po || "");
  const signal = !!(parsed.po || parsed.costCode || (parsed.type && parsed.type !== "other") || /call[-\s]?up|purchase\s*order|\bpo\b/i.test(text));
  if (NOISE.test(text) && !site && !coded) return false;
  return site && (signal || !!parsed.date || !!parsed.costCode);
}

export function parseInboxEmail(email, opts = {}) {
  const m = email || {};
  const text = emailBlob(m);
  const ref = brisbaneDay(m.date, opts.today || "");
  const site = parseAddress(text);
  const pos = findPos(text).map(po => ({ po, parts: poParts(po) }));
  const coded = pos.filter(p => p.parts);
  const signals = workSignals(`${m.subject || ""}\n${text}`);
  const lines = [...new Set(coded.map(p => p.parts.code === "900" ? p.parts.line : ""))].filter(Boolean);
  const twoSlabSpoil = lines.includes("01") && lines.includes("02");
  let chosen = coded[0] || null;
  const subject = String(m.subject || "");
  if (twoSlabSpoil) {
    if (/\bspoil\b/i.test(subject) && !/\bslab\b/i.test(subject)) chosen = coded.find(p => p.parts.line === "02") || chosen;
    else if (/\bslab\b/i.test(subject) && !/\bspoil\b/i.test(subject)) chosen = coded.find(p => p.parts.line === "01") || chosen;
  }
  const codeFromWords = signals.roof ? "901" : signals.scaffold ? "902" : signals.finalClean ? "903" : "";
  const codeMatch = text.match(/\bcost\s*codes?\s*[:#]?\s*(900|901|902|903)\b/i);
  const costCode = (chosen && chosen.parts && chosen.parts.code) || (codeMatch && codeMatch[1]) || codeFromWords || "";
  const line = chosen && chosen.parts ? chosen.parts.line : "";
  let kind = codeLabel(costCode, line);
  if (!chosen && signals.roof) kind = { type: "clean", label: "Roof clean" };
  else if (!chosen && signals.scaffold) kind = { type: "clean", label: "Scaffold clean" };
  else if (!chosen && signals.finalClean) kind = { type: "clean", label: "Final clean" };
  else if (costCode === "900" && !line) {
    if (signals.spoil && !signals.slab) kind = { type: "spoil", label: "Spoil removal" };
    else if (signals.slab && !signals.spoil) kind = { type: "backslab", label: "Backslab" };
    else kind = { type: "other", label: "Cost code 900" };
  } else if (!costCode) {
    if (signals.spoil && !signals.slab) kind = { type: "spoil", label: "Spoil removal" };
    else if (signals.slab && !signals.spoil) kind = { type: "backslab", label: "Backslab" };
    else if (signals.waterproof) kind = { type: "waterproof", label: "Waterproofing" };
    else if (signals.siteClean) kind = { type: "clean", label: signals.finalClean ? "Final clean" : "Site clean" };
  }
  const other = twoSlabSpoil ? coded.find(p => p !== chosen && p.parts && p.parts.code === "900") : null;
  const sup = supervisorOf(text, m);
  let notes = notesOf(text);
  const warnings = [];
  if (twoSlabSpoil) warnings.push("This email has both a spoil PO (…/900/02) and a slab PO (…/900/01). They are separate jobs. Import one, and add the other from New Job. The email can only be imported once.");
  if (costCode === "900" && kind.type === "other") warnings.push("Cost code 900 is spoil or slab. Spoil is normally …/900/02 and the slab is …/900/01. Pick one before you save.");
  if (other) notes = [notes, `Also in this email: ${other.po} (${other.parts.line === "02" ? "spoil" : "slab"}). Add that as its own job.`].filter(Boolean).join(" ");
  const po = (chosen && chosen.po) || (pos[0] && pos[0].po) || "";
  const parsed = {
    client: clientFor(m, text),
    lot: site.lot,
    street: site.street,
    suburb: site.suburb,
    address: site.address,
    type: kind.type || "other",
    typeLabel: kind.label || "",
    costCode,
    date: findDate(text, ref),
    po,
    supervisorName: sup.name,
    supervisorEmail: sup.email,
    supervisorPhone: sup.phone,
    notes,
    description: kind.label || "",
    warnings,
    twoTasks: twoSlabSpoil,
    imported: isImported(m),
    emailId: m.id || "",
    builder: m.builder || "",
    subject,
  };
  parsed.jobLike = jobLike(parsed, text);
  return parsed;
}

export function findExistingJob(jobs, draft) {
  const po = normPo(draft && draft.po);
  const list = (jobs || []).filter(j => j && j.id && j.status !== "Cancelled");
  if (po) {
    const hit = list.find(j => normPo(j.po) === po);
    if (hit) return { job: hit, by: "po" };
  }
  if (draft && draft.address) {
    const hit = list.find(j => sameSite(j.address, draft.address));
    if (hit) return { job: hit, by: "address" };
  }
  return null;
}

export function defaultImportMode(existing) {
  if (!existing) return "create";
  return existing.by === "po" ? "date" : "create";
}

export function duplicateWarning(existing, label) {
  if (!existing) return "";
  const how = existing.by === "po" ? "this PO" : "this address";
  const who = label || "an existing job";
  return `A job with ${how} already exists (${who}). You can update that job's date, or save a new job if this is different work. Spoil and slab at the same address are separate jobs.`;
}

export function bulkCandidates(emails, opts) {
  return (emails || []).filter(m => {
    if (!m || isImported(m)) return false;
    return parseInboxEmail(m, opts).jobLike;
  });
}

export function emptyDraft() {
  return {
    client: "", lot: "", street: "", suburb: "", address: "", type: "spoil", typeLabel: "",
    costCode: "", date: "", po: "", supervisorName: "", supervisorEmail: "", supervisorPhone: "",
    notes: "", description: "", warnings: [], twoTasks: false, jobLike: false, emailId: "", builder: "", subject: "",
  };
}
