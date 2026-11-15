// Plumbing quote pack. Job templates with parts, a labour add-on, and certificate or permit costs.
// Rates are A$ ex GST placeholders. A certificate is a quote line only, not a field required to finish the job.
import { calcMeasured, freezePack } from "./money.js";

const CERT_HINT = "Optional cost on the quote. Not required before the job can be marked done.";

export const PLUMBING = freezePack({
  id: "plumbing",
  label: "Plumbing",
  defaultsNote: "Starting-point defaults to review. Prices are A$ ex GST placeholders. Pick a job template, then add parts, labour, and any permit or certificate.",
  packages: [
    { id: "rough", label: "Rough-in", blurb: "Points and pipe, plus labour" },
    { id: "fitoff", label: "Fit-off", blurb: "Fixtures and fit-off labour" },
    { id: "drain", label: "Drainage", blurb: "Pipe and pits, plus waste" },
    { id: "gas", label: "Gas", blurb: "Gas points and pipe" },
  ],
  lines: [
    { id: "points", package: "rough", label: "Rough-in points", lineType: "labour", measure: "each", unit: "each", defaultRate: 165, qtyLabel: "Points" },
    { id: "pipe", package: "rough", label: "Pipe and fittings", lineType: "material", measure: "linear", unit: "m", defaultRate: 42, wastePct: 10 },
    { id: "fixtures", package: "fitoff", label: "Fixtures", lineType: "material", measure: "each", unit: "each", defaultRate: 240, qtyLabel: "Fixtures" },
    { id: "fitlabour", package: "fitoff", label: "Fit-off labour", lineType: "labour", measure: "each", unit: "each", defaultRate: 95, qtyLabel: "Fixtures" },
    { id: "drainpipe", package: "drain", label: "Drainage pipe", lineType: "material", measure: "linear", unit: "m", defaultRate: 68, wastePct: 10 },
    { id: "pits", package: "drain", label: "Pits and gullies", lineType: "material", measure: "each", unit: "each", defaultRate: 185, qtyLabel: "Pits" },
    { id: "gaspoints", package: "gas", label: "Gas points", lineType: "labour", measure: "each", unit: "each", defaultRate: 195, qtyLabel: "Points" },
    { id: "gaspipe", package: "gas", label: "Gas pipe", lineType: "material", measure: "linear", unit: "m", defaultRate: 52, wastePct: 8 },
    { id: "labouradd", package: "shared", label: "Labour add-on", lineType: "labour", measure: "hours", unit: "h", defaultRate: 98, qtyLabel: "Hours" },
    { id: "permit", package: "shared", label: "Plumbing permit", lineType: "compliance", measure: "each", unit: "each", defaultRate: 290, qtyLabel: "Permits", hint: CERT_HINT },
    { id: "certificate", package: "shared", label: "Plumbing compliance certificate", lineType: "compliance", measure: "each", unit: "each", defaultRate: 175, qtyLabel: "Certificates", hint: CERT_HINT },
    { id: "labour", package: "shared", label: "Crew labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 98, fromHours: true },
  ],
});

export function calcPlumbing(input, companyRates) {
  return calcMeasured(PLUMBING, input, companyRates);
}
