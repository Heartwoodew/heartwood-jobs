// Timesheet hours -> .xlsx for accounts. Pure module (no Firebase). Hours only: no rates, pay or other finance data.
// Tiny dependency-free xlsx writer (stored zip + SpreadsheetML), so it works offline and on iPhone Safari.
import { entryList, paidShift, shiftHours, sortedEntries } from "./timesheet.js";

export const ACCOUNTS_TO = "accounts@heartwoodew.com";
const DAYS = 7;
const addD = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const r2 = h => Math.round((+h || 0) * 100) / 100;
const hm = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m ? (+m[1] * 60 + +m[2]) / 1440 : null; };
const serial = ds => (Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;
const dmy = ds => `${ds.slice(8, 10)}/${ds.slice(5, 7)}/${ds.slice(0, 4)}`;

// One row per shift. Week docs without entries fall back to the legacy days map.
export function shiftRows(sheet) {
  const entries = sortedEntries(sheet?.entries).map(paidShift);
  const rows = [], taken = new Set();
  for (const e of entries) {
    if (!e.date) continue; taken.add(e.date);
    const open = e.source === "clock" && e.status !== "closed" && !e.finish;
    const brk = e.breakStart && e.breakEnd ? `${e.breakStart}-${e.breakEnd}` : "";
    rows.push({ date: e.date, job: e.job || "", start: e.start || "", finish: e.finish || "", breakStart: e.breakStart || "", breakEnd: e.breakEnd || "",
      breakMins: brk ? null : 30, hours: r2(shiftHours(e)), source: e.source === "manual" ? "Manual" : "Clocked",
      note: [e.note || "", open ? "Not clocked off" : ""].filter(Boolean).join(" · ") });
  }
  for (const [ds, d] of Object.entries(sheet?.days || {})) {
    if (taken.has(ds) || !d) continue;
    const h = r2(shiftHours(d));
    if (!h && !d.note) continue;
    rows.push({ date: ds, job: "", start: d.start || "", finish: d.finish || "", breakStart: d.breakStart || "", breakEnd: d.breakEnd || "",
      breakMins: d.breakStart && d.breakEnd ? null : (h ? 30 : null), hours: h, source: "Manual", note: d.note || "" });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

// people: [{uid,name}], sheets: timesheet week docs, leaveText(person, date) -> "" or a label.
export function buildHoursReport({ weekStart, people, sheets, leaveText = () => "" }) {
  const weekEnd = addD(weekStart, DAYS - 1), out = [];
  for (const p of people) {
    const sheet = sheets.find(t => t.uid === p.uid) || null;
    const rows = sheet ? shiftRows(sheet) : [];
    const leave = [];
    for (let i = 0; i < DAYS; i++) { const ds = addD(weekStart, i), l = leaveText(p, ds); if (l) leave.push({ date: ds, label: l }); }
    if (!rows.length && !leave.length) continue;
    out.push({ name: p.name || "?", rows, leave, total: r2(rows.reduce((t, r) => t + r.hours, 0)), daysWorked: new Set(rows.filter(r => r.hours).map(r => r.date)).size });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { weekStart, weekEnd, people: out, total: r2(out.reduce((t, p) => t + p.total, 0)) };
}

// ---------- xlsx ----------
const X = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const col = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };
// style ids (cellXfs order below)
const S = { txt: 0, title: 1, sub: 2, head: 3, date: 4, time: 5, hrs: 6, totLbl: 7, totHrs: 8, grandLbl: 9, grandHrs: 10, int: 11, totInt: 12, grandInt: 13 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="ddd dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="h:mm AM/PM"/><numFmt numFmtId="166" formatCode="0.00"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FF555555"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border/><border><bottom style="thin"><color rgb="FF999999"/></bottom></border><border><top style="double"><color rgb="FF000000"/></top></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14">
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

export function reportSheets(rep, { company = "Heartwood", generated = new Date() } = {}) {
  const gen = generated.toLocaleString("en-AU", { timeZone: "Australia/Brisbane", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
  const title = [{ v: `${company} · Timesheet hours`, s: S.title }];
  const sub = [{ v: `Pay period ${dmy(rep.weekStart)} to ${dmy(rep.weekEnd)} · Generated ${gen} (Brisbane)`, s: S.sub }];
  const H = a => a.map(v => ({ v, s: S.head }));
  const t = v => { const x = hm(v); return x == null ? null : { v: x, s: S.time }; };
  // Summary
  const sum = [title, sub, H(["Staff", "Days worked", "Total hours", "Leave days", "Leave"])];
  for (const p of rep.people) sum.push([{ v: p.name }, { v: p.daysWorked, s: S.int }, { v: p.total, s: S.hrs }, { v: p.leave.length, s: S.int },
    { v: [...new Set(p.leave.map(l => l.label))].join(", ") }]);
  sum.push([{ v: "Grand total", s: S.grandLbl }, { v: rep.people.reduce((n, p) => n + p.daysWorked, 0), s: S.grandInt }, { v: rep.total, s: S.grandHrs },
    { v: rep.people.reduce((n, p) => n + p.leave.length, 0), s: S.grandInt }, { v: "", s: S.grandLbl }]);
  // Detail
  const det = [title, sub, H(["Staff", "Date", "Job", "Clock on", "Clock off", "Break", "Hours", "Type", "Notes"])];
  for (const p of rep.people) {
    const items = [...p.rows.map(r => ({ d: r.date, r })), ...p.leave.map(l => ({ d: l.date, l }))].sort((a, b) => a.d.localeCompare(b.d));
    for (const it of items) {
      if (it.l) { det.push([{ v: p.name }, { v: serial(it.d), s: S.date }, null, null, null, null, null, { v: "Leave" }, { v: it.l.label }]); continue; }
      const r = it.r, br = r.breakStart && r.breakEnd ? `${fmtT(r.breakStart)} to ${fmtT(r.breakEnd)}` : (r.breakMins ? `${r.breakMins} min lunch` : "");
      det.push([{ v: p.name }, { v: serial(r.date), s: S.date }, { v: r.job }, t(r.start), t(r.finish), { v: br }, { v: r.hours, s: S.hrs }, { v: r.source }, { v: r.note }]);
    }
    det.push([{ v: `${p.name} total`, s: S.totLbl }, ...Array(5).fill({ v: "", s: S.totLbl }), { v: p.total, s: S.totHrs }, { v: "", s: S.totLbl }, { v: "", s: S.totLbl }]);
  }
  det.push([{ v: "Grand total", s: S.grandLbl }, ...Array(5).fill({ v: "", s: S.grandLbl }), { v: rep.total, s: S.grandHrs }, { v: "", s: S.grandLbl }, { v: "", s: S.grandLbl }]);
  if (!rep.people.length) det.push([{ v: "No hours entered for this pay period." }]);
  return [{ name: "Summary", xml: sheetXml(sum, [26, 13, 13, 12, 30], 3) }, { name: "Detail", xml: sheetXml(det, [24, 17, 28, 11, 11, 20, 9, 10, 40], 3) }];
}
const fmtT = v => { const m = /^(\d{1,2}):(\d{2})$/.exec(v || ""); if (!m) return v || ""; const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h < 12 ? "am" : "pm"}`; };

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
