// Fencing quote pack. Quantity is linear metres, with a height and a style.
// Posts, gates, concrete footings and old-fence removal are extras. Footings are priced each, not as a mix.
// Rates are A$ ex GST placeholders, starting points to review.
import { calcMeasured, freezePack } from "./money.js";

const height = (id, rate) => ({ id, label: id + " m", defaultRate: rate });

export const FENCING = freezePack({
  id: "fencing",
  label: "Fencing",
  defaultsNote: "Starting-point defaults to review. Prices are A$ ex GST placeholders for supply and install, per linear metre at the height you pick.",
  packages: [
    { id: "fence", label: "Fence", blurb: "Linear metres, height and style" },
  ],
  lines: [
    { id: "run", package: "fence", label: "Fence", lineType: "material", measure: "linear", unit: "m", wastePct: 0, styles: [
      { id: "colorbond", label: "Colorbond", heights: [height("1.5", 135), height("1.8", 155), height("2.1", 185)] },
      { id: "timber", label: "Timber paling", heights: [height("1.5", 110), height("1.8", 130), height("2.1", 160)] },
      { id: "pool", label: "Pool fence", heights: [height("1.2", 290)] },
      { id: "chain", label: "Chain wire", heights: [height("1.2", 65), height("1.8", 85), height("2.1", 105)] },
    ] },
    { id: "posts", package: "fence", label: "Extra posts", lineType: "material", measure: "each", unit: "each", defaultRate: 48, qtyLabel: "Posts" },
    { id: "gates", package: "fence", label: "Gates", lineType: "material", measure: "each", unit: "each", defaultRate: 480, qtyLabel: "Gates" },
    { id: "footings", package: "fence", label: "Concrete footings", lineType: "material", measure: "each", unit: "each", defaultRate: 42, qtyLabel: "Footings", hint: "Priced each. Not a mix calculation." },
    { id: "removal", package: "fence", label: "Old fence removal", lineType: "waste", measure: "linear", unit: "m", defaultRate: 32, wastePct: 0 },
    { id: "compliance", package: "fence", label: "Pool fence compliance certificate", lineType: "compliance", measure: "each", unit: "each", defaultRate: 250, qtyLabel: "Certificates" },
    { id: "labour", package: "shared", label: "Crew labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 72, fromHours: true },
  ],
});

export function calcFencing(input, companyRates) {
  return calcMeasured(FENCING, input, companyRates);
}
