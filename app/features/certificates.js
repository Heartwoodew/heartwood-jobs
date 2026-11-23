// Industry certificates. The PDF uses the company's own name, ABN and contact details.
// It is stored as a normal job document, so office and assigned crew use the same
// access as other job files. Email is a separate admin action.
//
// The create/send panel is only for a company whose trades include pest control.
// Other trades do not see it. Existing certificate files on a job are left in place.
//
// Customer signature sign-off is not drawn on these PDFs. A later signature image
// would be an extra job document next to this file, not a field on the certificate.

import { quoteMailGate, quoteFromAddress } from "./quote-public.js";

export const CERTIFICATE_TEMPLATES = Object.freeze([
  {
    id: "pest-treatment",
    label: "Pest treatment certificate",
    trades: ["pest-control"],
    fields: [
      ["chemical", "Chemical"],
      ["rate", "Rate"],
      ["areas", "Areas treated"],
      ["technician", "Technician"],
      ["licence", "Licence number"],
      ["date", "Date"],
    ],
  },
  {
    id: "termite-inspection",
    label: "Termite inspection report",
    trades: ["pest-control"],
    fields: [
      ["summary", "Summary"],
      ["areas", "Areas inspected"],
      ["recommendation", "Recommendation"],
      ["technician", "Technician"],
      ["licence", "Licence number"],
      ["date", "Date"],
    ],
  },
  {
    id: "generic",
    label: "Certificate",
    trades: ["pest-control"],
    fields: [
      ["title", "Title"],
      ["details", "Details"],
      ["technician", "Technician"],
      ["licence", "Licence number"],
      ["date", "Date"],
    ],
  },
]);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const PEST_CONTROL_TRADE = "pest-control";

function asTradeList(value) {
  return Array.isArray(value) ? value : [];
}

/** Ids from the company record and the trade catalog. Does not invent earthworks, and does not write. */
export function tradeIdsFromCompany(company, stored) {
  const ids = [];
  const push = (list) => {
    for (const id of asTradeList(list)) {
      const clean = String(id || "").trim();
      if (clean) ids.push(clean);
    }
  };
  for (const src of [company, stored]) {
    if (!src || typeof src !== "object") continue;
    push(src.trades);
    push(src.enabled);
    if (src.trade) ids.push(String(src.trade).trim());
    push(src.extraTrades);
  }
  return ids;
}

export function includesPestControl(tradeIds) {
  return asTradeList(tradeIds).some(id => String(id) === PEST_CONTROL_TRADE);
}

/** Compliance certificates (panel, templates, email) are pest control only. */
export function certificatesEnabled(tradeIds) {
  return includesPestControl(tradeIds);
}

export function templatesForTrades(tradeIds) {
  if (!certificatesEnabled(tradeIds)) return [];
  const on = new Set(asTradeList(tradeIds).map(id => String(id)));
  return CERTIFICATE_TEMPLATES.filter(row => row.trades.includes("*") || row.trades.some(id => on.has(id)));
}

