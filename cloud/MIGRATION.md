## Clock on fix after Patrick's morning lock-up (not deployed)

Do not deploy from this branch. Do not merge it from the agent. Nothing here writes to production.

- Every clock on threw `ReferenceError: SHARE_MIN_MS is not defined` since the crew map fallback change on 24 Nov. The live-location timer used the constant without importing it. It is imported now, and a live-sharing failure can no longer stop or undo a clock punch.
- The two timesheet reads in a clock punch now give up after 6 seconds and use this phone's copy, so Checking location… cannot sit there on a stalled connection.
- The "Which machine are you on today?" question takes one tap at a time, uses this phone's copy when there is no signal, queues the answer, and always goes away. Before, a tap on a weak signal could wait with no sign it was taken, and the timesheet does not redraw while that question is on screen.

Service worker `callup-shell-v162-clock-on-fix`. Main is `callup-shell-v160-clock-adjust`. PR 139 uses v161.

After review, and only when the owner says merge:

1. Deploy hosting with `firebase deploy --only hosting --config cloud/firebase.hosting.json --project heartwood-9f37f` from a fresh deploy folder. Phones pick up `callup-shell-v162-clock-on-fix`.
2. No rules deploy. No functions deploy. No index deploy. No Storage change. No Stripe change. No production data write.

## Staff clock-time corrections (not deployed)

Do not deploy from this branch. Do not merge it from the agent. Nothing here writes to production.

A worker can correct clock on and clock off on their own timesheet. The new times count straight away. The first correction stores `originalClockOn` and `originalClockOff`; a later correction does not replace them. Admins see an Edited badge, those original times, and who changed the entry and when. The hours spreadsheet marks the row `Clocked · Edited` (or `Manual · Edited`) and repeats the original times in the note. Crew still do not see prices.

A worker can correct the current pay period, and any earlier period that is not sent and not approved. Clock off must be after clock on. Times cannot be in the future. The correction can change only the time fields and the edit audit. Job, notes, status, and the GPS stamp stay. Another person's sheet stays. An admin can still correct their own sheet after it is sent or approved. Alex can still rewrite a Heartwood timesheet, which is the existing owner rule.

Service worker `callup-shell-v160-clock-adjust`. Main is `callup-shell-v159-help-videos`. Open pull requests are at v156 or below.

After review, and only when the owner says merge:

1. Deploy Firestore rules from `cloud/firestore.production.rules` only. Do not deploy `cloud/emulator/firestore.rules`. `cloud/firebase.json` points Firestore at the emulator file and its predeploy hook still refuses a live deploy. Do not remove that hook.
2. Deploy hosting with `firebase deploy --only hosting --config cloud/firebase.hosting.json --project heartwood-9f37f`. Phones pick up `callup-shell-v160-clock-adjust`.
3. No functions deploy. No index deploy. No Storage change. No Stripe change. No backfill. No production data write.

# Cloud storage, tenant isolation, and 3-month operational retention

This branch is not deployed and must not be merged straight to production. It does not create a Firebase project, a Google account, a Blaze upgrade, a Storage bucket, a Cloud Scheduler job, or any secret. It does not change live Firestore data, live rules, Gmail, or Xero.

Heartwood stays the one existing tenant (`heartwood`) on project `heartwood-9f37f`. Staff with no `tenantId` on their profile remain Heartwood. CallUp Base is jobs, run sheets, private cloud photos, receipts, staff permissions, and guided quotes. Base has no Xero and no invoicing. Heartwood's current Xero buttons and `xeroQueue` documents are unchanged and stay on the existing desktop worker.

## What the webpage does now

New job photos are still emailed to `alex@heartwoodew.com`. The same files are also uploaded, when Storage accepts them, to:

`tenants/{tenant}/jobs/{jobId}/photos/{id}`

New receipts still write `receipts/{id}` and `receiptChunks` exactly as before, with the same queued / Hubdoc / reimbursement behaviour. The JPEG is also uploaded to:

`tenants/{tenant}/receipts/{receiptId}/original`

A Storage failure does not fail the email or the receipt queue. No public download URL is created. Dollar amounts are not written into storage metadata. Staff below supervisor still see no dollar values (`$$` already returns blank unless `canSeeMoney()`). Operators may upload a receipt and are not allowed to read the file back, because the image shows the amount. Supervisors can read their own receipt file. Alex can read Heartwood receipt files. Nobody else can.

The signed-in profile decides the tenant. A tenant id, business id, file name, or path typed by the client is not authority. Existing Heartwood profiles with no `tenantId` resolve to `heartwood`. Alex (no profile doc) and Patrick stay on the same bootstrap UIDs as `app/app.js`.

Admin job cards show an operational expiry date and a **Download cloud copy** button. The zip is built in the browser from data that admin can already see. It is not a public bucket URL. The home screen, for admins only, counts copies inside 14 days of expiry or past it, and says deletion is not scheduled.

## Retention

Operational cloud data is due **3 calendar months** after a whitelisted anchor, in Australia/Brisbane dates (not 90 × 24 hours, and not `updatedAt`).

| Record | Anchor used | If the anchor is missing |
| --- | --- | --- |
| Completed job (`status` Done or `sm8Status` Completed) | `completedAt`, otherwise a real `YYYY-MM-DD` `date` | Not deleted |
| Any other job | Latest of `startedAt`, `photosEmailedAt`, a linked receipt `createdAtIso`, a linked quote `acceptedAt` or `updatedAtIso`, otherwise a real `date` | Not deleted |
| Quote with no job | `acceptedAt`, else `updatedAtIso`, else `createdAt` | Not deleted |
| Receipt with no job | `createdAtIso` or `createdAt` | Not deleted |

Diary strings, `updatedAt`, `createdAt` on a job, and invoice dates are not anchors. A date of 31 Nov plus three months uses the last real day of the target month (30 Nov 2026 → 28 Feb 2027; 30 Nov 2023 → 29 Feb 2024).

Warning window: 14 days before the expiry date (shown in the admin UI only). On the expiry date the runner, **if enabled**, soft-deletes (data still there). 14 days after soft-delete it purges operational fields and files. Before soft-delete an admin of that tenant can cancel (hold). During the grace an admin can restore, which also holds the record so the next sweep does not immediately delete it. After purge, restore is refused.

The runner is idempotent. A storage delete error leaves that record soft-deleted and continues with the others. A second successful run finishes the purge. A third run does nothing to that record.

