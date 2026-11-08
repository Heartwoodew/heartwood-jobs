# Jobs, dispatch, and run sheets

**Status: LIVE** in the client on `main` `01f2c5a6f407e123f7f48432f07f1e9445a36007`.

Whether production Firestore rules allow each write is **GAP** except where the page itself says the rules are not on yet (Xero, run sheets). The emulator `match /jobs` is `allow write: if false` (`cloud/emulator/firestore.rules` lines 52–55). That file says deploying it would replace the live job rules. The live app writes jobs. Do not treat the emulator job match as production.

Time zone for “today” is `Australia/Brisbane` (`TZ`, `app/app.js` line 37). Dates are `YYYY-MM-DD` in that zone (`ymd`, line 40).

## Queues

`queueOf` (`app/app.js` lines 135–143), from `status`, `sm8Status`, and `quoteStatus` only:

| Result | When |
| --- | --- |
| Unsuccessful | `status === "Cancelled"` or `sm8Status === "Unsuccessful"` |
| Completed | `status === "Done"` or `sm8Status === "Completed"` |
| Quote | `quoteStatus === "Draft"`, or else `sm8Status === "Quote"` |
| Work Order | `quoteStatus === "Accepted"`, or the leftover case |

An explicit CallUp `quoteStatus` wins over a legacy ServiceM8 quote flag (comment, lines 138–140).

Job number: `sm8JobNo` if set, otherwise `HW-` plus the last 4 characters of the Firestore id, uppercased (`jobNo`, line 144).

Categories (`TYPES`, line 35): Spoil removal, Backslab, Waterproofing, Site clean, Other. Statuses (`STATUSES`, line 36): Scheduled, In progress, Done, Cancelled. The job card maps those to “Work Order – scheduled”, “Work Order – in progress”, “Completed”, “Unsuccessful” (`SL`, line 1201).

Clients offered in the datalist (`CLIENTS`, line 34): Orbit Homes (Qld) Pty Ltd, Torsion Built Pty Ltd, Silkwood Homes, OJ Pippin Homes, Envision Homes, Private.

## Jobs screen (admin)

`jobsView` (lines 205–221). Open jobs that have a date and are Work Order or Quote. Tabs: All open, Work Order, Quote. Filters: staff, category. Search (`matchQ`, lines 194–199): every word must appear in job number, address, client, PO, description, category, or staff. `#659` matches `659`.

Window caption: “Showing 2 weeks back to 4 weeks ahead”. That matches the listener (14 days back, 28 days ahead).

**New Job** opens `editJob(null)` (line 1081). **Find all POs** writes `meta/findAllPos` `{ status: "pending", ... }` (lines 1082–1085). Toast says the box runs it within 2 minutes, 6am–8pm. The box script is **GAP**.

A row click opens the job card. Rows are draggable on the jobs table (`jobRow` sets `draggable="true"`, line 185) but drop targets are the dispatch cells (`.drop`, lines 1116–1122).

**Mixed work** (`isMixed`, lines 170–182): description lines that match more than one of waterproof / spoil / backslab / clean. The row shows “Mixed work”. The card can split those lines (`splitJob`, lines 1166–1180). Spoil and backslab in one description are blocked on save (lines 1265–1267) with:

- `Spoil removal must be a separate job. Remove it from this backslab and create a Spoil removal job.`
- `Backslab work must be a separate job from spoil removal.`

Hint on the card (line 1219): “Spoil removal is always its own job — never add spoil to a backslab job.”

## Unscheduled (admin)

`unscheduledView` (lines 225–237). Open jobs with an empty date, newest `sm8Created` or `createdAt` first. **Schedule** opens the card and focuses the date (lines 1092–1094). Caption says jobs created in ServiceM8 more than 3 months ago are not shown. The importer that would enforce that is **GAP** (`tools/sm8_import.py`, comment line 223).

## Dispatch board (admin)

`dispatchView` (lines 289–317). Week (7 days from Monday) or day (hours 6am–6pm). Rows are each login plus Unallocated. Chips are jobs that have a date and are not Unsuccessful, sorted by start time.

Drag onto a cell calls `dispatchMove` (lines 1126–1141). It writes `date`, optional `time` (hour from the day view, minutes kept), and staff when the row changes. It sets `editedInApp: true`. Comment (lines 1124–1125): Firestore only; nothing is written to ServiceM8 by the page. Toast: `Rescheduled to {day}`.

**Remove from dispatch board** / phone **Off board** calls `unscheduleJob` (lines 1144–1153). Clears `date` and `time`, stores `unscheduledFrom`, toast with Undo. Comment: the next sync removes that visit’s ServiceM8 staff booking, not the job. The sync program is **GAP**.

Phone dispatch (`mobileDispatch`, lines 2173–2210): one day, a 7-day strip, swipe left/right when the horizontal move is more than 70 px. **Move** opens `moveSheet` (lines 2212–2230). No staff ticked means Unallocated. Toast says it is saved in the app, then sent to ServiceM8 by the next sync. That sender is **GAP**.

**Optimise order** (`#optorder`, line 1072) opens the route screen for the phone’s selected day, or today.

**Done today** pill (`donePill`, lines 743–763) on dispatch and jobs, admin only, not while My jobs is open. Counts jobs whose completion day in Brisbane is today (`completedAt`, or the job date if there is no stamp). Collapsed state is `localStorage` `hwDonePill`. Dollar total only if `canSeeMoney`.

## Job card (admin)

`editJob` (lines 1194–1282) and `jobTabs` (lines 1284–1320).

Tabs: Details, Chat, Photos, Supervisor, Safety, History.

