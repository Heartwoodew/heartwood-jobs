// Carpentry quote pack. Templates are take-offs (area or linear metres) plus a waste %.
// Wet area and labour-only are templates. Rates are A$ ex GST placeholders, starting points to review.
import { calcMeasured, freezePack } from "./money.js";

export const CARPENTRY = freezePack({
  id: "carpentry",
  label: "Carpentry",
  defaultsNote: "Starting-point defaults to review. Prices are A$ ex GST placeholders. Take-offs use area or linear metres plus waste. Labour-only has no materials.",
  packages: [
    { id: "frame", label: "Framing take-off", blurb: "Wall area and framing timber, plus waste" },
    { id: "deck", label: "Deck take-off", blurb: "Deck area and balustrade, plus waste" },
    { id: "fitout", label: "Fit-out take-off", blurb: "Skirting, architrave and doors, plus waste" },
    { id: "wet", label: "Wet area", blurb: "Wet-area lining and vanity carpentry" },
    { id: "labour", label: "Labour only", blurb: "Hours only. No materials." },
  ],
  lines: [
    { id: "sheets", package: "frame", label: "Wall lining", lineType: "material", measure: "area", unit: "m2", defaultRate: 48, wastePct: 10, widthLabel: "Height m", hint: "Take-off is length × height, plus waste." },
    { id: "framing", package: "frame", label: "Framing timber", lineType: "material", measure: "linear", unit: "m", defaultRate: 32, wastePct: 8 },
    { id: "deck", package: "deck", label: "Deck supply and install", lineType: "material", measure: "area", unit: "m2", defaultRate: 260, wastePct: 10 },
    { id: "balustrade", package: "deck", label: "Balustrade", lineType: "material", measure: "linear", unit: "m", defaultRate: 165, wastePct: 5 },
    { id: "skirting", package: "fitout", label: "Skirting", lineType: "material", measure: "linear", unit: "m", defaultRate: 22, wastePct: 10 },
    { id: "architrave", package: "fitout", label: "Architrave", lineType: "material", measure: "linear", unit: "m", defaultRate: 26, wastePct: 10 },
    { id: "doors", package: "fitout", label: "Door hang and fit", lineType: "labour", measure: "each", unit: "each", defaultRate: 240, qtyLabel: "Doors" },
    { id: "lining", package: "wet", label: "Wet area lining", lineType: "material", measure: "area", unit: "m2", defaultRate: 78, wastePct: 12, widthLabel: "Height m", hint: "Wet-area sheet take-off. Nothing here is required before the job can be marked done." },
    { id: "vanity", package: "wet", label: "Vanity and bath carpentry", lineType: "labour", measure: "each", unit: "each", defaultRate: 420, qtyLabel: "Items" },
    { id: "labourhours", package: "labour", label: "Carpenter labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 85, qtyLabel: "Hours", hint: "Labour only. No materials on this template." },
    { id: "labour", package: "shared", label: "Crew labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 85, fromHours: true },
  ],
});

export function calcCarpentry(input, companyRates) {
  return calcMeasured(CARPENTRY, input, companyRates);
}
