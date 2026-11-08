# Offline behaviour and error strings

**Status: LIVE** on `main` `01f2c5a6f407e123f7f48432f07f1e9445a36007`. This list is the text the source shows. It is not a log from production.

## Offline

Firestore is opened with `persistentLocalCache` and `persistentMultipleTabManager` (`app/app.js` lines 23–24). Comment line 23: jobs already loaded stay readable and writes queue until the phone is back online. The Firebase SDK’s exact queue rules are not re-implemented in this repo. Do not promise which writes survive a force-quit.

`app/sw.js`:

- Shell version `hw-shell-v58-safety-nav`. A new deploy must bump `VERSION` or phones keep the old shell (comment line 1).
- GET requests to this origin: network first, then the cache, then `index.html` (lines 22–26).
- Firebase SDK scripts from `www.gstatic.com/firebasejs/`: cache first (lines 19–21).
- Requests to `googleapis.com` or emulator ports 8080, 9099, 9199 are not cached here (lines 13–14). Auth and Firestore use the SDK cache.
- The service worker is registered only when not on the emulator (`app/app.js` line 31).

The only user-facing offline sentence is on operator **Complete** and **Add note** (`opAction`, line 2030): `Offline — will sync when back in signal`. It runs when `navigator.onLine` is false. It does not run for Start, for admin saves, or for photo upload.

Emulator: `?emu=1`, or hostname `localhost` / `127.0.0.1`, swaps in project `demo-heartwood` and apiKey `demo-key` (`app/firebase-config.js` lines 11–12; `app/app.js` lines 20–29). Ports: Auth 9099, Firestore 8080, Storage 9199 (`cloud/firebase.json`).

## Sign-in and access

| Text | Where |
| --- | --- |
| `Sign-in failed: {code}` | `renderLogin` line 115 |
| `No access for {email}. Ask Alex to add you.` | line 81 |

## Jobs and dispatch

| Text | Where |
| --- | --- |
| `Not saved: {code}` | `dispatchMove`, job save, move sheet, PO, receipt paid |
| `Undo failed: {code}` | `undoToast` line 48 |
| `Spoil removal must be a separate job...` | `editJob` line 1266 |
| `Backslab work must be a separate job from spoil removal.` | line 1267 |
| `Tick some (not all) lines to move` | split line 1255 |
| `Not split: {code}` | line 1258 |
| `the new job has already synced to ServiceM8 - undo there` | `undoSplit` line 1184 |
| `the new job is already in ServiceM8 - undo there` | line 1185 |
| `no undo data` | line 1187 |
| `Not removed: {code}` | unschedule |

## Photos, receipts, cloud

| Text | Where |
| --- | --- |
| `Can't read that image - try a JPEG/PNG photo` | `shrinkImage` line 657 |
| `Photo, amount and supplier are needed.` | receipt dialog line 684 |
| `Not uploaded: {code}` | line 696 |
| `Receipts not available yet ({code})` | lines 680 and 709 |
| `Receipt uploaded - queued for Hubdoc` | line 694 |
| `Couldn't load photos ({storage code}).` | `photo-gallery.js` `photoErrorText` |
| `No cloud copies on this job yet...` | `cloudEmptyCopy` |
| `Couldn't build the download.` | line 591 |
| `Only an admin can download the cloud copy.` | line 631 |
| `Share failed: {message}` | line 2163 |
| `Diary not updated: {code}` | line 2156 |
| `Hubdoc addresses end in @app.hubdoc.com` | line 735 |
| `Reimbursements not available: {code}` | line 731 |
| `CSV failed: {message}` | line 917 |

Cloud mirror failures are `console.warn` only (`cloud photo mirror`, `cloud receipt mirror`). The email or the receipt queue still completes.

## Xero, invoices, timesheets, POs

