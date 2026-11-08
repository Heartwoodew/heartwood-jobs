# Scope and modules

**Status: LIVE** on `main` `01f2c5a6f407e123f7f48432f07f1e9445a36007`.

The phone and desktop app is a static site. There is no build step. `app/app.js` line 1: “Heartwood Jobs — Phase 1. Plain ES modules + Firebase modular SDK from the CDN.”

The product name in cloud comments is **CallUp**. The page title and header still say **Heartwood Jobs** (`app/index.html` lines 6 and 21). The PWA name is “Heartwood Earthworx Jobs” (`app/manifest.webmanifest` lines 3–6). CallUp **Base** and **Pro** are feature flags in code, not a second app. See [11-tenancy-cloud-plans.md](11-tenancy-cloud-plans.md).

Public host named in-repo: `jobs.heartwoodew.com` (`CNAME`, one line). The manifest `start_url` is `/app/` (`app/manifest.webmanifest` lines 4–5). How that host is published (Firebase Hosting vs another static host) is **GAP**: there is no Hosting block in `cloud/firebase.json` or `cloud/production/firebase.json`.

## Two HTML entry points

| File | What it is |
| --- | --- |
| `app/index.html` | The jobs SPA shell: header search, `#app`, dialog, toast, `<script type="module" src="app.js">` (lines 20–29). |
| `index.html` (repo root) | A StatiCrypt password page (`staticrypt-html`, `staticrypt-form`, lines 1–7 and 178–211). The decrypted body is not readable without the password. Whether that body equals `app/` is **GAP**. `.staticrypt.json` is gitignored (`.gitignore` line 1). |

## `app/` modules the page actually loads

`app/sw.js` `SHELL` (lines 3–4) is the list the service worker caches. `app/app.js` imports the feature modules (lines 10–18).

| Module | Role on main |
| --- | --- |
| `app/app.js` | Auth, both shells, jobs, dispatch, invoices, timesheets, receipts, safety, SWMS UI, inbox, clients |
| `app/styles.css` | Layout. Behaviour is not defined here. |
| `app/firebase-config.js` | Web config for project `heartwood-9f37f`, emulator switch, `photosEnabled = false` |
| `app/route-config.js` | Nominatim + OSRM defaults; optional OpenRouteService key (blank) |
| `app/sw.js` | App-shell cache, version `hw-shell-v58-safety-nav` (line 2) |
| `app/manifest.webmanifest` | Installed-app name, scope `/app/` |
| `app/features/quotes.js` | Guided quotes |
| `app/features/route-order.js` | Optimise order and run sheets |
| `app/features/cloud-storage.js` | Tenant membership and Storage path planner. Byte-identical to `cloud/functions/shared/cloud-storage.js` (`diff -q` on this audit). |
| `app/features/cloud-retention.js` | 3-month operational retention maths. Byte-identical to `cloud/functions/shared/cloud-retention.js`. |
| `app/features/photo-gallery.js` | Gallery HTML and storage error text |
| `app/features/chat.js` | Chat payload and path rules |
| `app/features/chat-ui.js` | Chat screen |
| `app/features/compliance.js` | Fleet and policies |
| `app/features/swms-sign.js` | SWMS ids, 12-month validity, placeholder PDF |
| `app/vendor/pdf-lib.min.js` | MIT PDF library, loaded on first signed-SWMS download (`app/app.js` `loadPdfLib`, lines 2553–2557) |
| `app/icons/*` | PWA icons |

`photosEnabled` is exported (`app/firebase-config.js` line 16) and is **not imported** by `app/app.js`. Grep of `*.js` finds it only in that file and in `cloud/test/capture-order.test.js`. It does not turn the photo mirror on or off. The mirror always runs from `emailDialog` (`app/app.js` lines 2131–2136). The flag’s comment says email capture stays on and the app must not switch to Storage-only.

## `cloud/`

| Path | Role |
| --- | --- |
| `cloud/functions/index.js` | Exports `photoInboxWorker` and `retentionSweepHandler`. Does not import Xero. |
| `cloud/functions/lib/photo-intake.js` | Holds email photo intake. Does not call Gmail. |
| `cloud/functions/lib/gmail-stub.js` | Throws if called. Not imported by the worker. |
| `cloud/functions/lib/retention-run.js` | No-ops while `SCHEDULING_APPROVED` is false. |
| `cloud/functions/lib/xero-stub.js` | Throws. No network. |
| `cloud/functions/pro/xero-queue.js` | Pro-only. Not imported by `index.js`. |
| `cloud/emulator/firestore.rules` | Emulator model. Not the live rules. |
| `cloud/emulator/storage.rules` | Same bytes as `cloud/production/storage.rules`. |
| `cloud/production/firestore.chat.rules` | Paste block for live rules. Not deployed from here. |
| `cloud/production/firestore.fleet.rules` | Paste block. |
| `cloud/production/firestore.swms.rules` | Paste block. |
| `cloud/production/firestore.runsheets.rules` | Paste block. |
| `cloud/production/firebase.json` | Storage rules key only. |
| `cloud/production/ROUTE_ORDER.md` | Route optimiser note. |
| `cloud/firebase.json` | Emulator ports; predeploy hooks that refuse a live deploy. |
| `cloud/scripts/refuse-live-deploy.js` | Exits 1. |
| `cloud/MIGRATION.md` | Owner note for storage, retention, and what is not deployed. |
| `cloud/emulator/PROPOSED_storage_lifecycle.json` | Proposal only (`cloud/MIGRATION.md` lines 69–70). |
| `cloud/test/*.js` | Node tests. Not a user screen. |
| `tests/*.mjs`, `tests/phone-preview.html` | Browser checks. Not a user screen. |

## Named, but not in this repository

These names appear in comments in `app/app.js`. Their source is **GAP**. This pack does not describe their real behaviour beyond the comment that names them.

| Name in comments | Cited from |
| --- | --- |
| `tools/sm8_import.py` | `unscheduledView` comment, line 223 |
| `tools/xero_queue.py` | `checkXero` comment, lines 238–240; `sendToXero` comment, lines 1555–1558 |
| `tools/receipts_worker.py` | receipt comment, lines 639–641 |
| `tools/po_lookup.py` | `wireFindPo` comment, lines 1355–1356 |
| `tools/sync_inbox.py` | inbox comment, line 1398 |
| `tools/xero_profit_sync.py` | `profHistLoad` comment, lines 951–952 |
| `tools/export_completed.py` | invoice number comment, lines 1324–1325 |
| `sm8_push` | `unscheduleJob` comment, lines 1142–1143; `splitJob` comment, lines 1162–1164 |
| `data/clients_contacts.json` | clients comment, line 1443 |
| Live `firestore.rules` on the Firebase project | `cloud/MIGRATION.md` lines 99–100 |
| A “sync” admin UID | `app/app.js` line 74 comment. The UID value is not in the repo. `cloud/MIGRATION.md` line 101 says it is not guessed. |

Provenance: files and lines above, commit `01f2c5a6f407e123f7f48432f07f1e9445a36007`.