**Nothing is scheduled.** `SCHEDULING_APPROVED` in `app/features/cloud-retention.js` is `false`. `retentionSweepHandler` returns without writing even if `RETENTION_PURGE_ENABLED`, `RETENTION_SCHEDULING_APPROVED`, and `HEARTWOOD_RETENTION_APPROVED` are all set. There is no `onSchedule` export. Heartwood rows are skipped unless `heartwoodApproved` is also passed, which the handler only does when `HEARTWOOD_RETENTION_APPROVED=true` **and** the source constant is true. Historical Heartwood jobs, photos, receipts, and quotes are not deleted by this branch.

Enabling this later would immediately make old Heartwood jobs eligible. That needs a separate owner decision after a backup export. Do not flip the constant in the same change as the first Storage publish.

### Deleted only when a later approval turns the runner on

- Job operational fields (address, description, notes, diary, embedded quote snapshot, photo flags) and, when no financial field remains, everything except a tombstone (`retention.state = purged`, job number, status).
- Job photo objects and receipt image objects for that tenant.
- Receipt documents and `receiptChunks` tied to the expired job, including `amountInc`. That amount is an operational reimbursement copy, not the accounting record. The manifest says so.
- Quote documents. They are ex GST estimates, not tax invoices. `meta/quoteRates` is not a quote and is kept.

### Never deleted by this policy

These are not silently included. Tests lock the list.

- Invoice fields and dollar amounts on the job: `invoiceNo`, `invoiceAmount`, `invoiceDate`, `invoiceDescription`, `invoiceContact`, `invoiced`, `invoicedAt`, `invoicedBy`, `invoiceExcluded*`, `doNotInvoice`, `poAmount`, `poAmountBasis`, `poAmountSource`, `quoteAmount`.
- Every `xero*` field, the `xeroQueue` collection, `meta/profitHistory`, `meta/invHist_*`.
- `reimbursements` (money owed / paid ledger).
- `timesheets`.
- `users` (sign-in profiles), SWMS chunks and signatures, incidents.
- `meta/quoteRates` (the rate card, not a customer quote).
- `ownerSettings`.
- Any other tenant's documents.
- Gmail messages and Xero accounting records. This code never calls those APIs.

GST is not a separate ledger in this app. Tax invoices and GST live in Xero (`taxType` OUTPUT on the existing queue). Keeping the invoice and Xero fields, and never calling Xero from Base, is the exclusion.

**Australia usually requires business records of transactions to be kept for 5 years (ATO).** A 3-month cloud deletion does **not** meet that. The accounting record remains Xero, Hubdoc, and any authorised financial export the business already keeps. The zip from this branch is an operational copy with those financial fields left out on purpose.

Bucket lifecycle is not the deletion mechanism. `cloud/emulator/PROPOSED_storage_lifecycle.json` only proposes a 7-day delete of a future `_expired/` prefix. It is not applied. It does not match live photos. Firestore records still need the function above, which is disabled.

The sweep does not require a new composite index. It does not assume every document has a timestamp.

## Export

`buildOperationalExport` builds a ZIP (store method) with `manifest.json`, operational job JSON, quote JSON, receipt JSON plus image bytes when the caller has them, and photo bytes when loaded. Manifest states Base, `xero: false`, scheduling not approved, the 5-year accounting note, and every excluded class.

Only a rules-admin of that tenant can build it. An operator or supervisor cannot. A requested tenant id other than the profile tenant fails with no zip. Other tenants' jobs are not packed. Over 32 MiB of file bytes the export refuses instead of truncating.

`issueExportGrant` is the server-side download for a later function. It returns a URL only when the signer supplies a short-lived signed URL (15 minutes, `Expires` or `X-Goog-Expires`). A public URL, a URL with no expiry, or another tenant's path is refused. The webpage download uses a blob URL and revokes it. It does not call `getDownloadURL`.

## Background workers

| Worker | Where | What it does in this branch |
| --- | --- | --- |
| `photoInboxWorker` | `cloud/functions/index.js` | On a new `photoInbox` doc, resolves the mailbox `alex@heartwoodew.com` to Heartwood and writes a hold reason. Ignores a client `tenantId`. Does not call Gmail (`gmail-stub.js` throws if something tries). Does not write job photo flags. |
| `retentionSweepHandler` | same package, **not scheduled** | No-ops while `SCHEDULING_APPROVED` is false. |
| `handleXeroQueue` | `cloud/functions/pro/xero-queue.js`, **not imported by index.js** | CallUp Pro only. Base and the default env do not run it and do not call Xero. Heartwood's queue worker is untouched. |

Region, if these are ever deployed: `australia-southeast1`.

## Rules

`cloud/emulator/storage.rules` and `cloud/production/storage.rules` are the same bytes. The production file is what a reviewed Storage deploy would publish. It has not been deployed.

`cloud/production/firebase.json` has only a `storage` key. Its `rules` path is `storage.rules`, which Firebase resolves from that config's directory, so the file on disk is `cloud/production/storage.rules`. There is no `firestore`, `functions`, `hosting`, or `predeploy` entry. This checkout has no root `firebase.json` and no root `.firebaserc`. `--config cloud/production/firebase.json` sets the Firebase project directory to `cloud/production`, so a root `firebase.json` or a root `.firebaserc` that points at Heartwood is not read.

`cloud/production/.firebaserc` defaults to `demo-heartwood`. Do not run `firebase use heartwood-9f37f` for this config. Pass `--project heartwood-9f37f` only on the reviewed command below.

`cloud/emulator/firestore.rules` is an **emulator model only**. The live Firestore rules are not in this repository. Do not deploy that file, and do not deploy Functions.

`cloud/production/firestore.timesheet.rules` is the clock on / clock off block to paste into the live rules after Alex approves it. It is not deployed. A worker can read and write only `timesheets/{their uid}_{week}`, including the single location fix taken at that tap. Heartwood admins can read every sheet. Deploying the emulator rules file would replace the live jobs, quotes and receipts rules.

The sync admin UID mentioned in `app.js` is not in this repository. It is not guessed. Storage rules do not grant that account access. Add the real UID before a rules deploy if that account must read Storage.

`cloud/.firebaserc` also points at `demo-heartwood`. `cloud/firebase.json` is the emulator and capture config. Its Storage and Functions `predeploy` hooks run `node scripts/refuse-live-deploy.js`, which exits 1. `npm run deploy` in `cloud/` also exits 1. Those guards stay. The production config is separate and has no hook, so the command below is the only prepared Storage path.

Reviewed command, from the repository root, after the default bucket exists and a person has checked the rules. This branch has not run it:

```
firebase deploy --only storage --config cloud/production/firebase.json --project heartwood-9f37f --non-interactive
```

