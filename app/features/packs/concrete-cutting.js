// Concrete cutting quote pack. Sawing is per linear metre by depth band.
// Core drilling is per hole by diameter and depth. Grinding and removal are by area.
// Machine hire is hourly, half day or day. Rates are A$ ex GST placeholders, starting points to review.
// Not an asbestos pack: these lines do not price asbestos removal.
import { calcMeasured, freezePack } from "./money.js";

const SAW_HINT = "Per linear metre at the depth band. Leave the length blank to leave it off the quote.";
const HIRE_HINT = "Machine with operator. Leave a hire line blank to leave it off the quote.";

function mm(id, rate, suffix) {
  return { id: String(id), label: "Up to " + id + " mm" + (suffix || ""), defaultRate: rate };
}

function depthCut(id, packageId, label, rates) {
  const bands = [100, 150, 200, 300];
  return {
    id, package: packageId, label, lineType: "labour", measure: "linear", unit: "m", wastePct: 0,
    optionLabel: "Depth", hint: SAW_HINT,
    options: bands.map((band, i) => mm(band, rates[i])),
  };
}

function machineHire(prefix, packageId, label, hour, half, day) {
  return [
    { id: prefix + "h", package: packageId, label: label + " — hourly", lineType: "hire", measure: "hours", unit: "h", defaultRate: hour, qtyLabel: "Hours", hint: HIRE_HINT },
    { id: prefix + "half", package: packageId, label: label + " — half day", lineType: "hire", measure: "each", unit: "each", defaultRate: half, qtyLabel: "Half days" },
    { id: prefix + "day", package: packageId, label: label + " — day", lineType: "hire", measure: "each", unit: "each", defaultRate: day, qtyLabel: "Days" },
  ];
}

const HAND_SAW = [125, 450, 780];

export const CONCRETE_CUTTING = freezePack({
  id: "concrete-cutting",
  label: "Concrete Cutting",
  defaultsNote: "Starting-point defaults to review. Prices are A$ ex GST placeholders: sawing per linear metre by depth, core holes by diameter and depth, grinding and removal by area, and machines by the hour, half day or day. Not for asbestos.",
  packages: [
    { id: "floor", label: "Floor sawing", blurb: "Road or slab saw, per metre by depth" },
    { id: "wall", label: "Wall sawing", blurb: "Wall saw, per metre by depth" },
    { id: "core", label: "Core drilling", blurb: "Per hole by diameter and depth" },
    { id: "wire", label: "Wire sawing", blurb: "Wire saw, per metre by depth" },
    { id: "hand", label: "Hand/ring sawing", blurb: "Hand or ring saw, per metre by depth" },
    { id: "joint", label: "Control joint cutting", blurb: "Sawn joints, per metre by depth" },
    { id: "crack", label: "Crack chasing", blurb: "Chase along a crack, per metre by depth" },
    { id: "break", label: "Concrete removal", blurb: "Break out by area, plus a demo hammer" },
    { id: "grind", label: "Floor grinding", blurb: "Grinding by square metre" },
    { id: "scan", label: "Scanning / GPR", blurb: "Locate services before cutting" },
  ],
  lines: [
    depthCut("floor", "floor", "Floor sawing", [28, 42, 58, 95]),
    ...machineHire("road", "floor", "Road saw", 165, 580, 980),
    depthCut("wall", "wall", "Wall sawing", [48, 68, 92, 135]),
    ...machineHire("wall", "wall", "Wall saw", 195, 720, 1250),
    {
      id: "core", package: "core", label: "Core drilling", lineType: "labour", measure: "each", unit: "each",
      qtyLabel: "Holes", styleLabel: "Diameter", heightLabel: "Depth",
      hint: "Per hole. Pick the diameter and the depth.",
      styles: [
        { id: "50", label: "Up to 50 mm dia", heights: [mm(100, 32, " deep"), mm(200, 45, " deep"), mm(300, 58, " deep"), mm(450, 78, " deep")] },
        { id: "100", label: "Up to 100 mm dia", heights: [mm(100, 55, " deep"), mm(200, 75, " deep"), mm(300, 98, " deep"), mm(450, 135, " deep")] },
        { id: "150", label: "Up to 150 mm dia", heights: [mm(100, 85, " deep"), mm(200, 115, " deep"), mm(300, 160, " deep"), mm(450, 220, " deep")] },
        { id: "200", label: "Up to 200 mm dia", heights: [mm(100, 120, " deep"), mm(200, 165, " deep"), mm(300, 230, " deep"), mm(450, 320, " deep")] },
      ],
    },
    ...machineHire("core", "core", "Core rig", 145, 520, 890),
    depthCut("wire", "wire", "Wire sawing", [90, 125, 165, 220]),
    ...machineHire("wire", "wire", "Wire saw", 240, 880, 1550),
    depthCut("hand", "hand", "Hand/ring sawing", [36, 52, 74, 110]),
    ...machineHire("hand", "hand", "Hand saw", ...HAND_SAW),
    depthCut("joint", "joint", "Control joint cutting", [14, 18, 24, 36]),
    ...machineHire("jhand", "joint", "Hand saw", ...HAND_SAW),
    {
      id: "crack", package: "crack", label: "Crack chasing", lineType: "labour", measure: "linear", unit: "m", wastePct: 0,
      optionLabel: "Depth", hint: "Shallow chase along a crack, per linear metre.",
      options: [mm(25, 16), mm(40, 22), mm(50, 28), mm(100, 40)],
    },
    ...machineHire("chand", "crack", "Hand saw", ...HAND_SAW),
    { id: "breakout", package: "break", label: "Concrete removal and breaking", lineType: "waste", measure: "area", unit: "m2", defaultRate: 75, wastePct: 0, hint: "Area broken out and removed. Demo hammer time is separate." },
    ...machineHire("demo", "break", "Demo hammer", 95, 340, 580),
    {
      id: "grind", package: "grind", label: "Floor grinding", lineType: "labour", measure: "area", unit: "m2", wastePct: 0,
      optionLabel: "Finish",
      options: [
        { id: "light", label: "Light grind", defaultRate: 18 },
        { id: "standard", label: "Standard grind", defaultRate: 28 },
        { id: "heavy", label: "Heavy grind or coating removal", defaultRate: 48 },
      ],
    },
    { id: "scan", package: "scan", label: "Scanning / GPR", lineType: "labour", measure: "area", unit: "m2", defaultRate: 8, wastePct: 0, hint: "Locating services before cutting. Area of the scan." },
    { id: "callout", package: "shared", label: "Minimum call-out", lineType: "labour", measure: "each", unit: "each", defaultRate: 280, qtyLabel: "Call-outs", hint: "Minimum charge for the visit. Leave blank to price the measured work only." },
    { id: "slurry", package: "shared", label: "Slurry vacuum and cleanup", lineType: "waste", measure: "hours", unit: "h", defaultRate: 110, qtyLabel: "Hours" },
    { id: "travel", package: "shared", label: "Travel", lineType: "hire", measure: "each", unit: "km", defaultRate: 3, qtyLabel: "Km" },
    { id: "labour", package: "shared", label: "Crew labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 92, fromHours: true },
  ],
});

export function calcConcreteCutting(input, companyRates) {
  return calcMeasured(CONCRETE_CUTTING, input, companyRates);
}
