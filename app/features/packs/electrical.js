// Electrical quote pack. Job templates with parts, a labour add-on, and certificate or permit costs.
// Rates are A$ ex GST placeholders. A certificate is a quote line only, not a test result required to finish the job.
import { calcMeasured, freezePack } from "./money.js";

const CERT_HINT = "Optional cost on the quote. Not a test result, and not required before the job can be marked done.";

export const ELECTRICAL = freezePack({
  id: "electrical",
  label: "Electrical",
  defaultsNote: "Starting-point defaults to review. Prices are A$ ex GST placeholders. Pick a job template, then add parts, labour, and any permit or certificate.",
  packages: [
    { id: "rough", label: "Rough-in", blurb: "Points, cable and fittings" },
    { id: "fitoff", label: "Fit-off", blurb: "Fittings and fit-off labour" },
    { id: "fault", label: "Fault finding", blurb: "Call-out and replacement parts" },
  ],
  lines: [
    { id: "epoints", package: "rough", label: "Rough-in points", lineType: "labour", measure: "each", unit: "each", defaultRate: 85, qtyLabel: "Points" },
    { id: "cable", package: "rough", label: "Cable", lineType: "material", measure: "linear", unit: "m", defaultRate: 12, wastePct: 15 },
    { id: "efittings", package: "rough", label: "Rough-in fittings", lineType: "material", measure: "each", unit: "each", defaultRate: 32, qtyLabel: "Fittings" },
    { id: "fitfittings", package: "fitoff", label: "Fit-off fittings", lineType: "material", measure: "each", unit: "each", defaultRate: 48, qtyLabel: "Fittings" },
    { id: "fitlabour", package: "fitoff", label: "Fit-off labour", lineType: "labour", measure: "each", unit: "each", defaultRate: 55, qtyLabel: "Points" },
    { id: "callout", package: "fault", label: "Call-out", lineType: "labour", measure: "each", unit: "each", defaultRate: 150, qtyLabel: "Call-outs" },
    { id: "faultparts", package: "fault", label: "Replacement parts", lineType: "material", measure: "each", unit: "each", defaultRate: 45, qtyLabel: "Parts" },
    { id: "labouradd", package: "shared", label: "Labour add-on", lineType: "labour", measure: "hours", unit: "h", defaultRate: 98, qtyLabel: "Hours" },
    { id: "permit", package: "shared", label: "Electrical permit", lineType: "compliance", measure: "each", unit: "each", defaultRate: 340, qtyLabel: "Permits", hint: CERT_HINT },
    { id: "certificate", package: "shared", label: "Electrical safety certificate", lineType: "compliance", measure: "each", unit: "each", defaultRate: 175, qtyLabel: "Certificates", hint: CERT_HINT },
    { id: "labour", package: "shared", label: "Crew labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 98, fromHours: true },
  ],
});

export function calcElectrical(input, companyRates) {
  return calcMeasured(ELECTRICAL, input, companyRates);
}