`--only storage` and `--config` are both required. `--dry-run` is not a substitute for review: the CLI says a dry run can still enable APIs on the target project. Checks in this branch use `--project demo-heartwood` only. They show Firestore and Functions do not match this config, and a Storage dry run against the demo project stops before any rules release. No app bootstrap is required for that parse.

## Secrets

No secret values belong in git. This repo does not contain the desktop worker's environment, so the names that worker already uses are **unknown**. Do not create new credentials for Base.

| Name | Needed now? |
| --- | --- |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_INTAKE_ENABLED` | No. Do not create them. Intake stays held. |
| `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REFRESH_TOKEN`, `XERO_ORG_ID` | No. Not Base. `XERO_ORG_ID` would be Xero's organisation id, not the CallUp tenant. Existing Heartwood Xero access stays on the current machine. |
| `RETENTION_PURGE_ENABLED`, `RETENTION_SCHEDULING_APPROVED`, `HEARTWOOD_RETENTION_APPROVED` | No. Leave unset. The source constant blocks them anyway. |

## Plan impact

Confirm figures in the Firebase console. They match the public pricing page as checked for this branch (Firebase pricing, Cloud Storage `*.firebasestorage.app` bucket, Cloud Scheduler).

| Item | Spark (current, if still Spark) | Blaze |
| --- | --- | --- |
| Cloud Storage | Not usable for this design. | Alex approved Blaze on `heartwood-9f37f` and billing is enabled. No-cost up to 5 GB stored, 1 GB downloaded/day, 20K uploads/day, 50K downloads/day, then Cloud Storage rates. The default private bucket was still being created when this note was written. |
| Cloud Functions | Not available. | No-cost up to 2M invocations, 400K GB-seconds, 200K CPU-seconds, and 5 GB outbound networking a month, then usage rates. Cloud Build 120 min/day no-cost. |
| Cloud Scheduler | Not created by this branch. | Not created until a later retention approval. A billing account includes 3 jobs free. Extra jobs are $0.10 each per month. How many jobs this billing account already has is **unknown**. |
| Firestore | Existing usage, unchanged by this branch. | Same no-cost quotas (1 GiB, 20K writes/day, 50K reads/day) then usage. Extra queue documents are small. Current headroom is **unknown**. |
| New project, new Google account, Gmail API, new Xero app | Not requested and not done. | Same. |

Heartwood photo volume is likely inside the Storage no-cost quotas. That is an estimate, not a quote. Blaze is already approved; this branch still does not deploy.

## Owner steps before anything goes live

Do these in order. Stop if a step is not approved.

1. Read the deletion table and the 5-year accounting warning above. Confirm Base still has no Xero.
2. Blaze on the existing project `heartwood-9f37f` is approved and billing is enabled. No second Firebase project.
3. Wait until the default private bucket exists (`heartwood-9f37f.firebasestorage.app`, the name already in `app/firebase-config.js`). Do not apply the lifecycle file. Do not upload old photos.
4. After that bucket exists, a person can run the reviewed Storage-only command in the Rules section. Do this before the webpage from this branch is published, so the first uploads are checked rather than landing in an open bucket. This agent has not run that command.
5. Do not deploy Firestore rules or Functions from this branch. `cloud/emulator/firestore.rules` is not a production ruleset. Staff invites add a separate fragment and functions; those are also not deployed. See "Staff invites" below.
6. Publish this branch's webpage only after Storage rules are live. Email and receipt chunks keep working. Storage errors are logged and ignored. The webpage in this branch is unchanged by the Storage deploy path.
7. Leave Functions undeployed until you want `photoInboxWorker`. Deploying it does not enable Gmail and does not delete data.
8. Retention scheduling, Heartwood historical purge, lifecycle, and Pro Xero are separate later approvals. They are not part of steps 1–7.

## Staff invites

CallUp Base can invite an operator or a supervisor. Admin is not an invite role. The Staff screen is for supervisors and admins. Operators cannot see it or write invites. The invitee opens `https://jobs.heartwoodew.com/app?invite=<token>`, sets a password, and the accept function creates the Auth user and `users/{uid}` with the name and role from the invite. The browser never writes `role`.

`invites/{id}` stores name, lowercased email, role, status `pending`, createdBy, createdAt, expiresAt (7 days), token, and tenantId. `inviteEmails/{email}` is the lock that stops a second pending invite for that email. Pending includes an invite whose link has expired; resend or cancel it. Accepted and cancelled invites stay in the list. Resend rotates the token and moves the expiry. Cancel makes the link stop working.

Mail is not sent by the webpage. `inviteEmailWorker` writes `inviteMail` with `delivery: "held"` unless `INVITE_EMAIL_ENABLED` is the string `true`. When that is set, it writes a `mail` document for the Firebase Trigger Email extension (`firestore-send-email`) and still does not open an SMTP connection itself. Tests refuse to queue that live `mail` document. Leave the flag unset.

Nothing in this section has been deployed. `npm run deploy` in `cloud/` still exits 1.

### Manual steps, in order, when you want this live

Do these yourself. This branch has not run them.

1. In the Firebase console for `heartwood-9f37f`, open Firestore rules. Paste the block in `cloud/production/firestore.invites.rules` once, inside the existing `match /databases/{database}/documents`. Do not upload `cloud/emulator/firestore.rules`. That file would replace jobs, quotes, receipts, and the rest of the live rules.
2. Read the pasted block. It lets a rules-admin create an operator or supervisor invite and blocks client writes of `mail` and `inviteMail`. It does not change the live `users` match. Confirm the live `users` rules still deny a client write of `role`, `tenantId`, `customerIds`, and `finance`. Publish the rules from the console after that diff.
3. Deploy these functions to `australia-southeast1` on `heartwood-9f37f` only when you want links to work: `previewStaffInvite`, `acceptStaffInvite`, `inviteEmailWorker`. They need a public invoker because the invitee is not signed in yet. The token is the secret. `cloud/firebase.json` still has a predeploy hook that refuses `firebase deploy` from `cloud/`. Do not remove that hook to deploy the photo or retention workers. A reviewed functions deploy is a separate decision and was not run from here.
4. Leave `INVITE_EMAIL_ENABLED` unset. Admins copy the link from the Staff screen. To send the email later, install Trigger Email on the `mail` collection, set `INVITE_EMAIL_FROM` to a mailbox that extension is allowed to use, then set `INVITE_EMAIL_ENABLED=true` on `inviteEmailWorker` only. Do not set that flag in tests or on a developer machine that points at production.
5. Publish this branch's webpage after steps 1 and 3. Until `acceptStaffInvite` is deployed, the link opens and then says acceptance is not deployed. Saving an invite does not send mail.
6. Email/password sign-in is already how staff log in. No new Firebase project. If an accept call fails after creating the Auth user, delete that user in the console and resend the invite. The function does not attach an invite to an existing login and does not change that login's role.

