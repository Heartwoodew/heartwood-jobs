# Tenancy, Base vs Pro, rules, and functions

**Status:** the client and the cloud **source** are on `main` `01f2c5a6f407e123f7f48432f07f1e9445a36007`. Deploy of that cloud source is blocked. Live Firestore rules are not in the repo.

## Project

`app/firebase-config.js` names Firebase project `heartwood-9f37f` and bucket `heartwood-9f37f.firebasestorage.app`. The apiKey and other web-config fields are in that file. They are omitted from this pack. The file’s own comment (lines 1–2) says they are not secrets and that security is Auth plus rules. This pack still does not copy them.

`cloud/.firebaserc` and `cloud/production/.firebaserc` default to `demo-heartwood` (`cloud/MIGRATION.md` lines 97 and 103). Do not point the production config at the live project from habit. The only reviewed storage command is written in `cloud/MIGRATION.md` lines 107–109, and that note says this branch has not run it.

## Tenant

`HEARTWOOD_TENANT` is `"heartwood"` (`app/features/cloud-storage.js` line 9).

`resolveMembership` (lines 53–84):

- No uid, and no profile and no bootstrap: `{ ok: false, reason: "no-membership" }`.
- Bootstrap UIDs with no profile are still members: Alex and Patrick (`BOOTSTRAP`, lines 15–18). Both are `rulesAdmin: true` and `finance: true`.
- `profile.finance` is ignored (comment lines 13–14), so a client cannot grant finance by writing the profile.
- Explicit `profile.tenantId` is the tenant. Missing `tenantId` on a profile, or a bootstrap user, becomes `heartwood` (lines 60–61).
- `requestedTenantId` and `requestedBusinessId` are stored as ignored fields and not used (lines 55–56 and 81–82).
- `customerIds` on the profile, when a non-empty string list, limits `canSeeJob` to jobs whose `client` is in the list (lines 65–67 and 100–103).
- A job with no `tenantId` is treated as `heartwood` (`jobTenantOf`, lines 44–47).
- Membership `plan` is always `"base"`. `xero` and `invoicing` on the membership object are always false (lines 78–80).

`users` in the emulator model (`cloud/emulator/firestore.rules` lines 29–36): a person may read their own profile; an app admin may read users. Create and update of your own profile cannot set or change `tenantId`, `role`, `customerIds`, or `finance`. Delete is false. The live users rules are **GAP**. The app detects admin by trying to list `users`, which only works if the **live** rules allow that list.

`tenants/{id}` in the emulator model: any signed-in user may read; nobody may write (lines 47–50). Heartwood does not get a second tenant from this app.

Chat, fleet, storage, and run sheets each repeat the same “missing tenantId means heartwood” rule in their own functions. They are cited in the topic files.

## Base vs Pro, without papering over the clash

Three different “plan” ideas exist on `main`. A helper must not collapse them into one switch.

**1. CallUp Base, in `CALLUP_BASE`** (`cloud-storage.js` lines 20–35): jobs, photos, receipts, quotes, staff permissions are true. `xero` and `invoicing` are false. `features.fleet` and `features.policies` are false. `cloud/MIGRATION.md` lines 5–7 says the same, and says Heartwood’s current Xero buttons and `xeroQueue` documents stay on the existing desktop worker.

**2. Compliance Pro, in `compliance.js`:** tenant `heartwood` gets fleet and policies. Other tenants see “Compliance is a CallUp Pro feature.” This does not turn on Xero. It does not change `resolveMembership().plan`.

**3. The Heartwood webpage on `main`:** admins have an Invoices screen. Two UIDs have Send to Xero, Check Xero, and the profit chart. That UI is live in `app/app.js`. It is not behind `CALLUP_BASE.xero`.

**4. Cloud Pro Xero, not running:** `cloud/functions/pro/xero-queue.js` is not imported by `cloud/functions/index.js` (header lines 4–9 of `index.js`). `handleXeroQueue` returns `ran: false`, `reason: "pro-plan-not-enabled"` unless `CALLUP_PLAN=pro` and `XERO_PROCESSING_ENABLED=true`. Even then `transportCalls` is 0 and `liveXero` is false (lines 23–41). The default transport throws `xero-stub: no live Xero client is configured`. No Xero credential is read.

