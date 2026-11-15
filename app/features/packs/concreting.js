// Concreting quote pack. One volume: length × width × depth, plus a waste %.
// Steel, formwork, pump hire and finish are line items. There is no mix design and no mix calculation.
// Rates are A$ ex GST placeholders, starting points to review.
import { calcMeasured, freezePack } from "./money.js";

export const CONCRETING = freezePack({
  id: "concreting",
  label: "Concreting",
  defaultsNote: "Starting-point defaults to review. Prices are A$ ex GST placeholders. Concrete is a volume only: length × width × depth, plus waste. No mix design.",
  packages: [
    { id: "pour", label: "Concrete", blurb: "Volume only" },
  ],
  lines: [
    { id: "concrete", package: "pour", group: "slab", groupLabel: "Slab", label: "Concrete supply and place", lineType: "material", measure: "volume", unit: "m3", defaultRate: 310, wastePct: 10, hint: "Volume is length × width × depth, plus waste. No mix design." },
    { id: "mesh", package: "pour", group: "slab", label: "Steel / mesh", lineType: "material", measure: "area", unit: "m2", defaultRate: 28, wastePct: 10, optional: true, defaultOn: true, includeLabel: "Include steel / mesh (uses the slab area)" },
    { id: "finish", package: "pour", group: "slab", label: "Finish", lineType: "labour", measure: "area", unit: "m2", wastePct: 10, optional: true, defaultOn: true, includeLabel: "Include a finish (uses the slab area)", options: [
      { id: "broom", label: "Broom", defaultRate: 12 },
      { id: "exposed", label: "Exposed aggregate", defaultRate: 45 },
      { id: "honed", label: "Honed", defaultRate: 65 },
      { id: "trowel", label: "Steel trowel", defaultRate: 18 },
    ] },
    { id: "formwork", package: "pour", label: "Formwork", lineType: "material", measure: "linear", unit: "m", defaultRate: 55, wastePct: 0 },
    { id: "pump", package: "pour", label: "Concrete pump hire", lineType: "hire", measure: "hours", unit: "h", defaultRate: 220, qtyLabel: "Hours" },
    { id: "labour", package: "shared", label: "Crew labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 78, fromHours: true },
  ],
});

export function calcConcreting(input, companyRates) {
  return calcMeasured(CONCRETING, input, companyRates);
}
