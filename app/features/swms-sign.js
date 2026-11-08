import { DEFAULT_ORG, POWERED_BY, PRODUCT_NAME } from "../org-settings.js";

// SWMS sign-off maths and the signature document shape.
// The July 2026 PDFs are not in this repository. Nothing here invents
// hazards, controls, or work methods. A missing PDF stays a placeholder.

export const SWMS_VERSION = "2026-07";
export const SWMS_VALID_MONTHS = 12;
export const SWMS_DUE_DAYS = 30;

export const SWMS = [
  ["working-near-roads", "Working near roads", "Traffic, plant near live lanes"],
  ["mobile-plant", "Mobile plant", "Excavators, loaders, tippers"],
  ["working-with-silica", "Working with silica", "Dust from cutting, digging, concrete"],
  ["hazardous-substances", "Hazardous substances", "Fuels, oils, chemicals"],
  ["electrical", "Electrical & underground services", "Energised installations, services strikes"],
];

export const SWMS_IDS = SWMS.map(row => row[0]);

export function sigMs(s) {
  if (!s) return 0;
  if (typeof s.signedAtMs === "number" && Number.isFinite(s.signedAtMs)) return s.signedAtMs;
  if (s.signedAt && typeof s.signedAt.toMillis === "function") return s.signedAt.toMillis();
  return 0;
}

export function addMonths(ms, months) {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

export function sigExp(s, months = SWMS_VALID_MONTHS) {
  return addMonths(sigMs(s), months);
}

export function latestSig(list, uid, id) {
  return (list || []).filter(s => s && s.uid === uid && s.swmsId === id).sort((a, b) => sigMs(b) - sigMs(a))[0] || null;
}

// k: "ok" | "due" | "exp" | "none" | "old"
// Valid for 12 calendar months. Due when expiry is inside 30 days. At or past expiry, expired.
export function statusOf(sig, now = Date.now(), version = SWMS_VERSION) {
  if (!sig) return { k: "none", label: "Not signed", cls: "sw-exp" };
  const exp = sigExp(sig);
  const left = (exp - now) / 864e5;
  if (sig.version !== version) return { k: "old", label: "New version – re-sign", cls: "sw-exp", sig, exp };
  if (left <= 0) return { k: "exp", label: "Expired " + exp, cls: "sw-exp", sig, exp };
  if (left <= SWMS_DUE_DAYS) return { k: "due", label: "Due soon", cls: "sw-due", sig, exp };
  return { k: "ok", label: "Signed", cls: "sw-ok", sig, exp };
}

export function swmsSignatureData({ uid, name, swmsId, swmsTitle, jobId = "", jobLabel = "", sig, now, device = "" }) {
  const known = SWMS.find(row => row[0] === swmsId);
  return {
    uid,
    name: String(name || "").trim().slice(0, 80),
    swmsId,
    swmsTitle: String(swmsTitle || (known && known[1]) || "").slice(0, 80),
    version: SWMS_VERSION,
    jobId: String(jobId || "").slice(0, 200),
    jobLabel: String(jobLabel || "").slice(0, 160),
    sig,
    signedAtMs: now,
    expiresAtMs: addMonths(now, SWMS_VALID_MONTHS),
    device: String(device || "").slice(0, 200),
  };
}

// Shown only when the official PDF is not in swmsChunks. Not a SWMS.
// orgName is the customer, not the CallUp product name.
export function placeholderLines(title, orgName = DEFAULT_ORG.name) {
  return [
    "PLACEHOLDER - not a SWMS",
    "This page is not a Safe Work Method Statement.",
    "The official " + orgName + " PDF for this document",
    "is not in the jobs app repository and was not found",
    "in the company library (swmsChunks).",
    "Document name: " + String(title || "SWMS"),
    "Set: July 2026",
    "Do not send this file to a client as the SWMS.",
    "No hazards, controls or work methods are written here.",
    POWERED_BY,
  ];
}

export async function buildPlaceholderPdf(pdfLib, title, org = DEFAULT_ORG) {
  const { PDFDocument, StandardFonts, rgb } = pdfLib;
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = placeholderLines(title, org.name || DEFAULT_ORG.name);
  page.drawRectangle({ x: 0, y: 800, width: 595.28, height: 42, color: rgb(0.55, 0.08, 0.08) });
  page.drawText(lines[0], { x: 48, y: 816, size: 16, font: bold, color: rgb(1, 1, 1) });
  lines.slice(1).forEach((line, i) => {
    page.drawText(line, { x: 48, y: 740 - i * 22, size: 12, font, color: rgb(0.1, 0.1, 0.12) });
  });
  doc.setTitle("PLACEHOLDER - not a SWMS");
  doc.setAuthor(org.legalName || DEFAULT_ORG.legalName);
  doc.setCreator(PRODUCT_NAME);
  return doc.save();
}
