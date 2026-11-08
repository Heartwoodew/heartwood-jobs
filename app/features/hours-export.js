// Timesheet hours -> .xlsx for accounts. Pure module (no Firebase). Hours only: no rates, pay or other finance data.
// Tiny dependency-free xlsx writer (stored zip + SpreadsheetML), so it works offline and on iPhone Safari.
import { paidShift, shiftHours, sortedEntries } from "./timesheet.js";
import { exportDayLeave } from "./leave.js";

export const ACCOUNTS_TO = "accounts@heartwoodew.com";
// Heartwood's mailbox stays accounts@. Other companies pass their own accountsEmail
// into the export record. This constant is the Heartwood default.
const DAYS = 7;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SHORT_DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const addD = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const r2 = h => Math.round((+h || 0) * 100) / 100;
const dmy = ds => `${ds.slice(8, 10)}/${ds.slice(5, 7)}/${ds.slice(0, 4)}`;
const dowIndex = ds => (new Date(ds + "T00:00:00Z").getUTCDay() + 6) % 7;
const weekday = ds => WEEKDAYS[dowIndex(ds)];
const dayHead = ds => `${SHORT_DOW[dowIndex(ds)]} ${ds.slice(8, 10)}/${ds.slice(5, 7)}`;
function leaveShort(info) {
  if (info.annual) return "Annual";
  if (info.sick) return "Sick";
  if (info.other) return "Other";
  if (info.pending) return "Pending";
  return "";
}
const clean = v => String(v ?? "").trim();
const normKey = v => clean(v).toLowerCase().replace(/^#/, "");
const minsOf = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
function breakMinutes(start, end) {
  const a = minsOf(start), b = minsOf(end);
  if (a == null || b == null) return null;
  return b >= a ? b - a : b + 1440 - a;
}
function plainTime(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v || "");
  if (!m) return "";
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
}

// Machine text is only the choice stored on the shift. Site is a job's address or number
// when the shift's job text matches exactly one job. Nothing is guessed.
function machineLabel(e) {
  if (!e || !e.machineChoice) return "";
  if (e.machineChoice === "asset") return clean(e.machineName);
  if (e.machineChoice === "none") return "No machine / other work";
  if (e.machineChoice === "skip") return "Skipped";
  return "";
}
function siteLabel(jobText, jobs) {
  const key = normKey(jobText);
  if (!key || !Array.isArray(jobs) || !jobs.length) return "";
  const hits = [];
  for (const j of jobs) {
    if (!j || typeof j !== "object") continue;
    const num = clean(j.sm8JobNo || j.jobNo);
    const addr = clean(j.address);
    if ((num && normKey(num) === key) || (addr && normKey(addr) === key)) hits.push({ num, addr });
  }
  if (hits.length !== 1) return "";
  const { num, addr } = hits[0];
  if (num && addr) return `${num} · ${addr}`;
  return num || addr;
}
function shiftFrom(e, jobs, source) {
  const open = e.source === "clock" && e.status !== "closed" && !e.finish;
  const onBreak = e.source === "clock" && e.status === "break" && !e.breakEnd;
  const breakStart = e.breakStart || "";
  const breakEnd = e.breakEnd || "";
  return {
    date: e.date,
    job: e.job || "",
    site: siteLabel(e.job, jobs),
    machine: machineLabel(e),
    start: e.start || "",
    finish: e.finish || "",
    breakStart,
    breakEnd,
    breakMins: breakStart && breakEnd ? breakMinutes(breakStart, breakEnd) : null,
    hours: r2(shiftHours(e)),
    source,
    note: [e.note || "", open ? "Not clocked off" : "", onBreak ? "On break" : ""].filter(Boolean).join(" · "),
  };
}

