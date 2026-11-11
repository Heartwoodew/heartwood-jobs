# Quotes

**Status: LIVE** on `main` `01f2c5a6f407e123f7f48432f07f1e9445a36007`, for people who `canSeeMoney()`. Operators have no Quotes nav (`canQuote`, `app/app.js` line 652). A supervisor on the operator shell opens Quotes from More (`renderOperator`, lines 1872–1878 and 1895).

The open PR that changes GST and a second operator is **not** this behaviour. See [12-open-and-planned.md](12-open-and-planned.md).

## What a quote is

`app/features/quotes.js` header (lines 1–8):

- Prices are ex GST. The review says “GST is not added here” (`stepHtml`, line 705).
- Rates come from `meta/quoteRates` only. The code does not invent a dollar rate. Empty rates leave the total incomplete.
- Draft and Accepted are the `quoteStatus` field.
- Admins edit rates. Supervisors can use rates and cannot save them (`canEditQuoteRates`).
- Depot default: `208-220 Holdsworth Rd, Chuwar QLD 4306` (`DEFAULT_DEPOT`, lines 10–13).
- Travel distance is Nominatim + OSRM. Straight-line is not billable km (line 8 and the travel error on lines 550–551).
- No GPS in this module (line 8).

## Machines on main

`FLEET_MACHINES` (lines 16–20): Truck, Skid steer (Bobcat, code CA), Excavator (JCB, code EX).

`EQUIPMENT_PRESETS` (lines 27–33): Truck only; Truck + skid; Truck + excavator; Truck + skid + excavator; Excavator only. Each preset lists a machine once. Comment (lines 23–25): the truck is never charged twice. The package rate includes the operator. An optional **labourer** is a separate rate (`labourerRate`), not a second operator record.

Hourly machine lines multiply by hours on site. Day-rate lines multiply by `machineDays` (default 1), not by hours (`calcQuote`, lines 128–136). If any machine is selected, the legacy `hourlyOnSite` rate is not added (lines 69–70 and 134).

If any used line has a quantity and a null rate, `totalEx` is null (line 135).

## Wizard

Three steps inside `openQuoteWizard` / `stepHtml` (from line 625):

1. Client, site address, hours, one category, scope. Error: `Client and site address are required.`
2. One preset, or the “Adjust machines” checkboxes (truck, skid, excavator). Optional labourer. Error: `Pick an equipment preset (truck and/or skid / excavator).`
3. Review. Travel can be one-way or return (×2) via **Calculate travel**. Materials quantity and rubbish loads are under “Travel, materials and rubbish”. Day-rate jobs ask for days.

Accept is blocked when the total is incomplete: `Set quote rates for every used line before accepting.` Hourly plant or an hourly labourer also needs hours: `Enter hours on site for hourly plant / labourer.` (`saveQuote`, lines 563–575).

**Save draft** writes `quotes/{id}` with `quoteStatus: "Draft"`. **Accept**:

- If that quote already has `jobId` and is Accepted: `Already accepted — existing job {id}` (lines 577–579).
- Otherwise `createJobFromQuote` (lines 708–736) adds a job with empty date and time, `status: "Scheduled"`, `source: "quote"`, `quoteStatus: "Accepted"`, the quote snapshot, `quoteAmount` and `poAmount` set to the ex GST total, `poAmountBasis: "accepted quote (ex GST)"`. Toast: `Quote accepted — unscheduled job created`.
- The new job is unscheduled. It shows on the Unscheduled screen, not on the board, until someone sets a date.

Rate editor (`openRatesEditor`): admin only. Others get `Only an admin can change quote rates` (line 350). Save toast: `Quote rates saved`. Failure: `Not saved: {code}`.

`meta/quoteRates` is not deleted by the retention policy (`cloud/MIGRATION.md` line 49).

## What staff see

`canSeeMoney` false hides dollar figures in the wizard (`rateTxt` and line amounts in `stepHtml`). On main, operators never open the wizard. A supervisor sees totals.

The accepted job description includes the ex GST lines (`createJobFromQuote`, lines 714–719). Anyone who can open that job can read that description, including an assigned operator. The quotes **screen** is still hidden from operators.

Provenance: `app/features/quotes.js` functions `calcQuote`, `saveQuote`, `createJobFromQuote`, `stepHtml`, `installQuotes`; `app/app.js` `canQuote` and `renderOperator`; commit `01f2c5a6f407e123f7f48432f07f1e9445a36007`.

## Extra items, price adjustments and GST (PR: editable quotes, Nov 2026)

On the Review step, **Extra items** adds lines on top of the guided machine and labour lines:

- Quick-add: **Rubbish removal** (amount in m³, t, loads, bags or skips, optional waste type such as green waste, general, concrete / bricks, soil), **Concrete removal** (m³, t or loads, note for reinforced / slab or footpath / break-up), **Bring material to site** (material name such as road base or topsoil, m³, t or loads), **Tip fees**, **Travel**, **Misc**, and **Blank item**.
- Each line: description, amount / qty, unit, $ per unit ex GST, optional note. Move up / down, Remove. Line amount = amount × unit price.
- Preset prices come from the company's quote rates when set (rubbish = tip $/load, material = materials $/unit, travel = $/km). Otherwise the price is blank (never invented) and an item with an amount but no price keeps the total incomplete.
- Admins can **Save as preset**: saved on the company's quote-rates doc (`extraPresets`, up to 20) and shown as ★ chips. Remove them in Quote rates.
- Admins only: **Adjust guided prices** replaces a guided line's amount. The summary shows the old price struck through, "adjusted", and a Price adjustments line.
- Totals: Subtotal ex GST, GST 10%, Total inc GST, updated live while typing. `totalEx` stays the ex GST subtotal (used for `quoteAmount` / `poAmount`).
- **Customer quote (print / PDF)** opens a printable page with the items, subtotal, GST and total (no internal rates).
- Accepting copies `extraItems`, `priceOverrides`, `gst` and `totalInc` to `job.quote`, and writes price-free `job.workAmounts` (e.g. "Concrete removal: 3 t (reinforced slab)"). The crew sees those amounts on the run-sheet card and job details. The job description no longer carries dollar figures.
- Quotes saved before this change have no `extraItems` / `priceOverrides` and calculate exactly as before.

## Google Places address search (optional)

The quote's Job address can search Google Maps (Places API New, AutocompleteSuggestion), limited to Australia and biased to South East Queensland. A pick stores `addressPlace` (formatted address, lat/lng, place id); Calculate travel then routes from the depot to that exact spot, and the accepted job gets a matching `geo` pin for run-sheet ordering. With no key (the default) the field is plain typing.

To turn it on:

1. Google Cloud project `heartwood-9f37f` → APIs & Services → enable **Maps JavaScript API** and **Places API (New)** (billing must be on; it already is for Blaze).
2. Create a **separate browser API key**. Application restriction: websites `https://jobs.heartwoodew.com/*`, `https://callupapp.web.app/*`, `https://callupapp.com.au/*` (and `http://localhost:*` for testing). API restriction: Maps JavaScript API + Places API (New) only.
3. Put the key in `app/maps-config.js` → `placesApiKey`. A browser key is public by design; the restrictions are what protect it.
