# Limitations and gaps

**Status:** limits that the source states, plus gaps this audit could not close. Commit `01f2c5a6f407e123f7f48432f07f1e9445a36007` unless a line says **OPEN PR**.

## Do not tell a user these things work

- An in-app helper, a Play button, or spoken replies. [persona-and-voice.md](persona-and-voice.md) is a spec. `app/`, `index.html`, and `cloud/` have no `speechSynthesis` and no helper screen on this commit.
- Settings and Reports. They are hidden nav tuples with no screen (`app/app.js` line 148, `shell` skips `x[3]`).
- A timesheet clock, geofence, or “clock on at the job”. Hours are typed. Overnight is finish earlier than start, then minus 30 minutes lunch on every day that has both times.
- GST on a quote, a second operator, or a dual-machine surcharge. That is **OPEN PR #4** only.
- Staff invites, accept-invite passwords, or invite email. **OPEN PR #14** only, and email stays held unless a flag this repo does not set in production is turned on later.
- Servicing intervals and daily prestart. **OPEN PR #13** only.
- A rebrand. No PR and no branch found on 2026-11-08.
- The cloud function calling Xero or Gmail. Both stubs refuse. Intake always holds.
- Automatic deletion of photos at 3 months. The date is shown. `SCHEDULING_APPROVED` is false. The home screen says deletion is not scheduled.
- Storage-only photos. `photosEnabled` is false and unused. Email is still the send path. The cloud copy is a mirror that can fail quietly.
- Public photo or receipt URLs. The gallery uses `getBlob` and a blob URL. Rules comments say no public download tokens.
- In-app chat with a builder, or editing a sent chat message. Updates of messages are false in the paste rules.
- Editing an incident after submit, or deleting one, in the UI.
- The placeholder SWMS PDF as a client document. The PDF says it is not a SWMS.
- Invoice approval or email from this app. Send to Xero, when the rules allow the queue, is described as a draft. The desktop worker that would create it is not in the repo.
- ServiceM8 updates from the browser. The page sets `editedInApp` and says a later sync will push. `sm8_push` and `sm8_import.py` are not in the repo.
- Find PO, inbox sync, profit sync, Hubdoc email, and receipt-to-ledger automation. Named in comments only.
- Deploying `cloud/emulator/firestore.rules`. The header says it would replace live job rules, and its job match denies writes.

## Hard limits that are in code

| Limit | Where |
| --- | --- |
| Admin job listener: 14 days back, 28 days ahead, plus undated, plus every Done job | `app/app.js` lines 90–96 |
| Operator jobs: `assigned` contains their uid only | line 99 |
| Job photo mirror: 10 files, 15 MB, jpeg/png/webp/gif | `cloud-storage.js` lines 37–41 |
| Receipt image in Storage plan: 8 MB, one file | lines 38–42 |
| Chat photo: 8 MB; text 4000; sender name 80; preview 140 | `chat.js` and chat rules |
| Chat message cannot be updated | rules `allow update: if false` |
| Run sheet: at most 40 job ids; delete false; depot string fixed | run sheet rules |
| Route exact search: 8 stops, then nearest-neighbour and 2-opt | `route-order.js` `EXACT_JOB_LIMIT` |
| No straight-line distance as drive kilometres | `route-config.js` line 10 |
| Quote total blocked until every used rate is set | `quotes.js` `calcQuote` |
| One category per quote; spoil must not be saved on a backslab description | quotes step 0; `editJob` lines 1265–1267 |
| SWMS signature PNG data URL ≤ 90000 characters; 12 calendar months; five document ids | `signSwms`; `swms-sign.js`; SWMS rules |
| SWMS official PDF absent from git | `swms-sign.js` lines 1–3 |
| Export zip refuses above 32 MiB | `MAX_EXPORT_BYTES` |
| Timesheet lunch 30 minutes on every complete day | `TS_LUNCH` |
| Invoice floor 5402 | `INV_FLOOR` |
| Xero tax type on the queue is `OUTPUT`, account `200` | `sendToXero` |
| Money hidden unless admin or supervisor | `canSeeMoney` |
| Xero hidden unless two UIDs | `XERO_UIDS` |
| Inbox and reimbursement ledger: Alex’s UID only | `isOwner` |
| Compliance edit and policies: admin, and fleet only for tenant `heartwood` | `compliance.js` |
| Operators should not read receipt image bytes | Storage `canReadReceipt` |
| Job photo delete: false. Chat photo delete: uploader or admin | `storage.rules` |
| Retention never purges invoice fields, Xero fields, timesheets, users, SWMS, incidents, reimbursements, quote rates | `cloud-retention.js` |
| Nominatim is described as about one request a second | `ROUTE_ORDER.md` line 18 |
| OSRM demo is a shared public server | `route-config.js` lines 7–9 |
| OpenRouteService key, if one is pasted into `route-config.js`, is visible to anyone who can load the page | lines 12–16. The committed key is empty. |
| Service worker must be bumped or phones keep the old JS | `sw.js` line 1. Current version `hw-shell-v58-safety-nav`. |
| Root `index.html` is a StatiCrypt gate. The password and the decrypted HTML were not read | repo root `index.html` |
| Live Firestore rules, live Storage deploy, and the desktop Python workers | not in this repository |
| Sync admin UID | named, value absent |
| Customer and job records | not copied into this pack |

## Helper answers that must stay inside the signed-in person

A later callable must not use these notes as a reason to read another tenant, another worker’s receipts, Xero rows for someone who is not on `XERO_UIDS`, or chat for a job they are not assigned to. The pack is how-to text. Live records still follow the rules that are actually published, which this repo does not contain.

Provenance: the citations in this file and in the topic files, commit `01f2c5a6f407e123f7f48432f07f1e9445a36007`, plus the open-PR heads in [12-open-and-planned.md](12-open-and-planned.md).