So: a how-to answer about “does the app send invoices to Xero?” for a person on the Xero UID list is: the page queues `xeroQueue`; a desktop worker named in comments is supposed to create a draft; that worker is not in this repo; the Cloud Function in this repo will not call Xero.

## Functions that exist on main

`cloud/functions/index.js`:

| Export | What it does in this source | Deployed? |
| --- | --- | --- |
| `photoInboxWorker` | `onDocumentCreated` `photoInbox/{id}` in `australia-southeast1`. Writes `status: "queued"`, `holdReason`, `resolvedTenantId`. Ignores a client `tenantId`. Does not read Gmail. Does not set `photosEmailed*`. | Repo says do not deploy. `cloud/firebase.json` predeploy runs `refuse-live-deploy.js`. Whether a copy is already in production is **GAP**. |
| `retentionSweepHandler` | Returns `scheduling-not-approved` while `SCHEDULING_APPROVED` is false. Not scheduled. | Not an `onSchedule`. Calling the export does not delete. |

`handlePhotoIntake` hold reasons (`photo-intake.js`): `unknown-mailbox` (only `alex@heartwoodew.com` maps to `heartwood`), `not-job-photo` (subject must match `[Job Photos] Job #…`), `gmail-client-not-configured` if `GMAIL_INTAKE_ENABLED=true` (still no client), otherwise `gmail-rights-not-enabled`. `gmailCalls` is always 0. `fetchGmailAttachment` throws if something imports the stub.

`cloud/package.json` script `deploy` is `node scripts/refuse-live-deploy.js`. Tests are `npm test`, `npm run test:browser`, and `npm run test:emulator` (emulator project `demo-heartwood` only). This audit did not run them.

## Rules files, and what they are not

| File | Safe to say |
| --- | --- |
| `cloud/emulator/firestore.rules` | Emulator model. Header lines 1–11: do not deploy; it would replace job, quote, photo-email, and receipt rules. Jobs and receipts in this model are read-any-signed-in, write false. That is **not** how the live app behaves, because the live app writes jobs. |
| `cloud/production/firestore.chat.rules` | Paste between BEGIN/END CHAT RULES. |
| `cloud/production/firestore.fleet.rules` | Paste between BEGIN/END FLEET RULES. |
| `cloud/production/firestore.swms.rules` | Paste between BEGIN/END SWMS SIGNATURE RULES. |
| `cloud/production/firestore.runsheets.rules` | Paste between BEGIN/END RUN SHEET RULES. |
| `cloud/production/storage.rules` | Proposed Storage rules, same bytes as the emulator copy. `cloud/MIGRATION.md` says not deployed. `cloud/production/firebase.json` has only a storage key, so a later reviewed deploy of that config would not publish Firestore or Functions. |

Admin UIDs **in these rule files** (not a claim about a third production UID):

- Alex `1JKLsoxkQNfkphBBO0vDz2ziEyj2`
- Patrick `R7t41e54Ykcdk9WPdVZnDd697iI2`

Xero / finance UID list in the client and in these files: the same two. Storage finance for any other tenant would need `tenants/{id}.financeUids`, which this branch does not create (`storage.rules` lines 142–151 and the header lines 13–16).

`cloud/MIGRATION.md` line 101: the sync admin UID mentioned in `app.js` is not in the repository and is not given Storage access by these rules.

## Secrets named, and not present

`cloud/MIGRATION.md` lines 113–121 lists names that must not be created for Base: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_INTAKE_ENABLED`, `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REFRESH_TOKEN`, `XERO_ORG_ID`, `RETENTION_PURGE_ENABLED`, `RETENTION_SCHEDULING_APPROVED`, `HEARTWOOD_RETENTION_APPROVED`. This pack does not contain values for them. The desktop worker’s real environment variable names are **unknown** (line 115).

Provenance: files and lines above, commit `01f2c5a6f407e123f7f48432f07f1e9445a36007`.
