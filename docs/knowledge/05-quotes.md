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
