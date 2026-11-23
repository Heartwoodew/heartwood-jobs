// Industry packs on top of the trade picker. Earthworks stays the default plant wizard.
// Prices are A$ ex GST placeholders to review, the same idea as the other measured packs.
// Nothing here writes. A company edits titles, checklists, photo steps and prices afterwards.
import { freezePack } from "./money.js";

const NOTE = "Starting-point defaults to review. Prices are A$ ex GST placeholders, not this company's rates, until you save one as the company default.";

function measured(id, label, lines) {
  return freezePack({
    id,
    label,
    defaultsNote: NOTE,
    packages: [{ id: "standard", label: "Sample items", blurb: "Editable sample lines for this industry" }],
    lines,
  });
}

const shared = (row) => ({ package: "shared", wastePct: 0, ...row });

export const CLEANING = measured("cleaning", "Cleaning crews", [
  shared({ id: "cl-builders-line", label: "Builders' clean", lineType: "labour", measure: "each", unit: "each", defaultRate: 450 }),
  shared({ id: "cl-eol-line", label: "End-of-lease clean", lineType: "labour", measure: "each", unit: "each", defaultRate: 380 }),
  shared({ id: "cl-commercial-line", label: "Commercial clean", lineType: "labour", measure: "hours", unit: "h", defaultRate: 55, qtyLabel: "Hours" }),
  shared({ id: "cl-labour", label: "Cleaner labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 48, fromHours: true }),
]);

export const PROPERTY_MAINTENANCE = measured("property-maintenance", "Property maintenance", [
  shared({ id: "pm-handy-line", label: "Handyman", lineType: "labour", measure: "hours", unit: "h", defaultRate: 75, qtyLabel: "Hours" }),
  shared({ id: "pm-lawn-line", label: "Lawn and garden", lineType: "labour", measure: "each", unit: "each", defaultRate: 90 }),
  shared({ id: "pm-gutter-line", label: "Gutters", lineType: "labour", measure: "linear", unit: "m", defaultRate: 8 }),
  shared({ id: "pm-pressure-line", label: "Pressure washing", lineType: "labour", measure: "area", unit: "m2", defaultRate: 12 }),
  shared({ id: "pm-labour", label: "Crew labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 65, fromHours: true }),
]);

export const PEST_CONTROL = measured("pest-control", "Pest control", [
  shared({ id: "pc-general-line", label: "General pest treatment", lineType: "compliance", measure: "each", unit: "each", defaultRate: 220 }),
  shared({ id: "pc-termite-line", label: "Termite inspection", lineType: "compliance", measure: "each", unit: "each", defaultRate: 280 }),
  shared({ id: "pc-treat-line", label: "Termite treatment", lineType: "compliance", measure: "linear", unit: "m", defaultRate: 45 }),
  shared({ id: "pc-labour", label: "Technician", lineType: "labour", measure: "hours", unit: "h", defaultRate: 85, fromHours: true }),
]);

export const SKIP_BINS = measured("skip-bins", "Skip bins and rubbish", [
  shared({ id: "sk-bin-line", label: "Skip bin", lineType: "waste", measure: "each", unit: "each", defaultRate: 320, qtyLabel: "Bins" }),
  shared({ id: "sk-m3-line", label: "Rubbish removal", lineType: "waste", measure: "volume", unit: "m3", defaultRate: 85 }),
  shared({ id: "sk-t-line", label: "Rubbish by weight", lineType: "waste", measure: "each", unit: "t", defaultRate: 95, qtyLabel: "Tonnes" }),
  shared({ id: "sk-loads-line", label: "Truck loads", lineType: "waste", measure: "each", unit: "loads", defaultRate: 180, qtyLabel: "Loads" }),
  shared({ id: "sk-demo-line", label: "Demolition labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 78, qtyLabel: "Hours" }),
  shared({ id: "sk-tip-line", label: "Tip fees", lineType: "waste", measure: "each", unit: "each", defaultRate: 140, qtyLabel: "Dockets" }),
]);

export const POOLS = measured("pools", "Pools and irrigation", [
  shared({ id: "po-build-line", label: "Pool build", lineType: "material", measure: "each", unit: "each", defaultRate: 4500 }),
  shared({ id: "po-service-line", label: "Pool service", lineType: "labour", measure: "each", unit: "each", defaultRate: 120 }),
  shared({ id: "po-irrigation-line", label: "Irrigation", lineType: "material", measure: "linear", unit: "m", defaultRate: 35 }),
  shared({ id: "po-labour", label: "Crew labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 70, fromHours: true }),
]);

export const SOLAR_AIRCON = measured("solar-aircon", "Solar and air conditioning", [
  shared({ id: "sa-solar-line", label: "Solar install", lineType: "material", measure: "each", unit: "each", defaultRate: 1800, qtyLabel: "Systems" }),
  shared({ id: "sa-ac-line", label: "Air conditioning install", lineType: "material", measure: "each", unit: "each", defaultRate: 1450, qtyLabel: "Units" }),
  shared({ id: "sa-service-line", label: "Service call", lineType: "labour", measure: "each", unit: "each", defaultRate: 180 }),
  shared({ id: "sa-labour", label: "Installer labour", lineType: "labour", measure: "hours", unit: "h", defaultRate: 85, fromHours: true }),
]);

export const TRAFFIC_CIVIL = measured("traffic-civil", "Traffic control and civil", [
  shared({ id: "tc-traffic-line", label: "Traffic controller", lineType: "labour", measure: "hours", unit: "h", defaultRate: 72, qtyLabel: "Hours" }),
  shared({ id: "tc-crew-line", label: "Crew allocation", lineType: "labour", measure: "hours", unit: "h", defaultRate: 68, qtyLabel: "Crew hours" }),
  shared({ id: "tc-civil-line", label: "Civil works", lineType: "hire", measure: "hours", unit: "h", defaultRate: 160, qtyLabel: "Hours" }),
  shared({ id: "tc-swms-line", label: "SWMS and prestart", lineType: "compliance", measure: "each", unit: "each", defaultRate: 0 }),
]);

export const TRAFFIC_CONTROL = measured("traffic-control", "Traffic control", [
  shared({ id: "tc-traffic-line", label: "Traffic controller", lineType: "labour", measure: "hours", unit: "h", defaultRate: 72, qtyLabel: "Hours" }),
  shared({ id: "tc-crew-line", label: "Crew allocation", lineType: "labour", measure: "hours", unit: "h", defaultRate: 68, qtyLabel: "Crew hours" }),
  shared({ id: "tc-swms-line", label: "SWMS and prestart", lineType: "compliance", measure: "each", unit: "each", defaultRate: 0 }),
]);

export const CIVIL_EARTHWORKS = measured("civil-earthworks", "Civil and earthworks", [
  shared({ id: "ce-civil-line", label: "Civil works", lineType: "hire", measure: "hours", unit: "h", defaultRate: 160, qtyLabel: "Hours" }),
  shared({ id: "ce-plant-line", label: "Plant and operator", lineType: "hire", measure: "hours", unit: "h", defaultRate: 150, qtyLabel: "Hours" }),
  shared({ id: "ce-swms-line", label: "SWMS and prestart", lineType: "compliance", measure: "each", unit: "each", defaultRate: 0 }),
]);

export const SERVICE_PACKS = Object.freeze({
  cleaning: CLEANING,
  "property-maintenance": PROPERTY_MAINTENANCE,
  "pest-control": PEST_CONTROL,
  "skip-bins": SKIP_BINS,
  pools: POOLS,
  "solar-aircon": SOLAR_AIRCON,
  "traffic-control": TRAFFIC_CONTROL,
  "civil-earthworks": CIVIL_EARTHWORKS,
  "traffic-civil": TRAFFIC_CIVIL,
});

// Customers named on the preset are who the sample jobs are written for. Branding stays the company's own.
export const SERVICE_TRADES = Object.freeze([
  {
    id: "cleaning",
    label: "Cleaning crews",
    customers: "Builders, property managers and tenants",
    titles: ["Admin", "Operations manager", "Supervisor", "Leading hand", "Cleaner", "Labourer"],
    jobTypes: [["cl-builders", "Builders' clean"], ["cl-eol", "End of lease"], ["cl-commercial", "Commercial clean"], ["cl-other", "Other"]],
  },
  {
    id: "property-maintenance",
    label: "Property maintenance",
    customers: "Real estate agents and strata",
    titles: ["Admin", "Operations manager", "Supervisor", "Handyman", "Gardener", "Labourer"],
    jobTypes: [["pm-handy", "Handyman"], ["pm-lawn", "Lawn and garden"], ["pm-gutter", "Gutters"], ["pm-pressure", "Pressure washing"], ["pm-other", "Other"]],
  },
  {
    id: "pest-control",
    label: "Pest control",
    customers: "Home owners, agents and strata",
    titles: ["Admin", "Operations manager", "Licensed pest technician", "Termite inspector", "Labourer"],
    jobTypes: [["pc-general", "General pest"], ["pc-termite", "Termite inspection"], ["pc-treat", "Termite treatment"], ["pc-other", "Other"]],
  },
  {
    id: "skip-bins",
    label: "Skip bins and rubbish",
    customers: "Builders and householders",
    titles: ["Admin", "Operations manager", "Supervisor", "Truck driver", "Operator", "Labourer"],
    jobTypes: [["sk-bin", "Skip bin"], ["sk-rubbish", "Rubbish removal"], ["sk-demo", "Demolition"], ["sk-other", "Other"]],
  },
  {
    id: "pools",
    label: "Pools and irrigation",
    customers: "Home owners and builders",
    titles: ["Admin", "Operations manager", "Pool builder", "Pool technician", "Irrigator", "Labourer"],
    jobTypes: [["po-build", "Pool build"], ["po-service", "Pool service"], ["po-irrigation", "Irrigation"], ["po-other", "Other"]],
  },
  {
    id: "solar-aircon",
    label: "Solar and air conditioning",
    customers: "Home owners and builders",
    titles: ["Admin", "Operations manager", "Solar installer", "Air conditioning installer", "Apprentice electrician", "Labourer"],
    jobTypes: [["sa-solar", "Solar install"], ["sa-ac", "Air conditioning"], ["sa-service", "Service call"], ["sa-other", "Other"]],
  },
  {
    id: "traffic-control",
    label: "Traffic control",
    customers: "Civil contractors and councils",
    titles: ["Admin", "Operations manager", "Supervisor", "Traffic controller", "Leading hand", "Labourer"],
    jobTypes: [["tc-traffic", "Traffic control"], ["tc-other", "Other"]],
  },
  {
    id: "civil-earthworks",
    label: "Civil and earthworks",
    customers: "Civil contractors",
    titles: ["Admin", "Operations manager", "Supervisor", "Leading hand", "Plant operator", "Labourer"],
    jobTypes: [["tc-civil", "Civil works"], ["ce-earth", "Bulk earthworks"], ["ce-other", "Other"]],
  },
]);

const step = (id, label, jobTypes, required = true) => ({ id, label, jobTypes, required, custom: false });
const check = (id, label, jobTypes) => ({ id, label, jobTypes, custom: false });

// Earthworks site cleans keep a short default. The other rows belong to the new industries.
export const INDUSTRY_PRESETS = Object.freeze({
  earthworks: {
    checklists: [
      check("ew-clean-arrive", "Walk the site and note what is in the way", ["clean"]),
      check("ew-clean-rubbish", "Load rubbish and keep spoil off the backslab", ["clean"]),
      check("ew-clean-leave", "Leave the site clear and the gates as you found them", ["clean"]),
    ],
    photoSteps: [
      step("ew-clean-before", "Before photo", ["clean"]),
      step("ew-clean-after", "After photo", ["clean"]),
    ],
  },
  cleaning: {
    checklists: [
      check("cl-scope", "Confirm the rooms or areas on the scope", ["cl-builders", "cl-eol", "cl-commercial", "cl-other"]),
      check("cl-wet", "Wet areas, kitchen and floors", ["cl-builders", "cl-eol", "cl-commercial"]),
      check("cl-keys", "Keys, oven and carpets checked for an end of lease", ["cl-eol"]),
      check("cl-walk", "Final walkthrough with the site contact", ["cl-builders", "cl-eol", "cl-commercial", "cl-other"]),
    ],
    photoSteps: [
      step("cl-before", "Before photo", ["cl-builders", "cl-eol", "cl-commercial", "cl-other"]),
      step("cl-after", "After photo", ["cl-builders", "cl-eol", "cl-commercial", "cl-other"]),
    ],
  },
  "property-maintenance": {
    checklists: [
      check("pm-access", "Confirm access with the agent or strata", ["pm-handy", "pm-lawn", "pm-gutter", "pm-pressure", "pm-other"]),
      check("pm-work", "Do the listed work and note anything extra", ["pm-handy", "pm-lawn", "pm-gutter", "pm-pressure", "pm-other"]),
    ],
    photoSteps: [
      step("pm-before", "Before photo", ["pm-handy", "pm-lawn", "pm-gutter", "pm-pressure", "pm-other"]),
      step("pm-after", "After photo", ["pm-handy", "pm-lawn", "pm-gutter", "pm-pressure", "pm-other"]),
    ],
  },
  "pest-control": {
    checklists: [
      check("pc-id", "Identify the pest and the areas", ["pc-general", "pc-termite", "pc-treat", "pc-other"]),
      check("pc-label", "Read the product label and record the chemical and rate", ["pc-general", "pc-treat"]),
      check("pc-report", "Inspection notes for the termite report", ["pc-termite"]),
    ],
    photoSteps: [
      step("pc-area", "Photo of the treated or inspected area", ["pc-general", "pc-termite", "pc-treat", "pc-other"]),
      step("pc-label-photo", "Photo of the product label", ["pc-general", "pc-treat"]),
    ],
  },
  "skip-bins": {
    checklists: [
      check("sk-book", "Bin or truck is on the schedule", ["sk-bin", "sk-rubbish", "sk-demo", "sk-other"]),
      check("sk-docket", "Tip docket or receipt attached", ["sk-bin", "sk-rubbish", "sk-demo", "sk-other"]),
    ],
    photoSteps: [
      step("sk-load", "Photo of the load", ["sk-bin", "sk-rubbish", "sk-demo", "sk-other"]),
      step("sk-docket-photo", "Photo of the tip docket", ["sk-bin", "sk-rubbish", "sk-demo", "sk-other"]),
      step("sk-after", "Site after the pickup", ["sk-rubbish", "sk-demo"]),
    ],
  },
  pools: {
    checklists: [
      check("po-water", "Check water and equipment", ["po-service"]),
      check("po-build-stage", "Confirm the build stage and access", ["po-build"]),
      check("po-irrig", "Run the irrigation and note leaks", ["po-irrigation"]),
    ],
    photoSteps: [
      step("po-before", "Before photo", ["po-build", "po-service", "po-irrigation", "po-other"]),
      step("po-equip", "Equipment photo", ["po-service", "po-irrigation"]),
      step("po-after", "After photo", ["po-build", "po-service", "po-irrigation", "po-other"]),
    ],
  },
  "solar-aircon": {
    checklists: [
      check("sa-roof", "Roof or wall access checked", ["sa-solar", "sa-ac", "sa-service", "sa-other"]),
      check("sa-isol", "Isolator and switchboard noted", ["sa-solar", "sa-ac"]),
      check("sa-test", "System tested with the customer", ["sa-solar", "sa-ac", "sa-service"]),
    ],
    photoSteps: [
      step("sa-before", "Before photo", ["sa-solar", "sa-ac", "sa-service", "sa-other"]),
      step("sa-board", "Switchboard photo", ["sa-solar", "sa-ac"]),
      step("sa-after", "After photo", ["sa-solar", "sa-ac", "sa-service", "sa-other"]),
    ],
  },
  "traffic-control": {
    checklists: [
      check("tc-prestart", "Plant prestart done before the shift", ["tc-traffic", "tc-other"]),
      check("tc-swms", "SWMS signed for this job", ["tc-traffic", "tc-other"]),
      check("tc-crew", "Crew allocated on the job", ["tc-traffic", "tc-other"]),
    ],
    photoSteps: [
      step("tc-setup", "Site setup photo", ["tc-traffic", "tc-other"]),
      step("tc-signs", "Signs and devices photo", ["tc-traffic"]),
      step("tc-pack", "Pack-down photo", ["tc-traffic", "tc-other"]),
    ],
  },
  "civil-earthworks": {
    checklists: [
      check("ce-prestart", "Plant prestart done before the shift", ["tc-civil", "ce-earth", "ce-other"]),
      check("ce-swms", "SWMS signed for this job", ["tc-civil", "ce-earth", "ce-other"]),
      check("ce-services", "Services and existing surfaces noted", ["tc-civil", "ce-earth", "ce-other"]),
    ],
    photoSteps: [
      step("ce-setup", "Site setup photo", ["tc-civil", "ce-earth", "ce-other"]),
      step("ce-pack", "Pack-down photo", ["tc-civil", "ce-earth", "ce-other"]),
    ],
  },
  "traffic-civil": {
    checklists: [
      check("tc-prestart", "Plant prestart done before the shift", ["tc-traffic", "tc-civil", "tc-other"]),
      check("tc-swms", "SWMS signed for this job", ["tc-traffic", "tc-civil", "tc-other"]),
      check("tc-crew", "Crew allocated on the job", ["tc-traffic", "tc-civil", "tc-other"]),
    ],
    photoSteps: [
      step("tc-setup", "Site setup photo", ["tc-traffic", "tc-civil", "tc-other"]),
      step("tc-signs", "Signs and devices photo", ["tc-traffic"]),
      step("tc-pack", "Pack-down photo", ["tc-traffic", "tc-civil", "tc-other"]),
    ],
  },
});

// Suggested repeat when an admin turns Repeat on for these job types. It is not applied until they tick Repeat.
export const RECURRENCE_HINTS = Object.freeze({
  "cl-commercial": { freq: "weekly", label: "Commercial cleans are often weekly" },
  "cl-eol": { freq: "monthly", label: "End-of-lease cleans are often monthly" },
  "pm-lawn": { freq: "fortnightly", label: "Lawns are often fortnightly" },
  "pc-general": { freq: "quarterly", label: "General pest visits are often quarterly" },
  "pc-termite": { freq: "yearly", label: "Termite inspections are often yearly" },
  "pc-treat": { freq: "yearly", label: "Termite treatments are often yearly" },
  "po-service": { freq: "weekly", label: "Pool servicing is often weekly" },
});
