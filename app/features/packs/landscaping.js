// Landscaping quote pack. Rates are A$ ex GST placeholders for South East Queensland, starting points to review.
// Soft package: turf, garden beds, mulch, soil. Hard package: paving, retaining walls, edging.
// Machinery hire and green-waste disposal sit on every package. No prices are the company's until they save one.
import { calcMeasured, freezePack } from "./money.js";

export const LANDSCAPING = freezePack({
  id: "landscaping",
  label: "Landscaping",
  defaultsNote: "Starting-point defaults to review. Prices are A$ ex GST placeholders, not this company's rates, until you save one as the company default.",
  packages: [
    { id: "soft", label: "Soft landscaping", blurb: "Turf, garden beds, mulch and soil" },
    { id: "hard", label: "Hard landscaping", blurb: "Paving, retaining walls and edging" },
    { id: "both", label: "Soft and hard", blurb: "Both packages on one quote" },
  ],
  lines: [
    { id: "turf", package: "soft", label: "Turf supply and lay", lineType: "material", measure: "area", unit: "m2", defaultRate: 18, wastePct: 5 },
    { id: "beds", package: "soft", label: "Garden beds", lineType: "labour", measure: "area", unit: "m2", defaultRate: 42, wastePct: 0 },
    { id: "mulch", package: "soft", label: "Mulch", lineType: "material", measure: "volume", unit: "m3", defaultRate: 90, wastePct: 10 },
    { id: "soil", package: "soft", label: "Soil / garden mix", lineType: "material", measure: "volume", unit: "m3", defaultRate: 78, wastePct: 10 },
    { id: "paving", package: "hard", label: "Paving", lineType: "material", measure: "area", unit: "m2", defaultRate: 125, wastePct: 10 },
    { id: "retaining", package: "hard", label: "Retaining wall", lineType: "material", measure: "area", unit: "m2", defaultRate: 320, wastePct: 5, widthLabel: "Height m", hint: "Face area: length × height." },
    { id: "edging", package: "hard", label: "Edging", lineType: "material", measure: "linear", unit: "m", defaultRate: 38, wastePct: 5 },
    { id: "hire", package: "shared", label: "Machinery hire", lineType: "hire", measure: "hours", unit: "h", defaultRate: 145, qtyLabel: "Hours", hint: "Machine hire with an operator. Hours are the quantity." },
    { id: "greenwaste", package: "shared", label: "Green waste disposal", lineType: "waste", measure: "volume", unit: "m3", defaultRate: 68, wastePct: 0 },
    { id: "labour", package: "shared", label: "Crew labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 68, fromHours: true },
  ],
});

export function calcLandscaping(input, companyRates) {
  return calcMeasured(LANDSCAPING, input, companyRates);
}
