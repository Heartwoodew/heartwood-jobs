// Tiling quote pack. Templates are floor, wall, wet area and labour-only take-offs.
// Quantities are area or linear metres plus a waste %. Rates are A$ ex GST placeholders.
import { calcMeasured, freezePack } from "./money.js";

export const TILING = freezePack({
  id: "tiling",
  label: "Tiling",
  defaultsNote: "Starting-point defaults to review. Prices are A$ ex GST placeholders. Take-offs are area or linear metres plus waste. Wet area includes membrane. Labour-only has no tiles.",
  packages: [
    { id: "floor", label: "Floor take-off", blurb: "Floor tiles, screed and trim, plus waste" },
    { id: "wall", label: "Wall take-off", blurb: "Wall tiles and trim, plus waste" },
    { id: "wet", label: "Wet area", blurb: "Floor, wall and waterproofing, with a higher waste %" },
    { id: "labour", label: "Labour only", blurb: "Hours only. No tiles or membrane." },
  ],
  lines: [
    { id: "floor", package: "floor", label: "Floor tiles supply and lay", lineType: "material", measure: "area", unit: "m2", defaultRate: 88, wastePct: 10 },
    { id: "screed", package: "floor", label: "Screed", lineType: "material", measure: "area", unit: "m2", defaultRate: 52, wastePct: 5 },
    { id: "floortrim", package: "floor", label: "Floor trim", lineType: "material", measure: "linear", unit: "m", defaultRate: 16, wastePct: 10 },
    { id: "wall", package: "wall", label: "Wall tiles supply and lay", lineType: "material", measure: "area", unit: "m2", defaultRate: 96, wastePct: 12, widthLabel: "Height m", hint: "Take-off is length × height, plus waste." },
    { id: "walltrim", package: "wall", label: "Wall trim", lineType: "material", measure: "linear", unit: "m", defaultRate: 18, wastePct: 10 },
    { id: "wetfloor", package: "wet", label: "Wet area floor tiles", lineType: "material", measure: "area", unit: "m2", defaultRate: 98, wastePct: 15 },
    { id: "wetwall", package: "wet", label: "Wet area wall tiles", lineType: "material", measure: "area", unit: "m2", defaultRate: 115, wastePct: 15, widthLabel: "Height m" },
    { id: "membrane", package: "wet", label: "Waterproof membrane", lineType: "material", measure: "area", unit: "m2", defaultRate: 58, wastePct: 10, hint: "Wet-area membrane take-off. Not a test result, and not required before the job can be marked done." },
    { id: "tilelabour", package: "labour", label: "Tiler labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 78, qtyLabel: "Hours", hint: "Labour only. No tiles or membrane on this template." },
    { id: "labour", package: "shared", label: "Crew labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 78, fromHours: true },
  ],
});

export function calcTiling(input, companyRates) {
  return calcMeasured(TILING, input, companyRates);
}
