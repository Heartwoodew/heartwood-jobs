# Optimise order

An admin picks a day and one worker, then asks for the quickest driving order of that worker’s jobs. The drive starts at the depot, **208-220 Holdsworth Rd, Chuwar QLD 4306**. A checkbox adds the leg back to the depot. The screen shows each leg’s drive time and distance, and the total next to the current order (the approved run-sheet order if there is one, otherwise start-time order).

The admin can drag the stops, or use the arrows, before approving. Approve writes `runSheets/{workerUid}_{YYYY-MM-DD}`. Reject writes nothing. Staff cannot approve. On their run sheet they see the approved sequence for their own jobs. Each worker has a separate document, so a shared job can sit in a different place on two people’s days.

No phone GPS and no device location. Pins come from the site address on the job, and from the depot address.

## Provider

Configured in `app/route-config.js`.

| | Default | Optional |
| --- | --- | --- |
| Geocoding | [Nominatim](https://nominatim.openstreetmap.org) | [OpenRouteService](https://openrouteservice.org) geocode |
| Routing | [OSRM demo](https://router.project-osrm.org) table (driving) | OpenRouteService matrix `driving-car` |

Both defaults work from the static site with no API key. Nominatim is limited to about one request a second; a successful pin is stored on the job as `geo` (`lat`, `lng`, `query`, `source`, `at`) and reused while the address is unchanged. The depot pin is remembered in the browser only.

Straight-line distance is never filled in as drive time or kilometres. If a leg has no road, that order is not offered.

OpenRouteService needs a key. Put it in `routeConfig.orsApiKey` and set `provider` to `"ors"`. The app is static, so the key is visible to anyone who can load the page. Leave the key blank to stay on OSRM. A missing key, or an ORS error, falls back to OSRM and the suggestion says so.

Up to 8 stops, the app tries every order. More than 8, it builds a nearest-neighbour tour and then 2-opt. The depot is fixed as the start (and as the end when “return” is on).

## Rules

Live Firestore rules are not in this repo. Do **not** deploy `cloud/emulator/firestore.rules` or this fragment from here. Merge `cloud/production/firestore.runsheets.rules` (`BEGIN RUN SHEET RULES` … `END RUN SHEET RULES`) into the live rules, inside `match /databases/{database}/documents`. It adds `runSheets/{sheetId}` only. Delete is false. It does not match receipts, finance, `xeroQueue`, or jobs.

Until that block is merged, Approve shows that the order was not saved. The rest of the app is unchanged.

Caching `geo` on a job uses the existing job update rule for admins. This branch does not ship a new job rule. No index is required: the app reads one document id per worker per day, and does not query the collection.

Nothing here schedules retention. `SCHEDULING_APPROVED` stays false. Receipts and finance are not part of this screen.