Saved fields: client, address, category, PO (uppercased, spaces removed), description, date, time, hours, assigned uids and names, status, notes, loads, and PO amount when it changed. New jobs get `source: "app"`. Updates set `editedInApp: true`. Moving to Done sets `completedAt` and `completedBy` (line 1275). Empty date after save reloads the page (line 1279) so the undated query picks it up.

Diary is `job.log` plus synthetic lines for ServiceM8 import, `editedInApp`, and completion (lines 1197–1200). Operators add notes with `arrayUnion` (`opAction`, lines 2011–2031).

**Find PO** (`wireFindPo`, lines 1364–1384) writes `poLookups` (failure ignored) and sets `poLookupStatus: "pending"` on the job. Status labels (`PO_ST`, line 1357): orbit login needed, queued, searching, found, pick one, not found, needs Orbit portal. **Use this** copies `po` and `poAmount` onto the job. The worker is **GAP**.

**Email supervisor** (`emailSupervisor`, lines 1517–1552; button line 1252) opens a Gmail compose tab as `alex@heartwoodew.com`. Nothing is sent by the app (`HW_LAST_MAILTO` comment, line 1550). If no supervisor is known, it prompts for an address, checks it looks like an email (`That doesn't look like an email address` / `No email entered`), and tries to remember it on `meta/supervisors` and on the job. Failure to remember: `Email not remembered: {code}`. The message body is a fixed over-PO template. It includes a sign-off and a phone number stored in that function. The number is personal contact data and is not copied into this pack. Over-PO is a note, not a block (`overBy`, lines 1386–1389).

Supervisor card (`fillSupCard`, lines 1464–1469) uses `jobSupervisor` (lines 1454–1462): job fields, then `meta/supervisors`, then the client’s supervisor contacts. **Call** and **Email** are `tel:` and `mailto:` links.

Maps links append `, QLD` (`mapsUrl`, line 45).

## Operator job actions

`opAction` (lines 2011–2031):

- **Start job** sets `status: "In progress"` and `startedAt`. Toast `Started`. No offline toast on this path.
- **Complete job** sets Done, `completedAt`, `completedBy`, `completedByName`, optional loads, optional diary note. Toast `Marked done` or `Not saved: ` plus the code.
- **Add note** appends a diary line.

If `navigator.onLine` is false after a note or complete, a second toast says `Offline — will sync when back in signal` (line 2030). See the offline topic.

Today’s list uses `withRunOrder` (lines 1849–1860). If `runSheets/{uid}_{date}` exists and `status === "approved"`, jobs on that sheet are ordered by `jobIds` and labelled `Stop N`. Jobs not on the sheet sort after them, by time (`orderJobsForRun`, `app/features/route-order.js` lines 101–112). Each worker has their own document, so a shared job can sit in a different place on two days (`cloud/production/ROUTE_ORDER.md` lines 5–6).

A missing run sheet is ignored (`readRunSheet` catch sets `false`, `app/app.js` lines 1834–1847). The operator still sees start-time order.

## Optimise order (admin)

`installRouteOrder` is wired at the bottom of `app/app.js` (lines 2705–2722). Depot is `208-220 Holdsworth Rd, Chuwar QLD 4306` (`DEPOT_ADDRESS`, `app/features/route-order.js` line 9). The same string is required by the run-sheet rules (`cloud/emulator/firestore.rules` line 366).

Flow (`cloud/production/ROUTE_ORDER.md` and `approve` in `route-order.js` lines 740–771):

1. Admin picks a day and one worker.
2. Jobs are that worker’s jobs that day that are not Cancelled, Done, Unsuccessful, or Completed (`jobsForAllocation`, lines 87–99).
3. Pins come from the site address and the depot. No phone GPS (`app/route-config.js` lines 1–2).
4. Geocoding: Nominatim. A hit is stored on the job as `geo` via `geoPatch` (admin job update). Depot pin stays in the browser.
5. Routing: public OSRM table, unless `routeConfig.provider` is `"ors"` and `orsApiKey` is set. The key in `app/route-config.js` is `""` (line 20). A missing key falls back to OSRM and the suggestion says `OpenRouteService key is missing. Using OSRM and Nominatim instead.` (`resolveConfig`, lines 71–85).
6. Straight-line distance is never used as drive time or kilometres (`route-config.js` line 10). A leg with no road is not offered (`No road for that option.` / `That order has a leg with no road.`, lines 714 and 733).
7. Up to 8 stops, every order is tried (`EXACT_JOB_LIMIT`, line 11). More than 8 uses nearest-neighbour then 2-opt (`optimiseOrder`, line 194).
8. The admin can drag stops or use arrows. **Approve** writes `runSheets/{workerUid}_{YYYY-MM-DD}` with `status: "approved"`. **Reject** writes nothing (`ROUTE_ORDER.md` lines 5–6).
9. If the write is `permission-denied`, the toast is `Not saved. Run sheet rules are not on this project yet, so nothing was changed.` (lines 768–770). `ROUTE_ORDER.md` lines 26–30: live rules are not in this repo; merge `cloud/production/firestore.runsheets.rules` before Approve can succeed. Until then the button fails and nothing else changes.
10. Staff cannot approve (`canApprove`, line 44, checked at lines 741 and 860). Toast: `Only an admin can approve a driving order.`

`buildApproval` refuses a bad id, an empty list, or more than 40 jobs (rules cap, `firestore.rules` lines 370–371). Delete of a run sheet is false (line 393).

Provenance: `app/app.js` and `app/features/route-order.js` functions named above; `cloud/production/ROUTE_ORDER.md`; `app/route-config.js`; commit `01f2c5a6f407e123f7f48432f07f1e9445a36007`.
