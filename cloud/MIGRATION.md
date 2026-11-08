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

CallUp Base can invite an operator or a supervisor. Admin is not an invite role. The Staff screen is rules-admin only (the same people who can list `users`). The invitee opens `https://jobs.heartwoodew.com/app?invite=<token>`, sets a password, and the accept function creates the Auth user and `users/{uid}` with the name and role from the invite. The browser never writes `role`.

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