| Text | Where |
| --- | --- |
| `Check Xero isn't switched on yet (Firestore rules). Nothing was queued.` | line 262 |
| `Couldn't queue the Xero check: {code}` | line 263 |
| `Already checking.` | line 258 |
| `Send to Xero isn't switched on yet... Use Download Xero CSV for now.` | line 1570 |
| `Those jobs need an invoice number and a price first.` | line 1564 |
| `Already sent to Xero.` | line 1564 |
| `Invoicing rules not live: {code}` | line 1667 |
| `Invoice history not loaded: {code}` | line 1663 |
| `{date}: enter both start and finish` | timesheet line 861 |
| `Timesheet not available: {code}` / `Timesheets not available: {code}` | lines 853 and 840 |
| `Not marked sent: {code}` | line 843 |
| `You have unsaved hours. Leave this week without saving?` | line 836 |
| `Find all POs queued - the box runs it within 2 min (6am-8pm)...` | line 1084 |
| `Not queued: {code}` | line 1085 |
| `Not requested: {code}` | Find PO line 1382 |
| `That doesn't look like an email address` / `No email entered` | `emailSupervisor` line 1521 |
| `Email not remembered: {code}` | line 1525 |
| `Set a price first for:` | `assignNumbers` line 1718 |
| `Numbers NOT assigned: {code}` | line 1742 |
| `Marked {n} invoiced` | `markInvoiced` line 1751 |

Find PO status words are the `PO_ST` map (line 1357), not toasts.

## Route optimiser

| Text | Where |
| --- | --- |
| `Only an admin can approve a driving order.` | `route-order.js` line 741 |
| `Only an admin can optimise and approve a driving order.` | line 860 |
| `Not saved. Run sheet rules are not on this project yet, so nothing was changed.` | lines 768–770 |
| `Not saved: {code}` | line 770 |
| `Could not build a driving order.` | line 706 |
| `No road for that option.` | line 714 |
| `That order has a leg with no road.` | line 733 |
| `Road router returned no table.` | line 403 |
| `Road router did not return a full drive table (OSRM).` | line 428 |
| `OpenRouteService refused the drive table.` | line 458 |
| `OpenRouteService key is missing. Using OSRM and Nominatim instead.` | `resolveConfig` lines 71–81 |

## Quotes, chat, compliance, safety, SWMS

| Text | Where |
| --- | --- |
| `Only an admin can change quote rates` | `quotes.js` line 350 |
| `Client and site address are required.` | line 538 |
| `Pick an equipment preset (truck and/or skid / excavator).` | line 539 |
| `Enter the site address on step 1 first.` | line 547 |
| `Could not calculate` plus manual-km hint | line 551 |
| `Set quote rates for every used line before accepting.` | line 568 |
| `Enter hours on site for hourly plant / labourer.` | line 573 |
| `Already accepted — existing job {id}` | line 578 |
| `Quote accepted — unscheduled job created` | line 613 |
| `Cannot create job from incomplete quote` | line 711 |
| `You can't post in this chat` | `chat-ui.js` line 358 |
| `Not sent: {code}` / `Not deleted: {code}` | lines 358 and 315 |
| `Couldn't attach that photo` | line 293 |
| `Compliance is a CallUp Pro feature.` | `compliance.js` line 415 |
| `Only an admin can change this.` | line 442 |
| `Not saved: {code}` / `Not removed: {code}` | lines 458 and 477 |
| `Add the root cause before closing` | `app.js` line 2338 |
| `Type the action first` | line 2331 |
| `Signature too large, please clear and sign again.` | line 2504 |
| `Could not save: {code}` | SWMS line 2511 |
| `SWMS not available: {code}` | lines 2492 and 2547 |
| `Pop-up blocked. Allow pop-ups to read the SWMS, then sign.` | line 2540 |
| `Official SWMS PDF is not in the app. That page is a placeholder, not the SWMS.` | line 2545 |
| `The official PDF is not in the app. The page above is a placeholder, not the SWMS text.` | line 2489 |
| `No current valid signatures` | line 2640 |
| `Could not build PDF: {code}` | line 2643 |
| `PDF library failed to load` | line 2556 |
| `Inbox not available: {code}` / `Owner only.` | inbox |
| `Clients not available: {code}` | clients |
| `Job not loaded` | inbox job button line 1440 |

Photo intake hold reasons, if a `photoInbox` document is created, are `unknown-mailbox`, `not-job-photo`, `gmail-client-not-configured`, and `gmail-rights-not-enabled` (`cloud/functions/lib/photo-intake.js`). The page does not show those strings. The worker does not download mail.

Provenance: the lines cited, commit `01f2c5a6f407e123f7f48432f07f1e9445a36007`.