// One row per shift. A typed week with no entries falls back to the legacy days map.
// Break minutes come only from a recorded break start and end. The 30-minute lunch is not written as a break.
export function shiftRows(sheet, jobs = []) {
  const entries = sortedEntries(sheet?.entries).map(paidShift);
  const rows = [], taken = new Set();
  for (const e of entries) {
    if (!e.date) continue;
    taken.add(e.date);
    rows.push(shiftFrom(e, jobs, e.source === "manual" ? "Manual" : "Clocked"));
  }
  for (const [ds, d] of Object.entries(sheet?.days || {})) {
    if (taken.has(ds) || !d || (!d.start && !d.finish)) continue;
    rows.push(shiftFrom({ ...d, date: ds, job: d.job || "", source: "manual" }, jobs, "Week hours"));
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.start).localeCompare(String(b.start)));
}

function dayNotes(sheet, shiftDates) {
  const notes = {};
  for (const [ds, d] of Object.entries(sheet?.days || {})) {
    if (!d || shiftDates.has(ds) || d.start || d.finish) continue;
    const note = clean(d.note);
    if (note) notes[ds] = note;
  }
  return notes;
}

// people: [{uid,name}], sheets: timesheet week docs, leaves: leaveRequests, jobs: job docs already loaded.
// Every person who worked or has leave gets all seven days. Empty days are 0.
export function buildHoursReport({ weekStart, people, sheets, leaves = [], jobs = [] }) {
  const weekEnd = addD(weekStart, DAYS - 1), out = [];
  for (const p of people || []) {
    const sheet = (sheets || []).find(t => t.uid === p.uid) || null;
    const allShifts = sheet ? shiftRows(sheet, jobs) : [];
    const shifts = allShifts.filter(r => r.date >= weekStart && r.date <= weekEnd);
    const notes = sheet ? dayNotes(sheet, new Set(allShifts.map(r => r.date))) : {};
    const days = [];
    let annual = 0, sick = 0, other = 0, pending = 0;
    for (let i = 0; i < DAYS; i++) {
      const date = addD(weekStart, i);
      const dayShifts = shifts.filter(s => s.date === date);
      const info = exportDayLeave(leaves, p, date);
      annual += info.annual; sick += info.sick; other += info.other; pending += info.pending;
      const total = r2(dayShifts.reduce((t, s) => t + s.hours, 0));
      const leaveText = info.text || (dayShifts.length ? "" : "Day off");
      days.push({ date, weekday: weekday(date), shifts: dayShifts, total, leaveText, leaveShort: leaveShort(info), note: dayShifts.length ? "" : (notes[date] || "") });
    }
    annual = r2(annual); sick = r2(sick); other = r2(other); pending = r2(pending);
    const noted = Object.keys(notes).some(ds => ds >= weekStart && ds <= weekEnd);
    if (!shifts.length && !noted && !annual && !sick && !other && !pending) continue;
    out.push({
      name: p.name || "?",
      days,
      total: r2(days.reduce((t, d) => t + d.total, 0)),
      daysWorked: days.filter(d => d.total > 0).length,
      annual, sick, other, pending,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  const sum = key => r2(out.reduce((t, p) => t + p[key], 0));
  return { weekStart, weekEnd, people: out, total: sum("total"), annual: sum("annual"), sick: sum("sick"), other: sum("other"), pending: sum("pending") };
}

// ---------- xlsx ----------
const X = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const col = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };
// style ids (cellXfs order below)
const S = { txt: 0, title: 1, sub: 2, head: 3, date: 4, time: 5, hrs: 6, totLbl: 7, totHrs: 8, grandLbl: 9, grandHrs: 10, int: 11, totInt: 12, grandInt: 13, weekLbl: 14, weekHrs: 15 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="ddd dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="h:mm AM/PM"/><numFmt numFmtId="166" formatCode="0.00"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FF555555"/><name val="Calibri"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD6E3F0"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border/><border><bottom style="thin"><color rgb="FF999999"/></bottom></border><border><top style="double"><color rgb="FF000000"/></top></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="16">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="166" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="166" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="1" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="166" fontId="1" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// cell: null | {v, s} ; v number -> numeric, else inline string
function sheetXml(rows, widths, headerRow) {
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  const pane = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
  const data = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
    if (c == null || c.v === "" || c.v == null) return c && c.s ? `<c r="${col(ci)}${ri + 1}" s="${c.s}"/>` : "";
    const ref = `${col(ci)}${ri + 1}`;
    return typeof c.v === "number" ? `<c r="${ref}" s="${c.s || 0}"><v>${c.v}</v></c>` : `<c r="${ref}" s="${c.s || 0}" t="inlineStr"><is><t xml:space="preserve">${X(c.v)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${data}</sheetData><pageSetup orientation="landscape"/></worksheet>`;
}

const DETAIL = ["Staff", "Date", "Weekday", "Clock on", "Clock off", "Break start", "Break end", "Break minutes", "Shift hours", "Day total", "Job", "Site", "Machine", "Leave", "Notes", "Type"];
const text = v => { const s = clean(v); return s ? { v: s } : null; };

export function reportSheets(rep, { company = "Heartwood", generated = new Date() } = {}) {
  const gen = generated.toLocaleString("en-AU", { timeZone: "Australia/Brisbane", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
  const title = [{ v: `${company} · Timesheet hours`, s: S.title }];
  const sub = [{ v: `Pay period ${dmy(rep.weekStart)} to ${dmy(rep.weekEnd)} · Every day is listed · A 30-minute lunch is already off a finished shift unless a break was entered · Generated ${gen} (Brisbane)`, s: S.sub }];
  const H = a => a.map(v => ({ v, s: S.head }));
  const dates = Array.from({ length: DAYS }, (_, i) => addD(rep.weekStart, i));
  // Hours win when someone worked. A leave day with no hours shows Annual, Sick, Other, or Pending.
  const gridCell = day => day.total > 0 ? { v: day.total } : (day.leaveShort ? { v: day.leaveShort } : { v: 0 });
  const sum = [title, sub, H(["Staff", ...dates.map(dayHead), "Total"])];
  for (const p of rep.people) sum.push([{ v: p.name }, ...p.days.map(gridCell), { v: p.total, s: S.totHrs }]);
  sum.push([{ v: "Grand total", s: S.grandLbl }, ...dates.map((_, i) => ({ v: r2(rep.people.reduce((t, p) => t + p.days[i].total, 0)), s: S.grandHrs })), { v: rep.total, s: S.grandHrs }]);
  const det = [title, sub, H(DETAIL)];
  const blank = (n, s) => Array(n).fill({ v: "", s });
  for (const p of rep.people) {
    for (const day of p.days) {
      for (const r of day.shifts) {
        det.push([
          { v: p.name }, text(dmy(day.date)), text(day.weekday), text(plainTime(r.start)), text(plainTime(r.finish)),
          text(plainTime(r.breakStart)), text(plainTime(r.breakEnd)),
          r.breakMins == null ? null : { v: r.breakMins, s: S.int },
          { v: r.hours, s: S.hrs }, null,
          text(r.job), text(r.site), text(r.machine), null, text(r.note), text(r.source),
        ]);
      }
      det.push([
        { v: p.name, s: S.totLbl }, { v: dmy(day.date), s: S.totLbl }, { v: day.weekday, s: S.totLbl },
        ...blank(5, S.totLbl),
        { v: "", s: S.totLbl }, { v: day.total, s: S.totHrs },
        ...blank(3, S.totLbl),
        { v: day.leaveText || "", s: S.totLbl }, { v: day.note || "", s: S.totLbl }, { v: "Day total", s: S.totLbl },
      ]);
    }
    det.push([
      { v: `${p.name} week total`, s: S.weekLbl }, ...blank(8, S.weekLbl),
      { v: p.total, s: S.weekHrs }, ...blank(6, S.weekLbl),
    ]);
  }
  det.push([{ v: "Grand total", s: S.grandLbl }, ...blank(8, S.grandLbl), { v: rep.total, s: S.grandHrs }, ...blank(6, S.grandLbl)]);
  if (!rep.people.length) det.push([{ v: "No hours entered for this pay period." }]);
  return [
    { name: "Summary", xml: sheetXml(sum, [22, 12, 12, 12, 12, 12, 12, 12, 12], 3) },
    { name: "Detail", xml: sheetXml(det, [22, 12, 12, 12, 12, 13, 12, 15, 13, 12, 22, 32, 22, 36, 28, 14], 3) },
  ];
}

// --- stored zip ---
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
  for (const [name, text] of files) {
    const n = enc.encode(name), d = enc.encode(text), c = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, c, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, n.length, true);
    parts.push(new Uint8Array(h.buffer), n, d);
    const e = new DataView(new ArrayBuffer(46));
    e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true); e.setUint16(14, 0x21, true);
    e.setUint32(16, c, true); e.setUint32(20, d.length, true); e.setUint32(24, d.length, true); e.setUint16(28, n.length, true); e.setUint32(42, off, true);
    cen.push(new Uint8Array(e.buffer), n); off += 30 + n.length + d.length;
  }
  const csz = cen.reduce((t, a) => t + a.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csz, true); end.setUint32(16, off, true);
  const all = [...parts, ...cen, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((t, a) => t + a.length, 0)); let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export function xlsxBytes(sheets) {
  const ws = sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, s.xml]);
  return zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${X(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", STYLES], ...ws]);
}
export const exportFileName = (company, weekStart) => `${String(company || "Heartwood").replace(/[^A-Za-z0-9]+/g, "_")}_hours_${weekStart}_to_${addD(weekStart, 6)}.xlsx`;
export function newExportId() { let s = "hx"; while (s.length < 18) s += Math.random().toString(36).slice(2); return s.replace(/[^a-z0-9]/g, "a").slice(0, 18); }

// iPhone (and iPad desktop-mode) gets the share sheet. Everywhere else, including Windows desktop, saves with an anchor.
// canShare throws on some desktop browsers and for file types the share sheet will not take. That must not skip the download.
export function isIosLike(nav) {
  const ua = String(nav && nav.userAgent || "");
  return /iPhone|iPad|iPod/i.test(ua) || !!(nav && nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
}
function anchorDownload(documentRef, file) {
  if (!documentRef || !documentRef.body || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return { ok: false, via: "download", filename: file.name, error: "This browser could not save the file" };
  }
  const url = URL.createObjectURL(file);
  const link = documentRef.createElement("a");
  link.href = url;
  link.download = file.name;
  link.rel = "noopener";
  documentRef.body.appendChild(link);
  link.click();
  const timer = setTimeout(() => { try { link.remove(); } catch { /* already gone */ } try { URL.revokeObjectURL(url); } catch { /* ignore */ } }, 60000);
  if (timer && typeof timer.unref === "function") timer.unref();
  return { ok: true, via: "download", filename: file.name };
}
export async function deliverHoursFile({ bytes, filename, mime = XLSX_MIME, nav, doc } = {}) {
  const navigatorRef = nav || globalThis.navigator;
  const documentRef = doc || globalThis.document;
  const file = new File([bytes], filename, { type: mime || XLSX_MIME });
  if (isIosLike(navigatorRef)) {
    try {
      const can = typeof navigatorRef.canShare === "function" && navigatorRef.canShare({ files: [file] });
      if (can && typeof navigatorRef.share === "function") {
        try {
          await navigatorRef.share({ files: [file], title: filename });
          return { ok: true, via: "share", filename };
        } catch (err) {
          if (err && err.name === "AbortError") return { ok: false, cancelled: true, via: "share", filename };
        }
      }
    } catch { /* canShare threw; fall through to the anchor while the tap is still a user gesture */ }
  }
  try { return anchorDownload(documentRef, file); }
  catch (err) { return { ok: false, via: "download", filename, error: (err && (err.message || err.name)) || "Download failed" }; }
}