export function licenceNumbers(skills) {
  const out = [];
  for (const raw of Array.isArray(skills) ? skills : []) {
    const text = String(raw || "").trim().replace(/\s+/g, " ");
    if (!text || text.length > 40) continue;
    const prefixed = /^(?:licen[cs]e)\s*[:#-]\s*(.+)$/i.exec(text);
    if (prefixed && prefixed[1] && /\d/.test(prefixed[1])) out.push(prefixed[1].trim());
    else if (/\b(?:licen[cs]e|qbcc|pest)\b/i.test(text) && /\d/.test(text)) out.push(text);
  }
  return [...new Set(out)].slice(0, 6);
}

export function templateById(id) {
  return CERTIFICATE_TEMPLATES.find(row => row.id === id) || CERTIFICATE_TEMPLATES[CERTIFICATE_TEMPLATES.length - 1];
}

function cleanField(value) {
  return String(value ?? "").replace(/[\n\r\t<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
}

export function certificateValues(templateId, raw, { skills } = {}) {
  const template = templateById(templateId);
  const values = {};
  for (const [id] of template.fields) values[id] = cleanField(raw && raw[id]);
  if (!values.licence) {
    const found = licenceNumbers(skills);
    if (found[0]) values.licence = found[0];
  }
  const missing = template.fields.filter(([id]) => !values[id]).map(([id]) => id);
  return { ok: missing.length === 0, missing, values, template };
}

function ascii(value) {
  return String(value || "").replace(/[^\x20-\x7e]/g, " ").replace(/\s+/g, " ").trim();
}

function pdfEscape(value) {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** One-page PDF. Standard Helvetica, no embedded images, so tests can read the text. */
export function simplePdf(lines, title) {
  const body = ["BT", "/F1 12 Tf", "48 790 Td", "16 TL"];
  lines.map(line => ascii(line)).slice(0, 42).forEach((line, i) => {
    const text = `(${pdfEscape(line.slice(0, 110))}) Tj`;
    body.push(i === 0 ? text : `T* ${text}`);
  });
  body.push("ET");
  const stream = body.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i);
  return { bytes, title: ascii(title).slice(0, 80), text: pdf };
}

export function certificateLines(company, template, values, job) {
  const lines = [
    ascii((company && (company.legalName || company.name)) || "Certificate"),
    [company && company.abn ? `ABN ${company.abn}` : "", company && company.phone || "", company && company.email || ""].filter(Boolean).join("  "),
    company && company.address || "",
    "",
    template.label,
    job && job.client ? `Client: ${job.client}` : "",
    job && job.address ? `Site: ${job.address}` : "",
    "",
  ];
  for (const [id, label] of template.fields) lines.push(`${label}: ${values[id] || ""}`);
  lines.push("", "Issued for this job. Crew do not see prices on the job.");
  return lines.filter(line => line != null);
}

export function buildCertificate({ company, templateId, raw, skills, job }) {
  const filled = certificateValues(templateId, raw, { skills });
  if (!filled.ok) return { ok: false, reason: "missing", missing: filled.missing };
  const lines = certificateLines(company, filled.template, filled.values, job);
  const pdf = simplePdf(lines, filled.template.label);
  const fileName = `${filled.template.label}.pdf`.replace(/[^\w .()-]+/g, "").slice(0, 80);
  return { ok: true, ...filled, lines, pdf, fileName, visibility: "crew" };
}

export function planCertificateEmail({ to, company, job, fileName, pdfBase64, env, allowLiveMail }) {
  const gate = quoteMailGate(to, env, { allowLiveMail });
  if (!gate.ok) return gate;
  if (!pdfBase64 || String(pdfBase64).length > 2_000_000) return { ok: false, reason: "file" };
  const name = (company && company.name) || "CallUp";
  const payload = {
    from: quoteFromAddress(name),
    to: [gate.to],
    subject: `${name} certificate`.slice(0, 120),
    text: [
      `${name} sent a certificate for ${job && job.address ? job.address : "your job"}.`,
      "It is attached. Prices are not included.",
    ].join("\n"),
    attachments: [{ filename: fileName || "certificate.pdf", content: String(pdfBase64) }],
  };
  if (company && company.email) payload.reply_to = String(company.email).slice(0, 120);
  return { ok: true, held: gate.held === true, to: gate.to, payload };
}

export function certificatePanelHtml(job, { trades, skills, canEmail = false } = {}) {
  if (!certificatesEnabled(trades)) return "";
  const templates = templatesForTrades(trades);
  if (!templates.length) return "";
  const licence = licenceNumbers(skills)[0] || "";
  const first = templates[0] ? templates[0].id : "generic";
  const options = templates.map(row => `<option value="${esc(row.id)}">${esc(row.label)}</option>`).join("");
  const fields = templates.map(row => row.fields.map(([id, label]) => {
    const value = id === "licence" ? licence : "";
    const hidden = row.id === first ? "" : " hidden";
    return `<label data-cert-field="${esc(id)}" data-cert-for="${esc(row.id)}"${hidden}>${esc(label)}<input name="cert_${esc(id)}" maxlength="400" value="${esc(value)}"></label>`;
  }).join("")).join("");
  return `<section class="card cert-panel" id="certpanel">
    <h3>Certificate</h3>
    <p class="sub">Uses this company's name and details. The licence number comes from the technician's skills, for example Licence: PMT-12345. The PDF is filed on this job.</p>
    <label>Template<select name="certTemplate">${options}</select></label>
    ${fields}
    <div class="row">
      <button type="button" class="sm-btn primary" id="certsave">Save certificate on the job</button>
      ${canEmail ? `<label>Customer email<input name="certEmail" type="email" maxlength="120" placeholder="callup932+name@gmail.com"></label>
        <button type="button" class="sm-btn" id="certemail">Email certificate</button>` : ""}
    </div>
    <p id="certerr" class="err"></p>
  </section>`;
}

export function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