## Tests

From `cloud/` after `npm install`:

- `npm test` — membership, wrong-tenant refusal, receipt hiding, 3-month boundary, missing timestamps, Heartwood hold, cancel, restore, purge keeping invoice/Xero/reimbursement/rate-card rows, zip contents, signed URL refusal, Gmail and Xero stubs, deploy guard, and the Storage-only config (Firestore and Functions do not match it; demo-project dry run does not release rules).
- `npm run test:browser` — harness clicks with Firebase network stubbed; the jobs page still shows Sign in.
- `npm run test:emulator` — Auth, Firestore, and Storage emulators on `demo-heartwood` only.

`npm run deploy` exits 1.

## Job money off the job document (round 3, Q6, Nov 2026)

Assigned crew can read the whole job document, and their phone keeps an offline copy of it. So the job no longer
carries the PO value or the accepted-quote total.

- New collection `jobMoney/{jobId}`: `jobId`, `companyId` (`tenantId` for companies), `poAmount`, `poAmountBasis`,
  `poAmountSource`, `quoteAmount`, `splitUndoPoAmount`, `migratedAt`, `updatedAt`, `updatedBy`.
  Read/write: Heartwood admins (Alex, Patrick, the box) for Heartwood; company admins and supervisors for their own
  company (supervisors already read quotes). Crew (operators, staff) never. No deletes.
- Jobs rules: app writers (Heartwood admins, company office, the master page) may not add or change `poAmount`,
  `poAmountBasis`, `poAmountSource` or `quoteAmount` on a job, and a job's `quote` copy may not hold `totalEx`, `gst`,
  `totalInc`, `lines`, `priceOverrides` or `ratesSnapshot`. Removing a legacy copy is allowed.
  The box sync user may still write `poAmount` on Heartwood jobs (tools/po_lookup.py, sm8_import.py) until those workers
  are moved to `jobMoney`; the app reads jobMoney first and falls back to the job's own field.
- The app: office lists are merged with `jobMoney`; job form, Find PO "Use this", split/undo split and Accept quote
  write money to `jobMoney` and clear any legacy copy on the job.
- Not moved: invoice fields (`invoiceAmount`, `invoiceNo`, ...). tools/export_completed.py and the Xero queue still read
  and write them on the job. They are only set on Done jobs at invoicing. Moving them needs those box workers changed first.

### Existing jobs: `cloud/scripts/migrate-job-money.mjs` (admin-run, after merge)

Re-run (Nov 2026, full-app test): the script also strips typed dollar amounts from crew-readable text written by the
box or the app: `poLookupMsg` (older Find PO runs wrote "PO ... $N ex GST"; 37 Heartwood jobs on 12 Nov 2026, 33 of
them with crew assigned), `workAmounts[]` and `quote.extraItems[].note/description` (same "[price removed]" rule as
new quotes). `notes` and `description` that people typed are only listed in the report (`textWithPrice`), never
rewritten. Safe to run again: jobs already clean are skipped, and jobMoney values are never overwritten.
The `jobMoney` get rule also allows the office to read a missing doc (a job with no money yet) as "not found", so the
Find PO dialog's live listener no longer fails with permission-denied. Crew still can't read jobMoney at all.

Order: merge the PR, deploy the Firestore rules (firestore.production.rules) and the app (service worker
`callup-shell-v90-job-money`), then run the migration. Dry run is the default and writes nothing.

```
cd cloud
# emulator rehearsal (fake data)
firebase emulators:exec --only firestore --project demo-heartwood "node scripts/migrate-job-money.mjs"
# production: dry run first, read the report (paths and keys only, no amounts), then commit
node scripts/migrate-job-money.mjs --project heartwood-9f37f
node scripts/migrate-job-money.mjs --project heartwood-9f37f --commit
```

Per job it copies the money keys into `jobMoney/{jobId}` (never overwriting a value already there), then deletes them
from the job; strips quote prices from `job.quote` (keeping `quote.totalEx` as `quoteAmount` when that is missing) and
`unitPrice` from `job.quote.extraItems`; moves `splitUndo.poAmount` to `jobMoney.splitUndoPoAmount`. Safe to re-run.
Crew phones drop the old values from their offline cache when the job document next syncs.

### Find PO suggestions off the job (Nov 2026)

`poLookupCandidates` (the Find PO suggestions list: PO, kind, source, confidence and the PO amount) is now a job money
key: it lives on `jobMoney/{jobId}` (office only) like `poAmount`. The app reads it from jobMoney (a legacy list on the
job is a fallback until migrated), the Find PO dialog listens to jobMoney, "Use this" works from it, and Find PO / split
clear the list on jobMoney and remove any copy on the job. Rules: app writers may not add or change
`poLookupCandidates` on a job (removing a legacy copy is allowed); jobMoney accepts it as a list (max 50) for Heartwood
admins, company office and the box. The box sync user is still allowed to write it on a job until the box worker
switches over (tools/po_lookup.py `--suggestions-to-jobmoney`, or the flag file `/home/box/.heartwood_po_suggestions_jobmoney`).

After merge: deploy the rules and the app (service worker `callup-shell-v91-po-suggestions`), switch the box worker
over, then run `scripts/migrate-job-money.mjs` (dry run, then `--commit`): it moves existing suggestion lists off jobs
into jobMoney without overwriting a list already there. It is the same idempotent script as above.


## Invoice price and Xero match off the job document; crew money audit (12 Nov 2026)

Alex: "move it" (invoice price) and "everyone below supervisor can't see dollar amounts". Assigned crew can read the
whole job document, so `invoiceAmount` (the invoice price, ex GST) and `xeroCheck` (the Xero match: `totalEx`,
`amountDue`) now live in the office-only `jobMoney/{jobId}` with the PO value and quote total. The other invoice fields
(`invoiceNo`, `invoiceDescription`, `invoiceDate`, `invoiceContact`, `invoiced`, `xeroCheckPending`, ...) stay on the job.

- App: the Invoices price box and "Assign numbers" write the price to jobMoney (numbering does both writes in one
  transaction) and remove any legacy copy from the job. Office lists already merge jobMoney over the job (`withMoney`),
  so the Invoices screen, Xero queue (`amountEx`), CSV exports, totals and the Check Xero pill read the merged value.
  Service worker `callup-shell-v98-photos-cloud`.
