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