- Rules (`firestore.production.rules`): `invoiceAmount` and `xeroCheck` are in `jobMoneyKeys()`, so app writers may not
  add or change them on a job (removal is allowed). The box sync user may not add or change them on a job either
  (`syncDeniedJobKeys`, `syncJobCreateOk`, `syncJobUpdateOk`). `jobMoneyOk` allows `invoiceAmount` (number or null) and
  `xeroCheck` (map). Crew still can't read jobMoney at all.
- Helper (`helperAsk`): the admin reader merges both from jobMoney; crew answers never include money (unchanged).
- Box workers (not in this repo, /workspace/heartwood-app/tools): `hwfire.JOB_MONEY_KEYS` gets both keys;
  `export_completed.py --invoice-sync` reads/writes the price on jobMoney; `xero_queue.py` writes `xeroCheck` to jobMoney;
  `sm8_push.py` never copies a price onto a moved job.
- Tests: `test/invoice-amount.test.js`, `test/invoice-amount.emulator.test.js`, `test/crew-money.emulator.test.js`
  (every money record an operator could try to read: jobMoney, quotes, rates, invoicing counters, profit, Xero queue,
  reimbursements ledger, other people's receipts/claims, service costs, hours exports, PO lookups).
- Exception kept for Alex to decide: an operator can read the dollar amount on their OWN receipt and their OWN
  reimbursement claim (needed to be paid back).

### Existing jobs: `cloud/scripts/migrate-office-money.mjs`

Dry run is the default and reads only. `--apply` writes a JSON backup first (mode 600, needs `--backup <new file>` on
production), copies each value to jobMoney (never overwriting a value already there; a different value there is a
conflict and that field is left on the job), then deletes the field from the job, then re-reads every job to verify.
Dry run on 12 Nov 2026: 129 jobs scanned; 52 with `invoiceAmount` (all Heartwood; 51 Done + invoiced, 1 Cancelled;
50 with crew assigned) and 1 with `xeroCheck`; 52 jobs to change; 0 conflicts.

Order: merge, put the box worker update in place (it may write jobMoney before the rules change: the sync user already
has full jobMoney access), deploy the Firestore rules, deploy hosting (v97) and `helperAsk`, then run the migration
(`--apply --backup ...`), then a second dry run (expect 0).

```
cd cloud
node scripts/migrate-office-money.mjs --project heartwood-9f37f
node scripts/migrate-office-money.mjs --project heartwood-9f37f --apply --backup /workspace/callup/office-money-backup.json
```

## No ServiceM8 wording; no Heartwood wording for CallUp companies (12 Nov 2026)

- Every user-visible ServiceM8 / SM8 string is gone for every company, Heartwood included (toasts, history lines,
  dispatch notes, quote tag, split/undo errors). Field names (`sm8JobNo`, `sm8Status`, ...) are unchanged.
- Helper: knowledge text, job data (keys `sm8JobNo`/`sm8Status` are sent as `jobNo`/`syncStatus`) and replies have
  ServiceM8 removed for everyone and Heartwood removed for CallUp companies (`neutralText` in helper/prompt.js).
- CallUp companies no longer inherit Heartwood's name, legal name, ABN, address, email or sign-off (`org-settings.js`),
  nor Heartwood's yard as the quote/run-sheet depot, nor Alex's address as the photo email fallback. Invite emails for a
  CallUp company never use Heartwood wording even when the company name is not loaded. The test-company exit button says
  "Exit test company". The Xero queue stub note no longer names Heartwood.
- `test/brand-text.test.js` scans every string literal in app/ and cloud/functions/ (acorn) for ServiceM8/SM8, keeps a
  reviewed list of Heartwood strings (Heartwood-only branches, ids), and renders client-company settings, invite emails,
  timesheet consent, depots and helper prompts to check they are Heartwood-free.

## Four invite roles: labourer, operator, supervisor, admin (12 Nov 2026)

Alex: "there should be 4 different profiles available for new invites". Labourer has exactly the operator's access
(a different label): assigned jobs, own timesheet/leave/receipts, photos and notes on assigned jobs, prestarts and the
fleet meter reading. Labourers are below supervisor, so no dollar amounts anywhere (UI, rules, helper).

- `staff-invites.js` (app and functions copies, identical): `INVITE_ROLES` labourer/operator/supervisor/admin,
  `CREW_ROLES`, `invitableRoles()`. An admin of a CallUp company may invite all four; a supervisor keeps
  labourer/operator/supervisor and never admin; crew invite nobody. Heartwood: no admin invites (Heartwood's admins
  are the fixed UID list in the rules; a Heartwood profile-role admin would get a half-working office). The accept
  function re-checks the inviter's power for the invited role and refuses otherwise. The Staff screen offers only the
  roles the signed-in person may give; the role picker defaults to Operator. (Heartwood admin invites: see the next
  section; they now work through heartwoodAdmins/{uid}.)
- Rules: `isOperator()` takes role operator or labourer. Invites: `inviteRoleOk()` allows labourer/operator/supervisor
  for any invite admin and admin only for a profile-role admin of a CallUp company (`inviteFullAdmin()`), on create,
  resend and cancel. Supervisors cannot read an admin invite (it carries the sign-up token); the app's invite list
  filters by the roles the person may give. Storage rules have no operator role check, so nothing changes there.
- Crew lists (office crew picker, run sheets) include labourers. Helper: "invite labourer|operator|supervisor|admin ...";
  admin only for a CallUp company's rules-admin; labourers get the staff action set and no money.
- There is no role-edit screen in the app (company admins can't write users/{uid} under the rules); roles come only
  from the invite. Changing a role later is still a console / box job.
- Tests: `test/invites.test.js`, `test/helper-actions.test.js`, `test/labourer-role.emulator.test.js` (labourer parity
  with operator on jobs, receipts, prestarts, fleet meter, timesheet; no money; admin/supervisor/crew invite powers;
  supervisor can't read or resend an admin invite), `tests/phone-ui.test.mjs`.
- Deploy: Firestore rules, hosting, and functions `previewStaffInvite`, `acceptStaffInvite`, `inviteEmailWorker`
  (shared/staff-invites.js) and `helperAsk` (helper/actions.js).

## Heartwood admin invites; run sheets per company (12 Nov 2026, Alex's answers)

Kept as is (Alex): crew still see the dollar amount on their OWN receipts and claims; the 4 job notes / 3 descriptions
with a typed $ stay as written (the app hides dollars from crew).

### Heartwood admin invites work
- `isAdmin()` = the fixed UID list (unchanged, Alex / box sync / Patrick) OR `heartwoodAdminGrant()`: a
  `heartwoodAdmins/{uid}` doc with role admin AND that person's users/{uid} is a Heartwood profile with role admin.
- `heartwoodAdmins/{uid}`: written by `acceptStaffInvite` (Admin SDK) for an accepted Heartwood admin invite, or by a
  Heartwood admin for someone else (shape-checked: uid, role admin, companyId heartwood, grantedBy = caller,
  grantedAt = now). Nobody creates or deletes their own grant. No updates. Read: the person and Heartwood admins.
- Invites: a Heartwood admin (fixed list or grant) may invite an admin; supervisors still can't. The accept function
  checks the inviter (fixed list or grant) and writes profile + grant, rolling both back if the claim fails.
- Helper: a Heartwood profile with role admin counts as admin only with the grant (`resolveMembership(heartwoodAdmin)`).
- Still Alex-only or Alex + Patrick by design: reimbursements ledger, owner settings, timesheet office list (isOwner)
  and Xero (xeroUser). An invited admin gets what Patrick gets through isAdmin(); say if they should get more.
- Production check (read only, 12 Nov 2026): no Heartwood profile has role admin today and heartwoodAdmins is empty,
  so nobody gains access when the rules go live.
- Cost: crew requests that hit isAdmin() do one extra document lookup (the grant) after the UID list misses.

### Run sheets belong to one company
- Sheets carry `companyId`. Read: the worker, or an admin of the sheet's company (missing companyId = Heartwood; a
  missing sheet reads as not-there). Write: an admin of their own company, for a worker of their own company, never
  over another company's sheet. The hard-coded Chuwar depot check is gone: depot must be a non-empty string <= 200.
- The app takes the depot from Company settings (`orgSettings().address`); Heartwood's default is still
  208-220 Holdsworth Rd, Chuwar. A client company with no address can't approve and is told to add one.
- Existing sheets have no companyId and read as Heartwood (only Heartwood used run sheets).
- Tests: `test/heartwood-admin-runsheets.emulator.test.js`.

## Sprint 1 — manager, trades, job titles (not deployed)

Do not deploy from this branch until the rules, functions and hosting below are reviewed. `cloud/scripts/refuse-live-deploy.js` still refuses `firebase deploy`. Nothing here writes to production. Heartwood and `callup-test-h2vx` are not migrated by a script: a company with no `trade` field reads as earthworks.

Order after merge:

1. Publish `cloud/firestore.production.rules` (manager on office reads, quote-rate writes, invites up to manager, `companyTrades/{companyId}`, optional `trade` on company create, skill tags on `users/{uid}`). Do not publish `cloud/emulator/firestore.rules` as the live ruleset.
2. Publish `cloud/production/storage.rules` (manager can see office money the same way a supervisor can). Crew still read the amount on their own receipts and claims.
3. Deploy Cloud Functions (`previewStaffInvite`, `acceptStaffInvite`, helper) so a manager invite is accepted and the helper allows manager the same actions as a supervisor, except an admin invite.
4. Deploy hosting. Service worker `callup-shell-v100-multi-trade`. The new module is `app/features/trades.js`.

Sign-up stores `companies/{id}.trades` (a list) and `trade` (the first one). A missing list still reads `trade`, and a company with neither reads as earthworks. No backfill. Admins and managers may later update only `trades`. Reimbursement decisions (approve, decline, mark paid) are manager and admin; supervisors are not.

No Stripe, plan, or timesheet change. No destructive backfill. Job titles and extra trades are written only when a company signs up or an admin/manager saves them.

## Quote packs — landscaping, concreting, fencing (not deployed)

Do not deploy from the pull request until it is merged. No rules change in this batch. No production writes.

Order after merge:

1. Deploy hosting only. Service worker `callup-shell-v101-quote-packs`. New modules: `app/features/packs/money.js`, `landscaping.js`, `concreting.js`, `fencing.js`, `carpentry.js`, `tiling.js`, `plumbing.js`, `electrical.js`, `form.js`.
2. Do not deploy rules, functions or storage for this batch. Placeholder rates live in the app shell. A company default is written to the existing quote-rates doc (`packRates`) when someone chooses “Save as company default”.

Another open branch may also bump `app/sw.js` (a crew map). This name is `callup-shell-v101-quote-packs` so the two version strings conflict on purpose and need a manual pick at merge.

## Phase 3 — capacity and quote revisions (not deployed)

Do not deploy from this branch. Nothing here writes to production. No new composite index: revision lists filter on `companyId` only, and the jobs date query already has `companyId` + `date`.

Order after merge:

1. Publish `cloud/firestore.production.rules` (quote revisions under `quotes/{id}/revisions`, accepted quotes locked, Heartwood supervisor quote read, Heartwood office job read for capacity). Do not publish `cloud/emulator/firestore.rules`.
2. Deploy hosting. Service worker `callup-shell-v10x-phase3`. Other open PRs also change this cache name (crew map, quote packs, staff tab, chat push); keep this name so those conflicts stay visible. New modules: `app/features/capacity.js`, `app/features/quote-revisions.js`.
3. No functions deploy, no Storage rules change, no Stripe change, no index deploy, no backfill. Old quotes have no revisions until the next changed save.

## Bundle merge of PRs 72–77 (15 Nov 2026)

PRs 72 (crew map), 73 (quote packs), 74 (staff tab), 75 (chat and daily job push), 76 (capacity and quote revisions) and 77 (dispatch times) were merged together. One service worker name covers all of them: `callup-shell-v102-phase3-bundle`. The names in the sections above are superseded.

## GPS reminder on the Staff roster (not deployed)

Do not deploy from this branch. Do not merge it from the agent. Nothing here writes to production. Tests use mocks and the Firestore emulator only.

Order after merge:

1. Publish `cloud/firestore.production.rules`. Supervisors of the same company may read `liveLocations` (Heartwood) or `companies/{companyId}/liveLocations` (everyone else) so the Staff roster can show Sharing location or Not sharing. Operators and labourers still cannot read it. The crew map stays manager and admin. `users/{uid}/locationNotices/{noticeId}` is written by `remindLocationSharing` only; the person can read their own company. Do not publish `cloud/emulator/firestore.rules` as the live ruleset.
2. Deploy the function `remindLocationSharing` in australia-southeast1. No new secret. It reads `users/{uid}/fcmTokens`, deletes a token FCM reports as invalid, and writes `users/{uid}/locationNotices/current`. One reminder per person each 30 minutes (`sentAtMs` on that notice).
3. Deploy hosting. Service worker `callup-shell-v141-industries` (includes the GPS reminder and the industries, quotes, recurrence and certificates work). Phones keep the old Staff page until this shell is deployed.

No Storage change, no index deploy, no Stripe change, no backfill.

## Pest control checklists and certificates (not deployed)

Do not deploy from this branch. Do not merge it from the agent. Nothing here writes to production. Existing checklist rows and certificate files stay where they are.

After review, deploy hosting only. Service worker `callup-shell-v144-pest-trade`. The job checklist, checklist settings, and compliance certificates (the job panel and `sendCertificateEmail`) show only when the company's trades include pest control. Heartwood and every other trade keep the Photos tab, the photo steps on a job, quotes, and repeating jobs. `sendCertificateEmail` refuses a company that is not pest control.

No functions deploy until that email refusal is reviewed. No Storage change, no rules deploy, no index deploy, no Stripe change, no backfill.

## Repeat box stays compact until a job repeats (not deployed)

Do not deploy from this branch. Nothing here writes to production.

After review, deploy hosting only. Service worker `callup-shell-v145-repeat-fields`. In the job modal, How often, Every, Unit, End, End date, Visits, and the repeat help text stay hidden until an admin checks This job repeats. A job that already repeats opens with the box checked and those fields visible. Saving a job is unchanged.

No functions deploy, no Storage change, no rules deploy, no index deploy, no Stripe change, no backfill.

## Signup address, Civil trade, one dashboard banner (not deployed)

Do not deploy from this branch. Do not merge it from the agent. Nothing here writes to production. Existing companies keep the single `address` string. No backfill.

After review:

1. Publish `cloud/firestore.production.rules`. Signup and company settings may store `addressParts` (`street`, `suburb`, `state`, `postcode`) as well as the combined `address`. `traffic-control` and `civil-earthworks` are allowed trade ids, and the stored id `traffic-civil` still validates so current companies are not rewritten. The owner profile accepts every selectable trade as `jobTitleId`. Do not publish `cloud/emulator/firestore.rules`.
2. Deploy hosting. Service worker `callup-shell-v146-signup-polish`.

No functions deploy, no Storage change, no index deploy, no Stripe change, no backfill.

## Help tutorial videos

Merged to main as service worker `callup-shell-v147-help-videos`. Help links are plain youtu.be links. `helperAsk` can load `cloud/functions/shared/tutorial-videos.js` when the helper is switched back on. It is still hard-off.

## Crew map, notifications, and live location (not deployed)

Do not deploy from this branch. Do not merge it from the agent. Nothing here writes to production.

After review:

1. Build a fresh hosting folder with `bash tools/build-callup-hosting.sh`.
2. Deploy hosting only with `firebase deploy --only hosting --config cloud/firebase.hosting.json --project heartwood-9f37f`. Service worker `callup-shell-v148-crew-map`. This includes the help-video module from v147. No rules deploy and no index deploy.
3. Background push copy is in Cloud Functions (`fcmMessage`). The predeploy hook in `cloud/firebase.json` still refuses a functions deploy. When that hook is lifted for a reviewed release, publish `chatMessagePush`, `dailyJobPush`, `dailyJobChangePush`, `prestartJobPush`, `prestartAssetPush`, `prestartTimesheetPush`, `remindLocationSharing`, and `supportTicketCreated` in australia-southeast1. Until then, phones keep the previous data-only payload.

The Stripe GST PR 118 needs `callup-shell-v149` or later after this one.

## Boot timeout and recovery (not deployed)

Do not deploy from this branch. Nothing here writes to production. No functions, no rules, no indexes.

After review, deploy hosting only. Service worker `callup-shell-v149-boot-timeout`. A startup read that does not answer (profile, Heartwood staff list, platform session, company record) is abandoned and the phone uses its saved copy when it has one. Clearing a company view does not wait more than 5 seconds for the server. If the first screen has not painted after 12 seconds, Retry, Reload and Sign out replace the loading skeleton. Coming back online, or opening the app again, asks Firestore to reconnect. The multi-tab cache is unchanged. iOS single-tab persistence is a follow-up, not this change.

No functions deploy, no Storage change, no rules deploy, no index deploy, no Stripe change, no backfill.

This shell is `callup-shell-v149-boot-timeout`, so the Stripe GST work noted above now needs `callup-shell-v150` or later.

## Help video 5: add a client and book a job (not deployed)

Do not deploy from this branch. Do not merge it from the agent. Nothing here writes to production. No functions, no rules, no indexes, no Firebase change.

After review, deploy hosting only. Service worker `callup-shell-v150-help-video-5`. Video 5, "Add a client and book a job" (`https://youtu.be/0GWlLkJpRD0`), is in the Help list for office viewers. Questions about adding a client or customer, or booking or creating a job, link to that video. Links stay plain youtu.be links. `helperAsk` is still hard-off.

No functions deploy, no Storage change, no rules deploy, no index deploy, no Stripe change, no backfill.

This shell is `callup-shell-v150-help-video-5`, so the Stripe GST work noted above now needs `callup-shell-v151` or later.

## Push banner and FCM error codes (not deployed)

Do not deploy from this branch. Do not merge it from the agent. Nothing here writes to production.

After review, deploy hosting and the push functions. Service worker `callup-shell-v151-push-banner`. The banner hides once notifications are on, and a failed send logs the FCM error code without the device token.

Functions in australia-southeast1 that send with `fcmMessage`: `chatMessagePush`, `dailyJobPush`, `dailyJobChangePush`, `prestartJobPush`, `prestartAssetPush`, `prestartTimesheetPush`, `remindLocationSharing`, and `supportTicketCreated`.

No rules deploy, no index deploy, no Storage change, no Stripe change, no backfill.

## Crew map job pins (not deployed)

Do not deploy from this branch. Do not merge it from the agent. Nothing here writes to production.

After review, deploy hosting only. Service worker `callup-shell-v152-crew-map-jobs`. The crew map plots today's job pins even when nobody is clocked on. An office or admin sign-in geocodes an address that has no pin and saves only `job.geo`.

No functions deploy, no rules deploy, no index deploy, no Storage change, no Stripe change, no backfill.

## Last known crew dots (not deployed)

Do not deploy from this branch. Do not merge it from the agent. Nothing here writes to production. No migration of live location documents.

This applies to every CallUp company, not only Heartwood. Heartwood still stores positions in `liveLocations/{uid}` and every other company in `companies/{companyId}/liveLocations/{uid}`. Clock off keeps the last position (`clockedOn: false`, `clockedOffAt`) instead of deleting it. A clocked-on dot that is older than 10 minutes stays on the map and fades. Service worker `callup-shell-v154-last-seen`. PR 118 also wants v153, so this shell is v154.

After review:

1. Build a fresh hosting folder with `bash tools/build-callup-hosting.sh`.
2. Deploy hosting with `firebase deploy --only hosting --config cloud/firebase.hosting.json --project heartwood-9f37f`.
3. Publish `cloud/firestore.production.rules`. Do not publish `cloud/emulator/firestore.rules` as the live ruleset. `cloud/firebase.json` points Firestore rules at the emulator file, so do not deploy rules with that config.
4. Deploy the `liveLocations` composite index (`companyId` and `clockedOn`) so a supervisor roster query stays allowed for every company: from `cloud/`, `firebase deploy --only firestore:indexes --project heartwood-9f37f`.

No functions deploy, no Storage change, no Stripe change, no backfill.
## Weekday Clock On reminder (not deployed)

Do not deploy from this branch. Do not merge it from the agent. Nothing here writes to production or sends a push.

There is no existing Clock On reminder. `dailyJobPush` at 06:00 Australia/Brisbane tells people about jobs they are assigned that day. `remindLocationSharing` is a manual GPS nudge. Neither checks whether someone is already clocked on. This adds `clockOnReminderPush` instead of extending either one.

The reminder is on by default for labourer, operator, supervisor and manager in every company. A missing `muteClockOnReminder` means on. The person turns it off in Notifications. An admin turns it off or on for someone else on the Staff screen. Office admins are not reminded. Patrick's profile role in this app is operator, so he is included with no production write. If his live `users/{uid}.role` is `admin`, he is office and is not reminded; an admin does not need to write a flag for an operator.

Each company is checked on its own clock. `companies/{id}.timezone` or `timeZone` is used when it is a real IANA name. Otherwise Australia/Brisbane. The function runs every 15 minutes (`*/15 * * * *`, time zone UTC) and sends when that local time is 06:30 up to, but not including, 07:00, Monday to Friday. `clockOnReminders/{companyId}_{date}_{uid}` is the once-a-day claim. Test companies, archived or suspended companies, owner-paused companies, ended trials, ended friend plans, and paid plans that are not billing active or trialing are skipped. Heartwood is not skipped for those reasons.

Service worker `callup-shell-v155-clock-on-reminder`. Main is `callup-shell-v154-last-seen` after PR 133. This shell is v155 so the two do not clash.

After review:

1. Deploy the new function only: `clockOnReminderPush` in australia-southeast1 on heartwood-9f37f. Use the isolated functions deploy. Do not deploy the rest of the functions codebase. `cloud/firebase.json` still refuses `firebase deploy` from `cloud/`. Do not remove that hook.
2. Deploy hosting with `firebase deploy --only hosting --config cloud/firebase.hosting.json --project heartwood-9f37f`.
3. Deploy Firestore rules from `cloud/firestore.production.rules` only. Do not deploy `cloud/emulator/firestore.rules`. The prefs doc may include `muteClockOnReminder`. `clockOnReminders` has no client rule, so the claim stays server-only.
4. No index deploy. No Storage change. No Stripe change. No backfill. No production data write.

## Help videos: Today, start times, photos, email, and repeating jobs (not deployed)

Do not deploy from this branch. Do not merge it from the agent. Nothing here writes to production. No functions, no rules, no indexes, no Firebase change.

After review, deploy hosting only. Service worker `callup-shell-v159-help-videos`. Main is `callup-shell-v158-stop-series`. This branch previously claimed `callup-shell-v157-help-video-6`; that name is not reused. Open PR 135 claims `callup-shell-v156-dispatch-drag`. Videos 6 to 10 are plain youtu.be links: Today and the planner (`https://youtu.be/h7CC6hnrohM`), Start times and who's free (`https://youtu.be/7lg0i8D1wdg`, office), Job photos and documents (`https://youtu.be/AecI2Vf_W3w`), Email a job to the client (`https://youtu.be/Mucs-GTqRJc`), and Recurring jobs (`https://youtu.be/wFZgFjWUcuc`, office). Questions about those screens carry the matching video. `helperAsk` is still hard-off.

No functions deploy, no Storage change, no rules deploy, no index deploy, no Stripe change, no backfill.

## Admin password reset (15 Nov 2026)

Do not deploy from this branch. When it is deployed: hosting (service worker `callup-shell-v108-password-reset`) and the function `adminSendPasswordReset` in australia-southeast1. It uses the same `RESEND_API_KEY` and `INVITE_EMAIL_ENABLED` gate as `inviteEmailWorker`. The reset link is emailed to the staff member and is not returned to the browser. Firestore `passwordResetRate/{uid}` is Admin SDK only (client read and write denied). Rebased onto main's `callup-shell-v106-multi-category-quotes`; this branch stays `callup-shell-v108-password-reset`.

## Stop a repeating series (not deployed)

Do not deploy from this branch. Do not merge it from the agent. Nothing here writes to production.

An admin stops a repeating job with Stop this series, on the first job or on a later visit, or by unticking This job repeats. The confirm says how many future visits will be removed and lists future visits that stay because they were edited, skipped, started, completed, or already have notes, photos, documents, a timesheet, an invoice or a purchase order. Visits today and earlier stay. Removed visits are marked Cancelled, the same soft cancel the generator already uses when a visit falls outside the series. The template is marked seriesEnded and its repeat rule is cleared, so the rolling 60-day sweep does not add visits. Skip this visit now sets the visit to In progress and keeps the skipped flag, so it stays on the planner as In progress and the generator still leaves it alone.

Service worker `callup-shell-v158-stop-series`. Main is `callup-shell-v155-clock-on-reminder` after PR 134. Open PRs 135 and 136 already claim v156 and v157, so this shell is v158 so they do not clash.

After review:

1. Deploy hosting with `firebase deploy --only hosting --config cloud/firebase.hosting.json --project heartwood-9f37f`. Phones pick up `callup-shell-v158-stop-series`.
2. Deploy Firestore rules from `cloud/firestore.production.rules` only. Do not deploy `cloud/emulator/firestore.rules`. The change is the admin-only check on seriesEnded, seriesEndedOn, recurrence, seriesRole and seriesId for company job updates.
3. Deploy the repeating-job functions only: `recurrenceOnSave` and `recurrenceSweep` in australia-southeast1. Do not deploy the rest of the functions codebase. `cloud/firebase.json` still refuses `firebase deploy` from `cloud/`.
4. No index deploy. No Storage change. No Stripe change. No backfill. No production data write.
