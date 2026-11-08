# CallUp knowledge pack

Source-verified how-to notes for a future **read-only** in-app helper. This pack describes the Heartwood Jobs / CallUp app as it exists in git. It does not change the app, deploy anything, or read production data.

| | |
| --- | --- |
| Repository | `Heartwoodew/heartwood-jobs` |
| Branch audited | `main` |
| Commit | `01f2c5a6f407e123f7f48432f07f1e9445a36007` |
| Commit subject | Merge pull request #12 from Heartwoodew/cursor/compliance-under-safety-c4a6 |
| Audit date | 2026-11-08 |
| Open PRs checked | GitHub `gh pr list --state all` the same day. Only #14, #13, and #4 were open. |

Every topic file cites `file`, function or rule name, and line numbers on that commit unless a section is explicitly marked **OPEN PR** or **GAP**.

## Status words

- **LIVE** — present on `main` at the commit above, in the client or in cloud source that the client calls. “LIVE in the client” does not mean a Cloud Function or a rules file has been deployed. This audit did not open the Firebase console.
- **IN REPO, NOT DEPLOYED** — source exists on `main`, and the repo itself says not to deploy it (`cloud/scripts/refuse-live-deploy.js`, `cloud/MIGRATION.md`).
- **OPEN PR** — not on `main`. Described from the PR head commit only.
- **PLANNED** — named in comments or `cloud/MIGRATION.md` as a later step. Not a working screen.
- **GAP** — the behaviour is referenced, but the source is not in this repository, or two sources disagree and this pack does not pick a winner.

## Topic files

| File | What it answers |
| --- | --- |
| [00-scope-and-modules.md](00-scope-and-modules.md) | What “CallUp” is in this repo, every module, what is not here |
| [01-roles-navigation.md](01-roles-navigation.md) | Admin, supervisor, operator shells and every menu item |
| [02-jobs-dispatch-runsheets.md](02-jobs-dispatch-runsheets.md) | Jobs, dispatch, unscheduled, completed, run sheets, route optimiser |
| [03-photos-receipts.md](03-photos-receipts.md) | Email photos, cloud gallery, receipts, Hubdoc, reimbursements |
| [04-chat.md](04-chat.md) | Team chat and job chat |
| [05-quotes.md](05-quotes.md) | Guided quotes and rate card |
| [06-money-timesheets-xero.md](06-money-timesheets-xero.md) | Timesheets, invoices, Xero queue, profit chart |
| [07-safety-swms.md](07-safety-swms.md) | Incidents and SWMS sign-off / PDF |
| [08-compliance.md](08-compliance.md) | Fleet rego, COI, policies |
| [09-home-inbox-clients.md](09-home-inbox-clients.md) | Home, reminders, inbox, clients, search |
| [10-offline-errors.md](10-offline-errors.md) | Offline cache and error strings from code |
| [11-tenancy-cloud-plans.md](11-tenancy-cloud-plans.md) | Tenant boundaries, Base vs Pro, rules, functions |
| [12-open-and-planned.md](12-open-and-planned.md) | Open PRs vs planned work vs things not found |
| [13-limitations.md](13-limitations.md) | Precise limits and gaps |
| [persona-and-voice.md](persona-and-voice.md) | Helper persona and spoken-reply spec. Not built. |
| [callup-knowledge.md](callup-knowledge.md) | The same topics in one file |

## Recommended helper integration

Do not ship this in the browser as a prompt the page can edit. A later, separate change can add a **callable Cloud Function** (Firebase `onCall`) in **`australia-southeast1`**.

That region is already the one named for cloud workers on `main`:

- `photoInboxWorker` uses `region: "australia-southeast1"` in `cloud/functions/index.js` (`photoInboxWorker`, lines 16–17).
- `cloud/MIGRATION.md` line 89 says the same region if those workers are ever deployed.

The unmerged staff-invite callables (PR #14, not on `main`) also set `INVITE_REGION = "australia-southeast1"`. Copy the region. Do not copy the invite function into the helper.

The function should:

1. Require a Firebase Auth user. `onCall` verifies the ID token. If `request.auth` is missing, return an error and no answer. Do not accept a tenant id, role, or “I am admin” flag from the client. `resolveMembership` in `app/features/cloud-storage.js` (lines 49–84) already ignores `requestedTenantId` and `requestedBusinessId`.
2. Load this pack (bundled with the function, or read from a private file). Answer how-to questions from the pack. Say **GAP** when the pack says the source is missing. Follow [persona-and-voice.md](persona-and-voice.md) for tone. That file is a spec only. The app has no helper UI and no spoken replies yet.
3. For a question about a live record (“what is on my run sheet today”), read Firestore **as that user**, not with an Admin SDK client that bypasses rules. The Admin SDK ignores `firestore.rules`. A rules-scoped read means the user’s token and the rules that are actually published. This repository does **not** contain the live Firestore rules (`cloud/MIGRATION.md` lines 99–100; `cloud/emulator/firestore.rules` lines 1–4). Until those live rules are the ones the function uses, do not answer with other people’s jobs, receipts, invoices, or chat.
4. Apply the same visibility as the page, even after a rules-scoped read:
   - Dollars only when `canSeeMoney()` would be true (`app/app.js` `canSeeMoney`, line 650).
   - Xero wording, profit, and “Send to Xero” only when `canXero()` would be true (`XERO_UIDS`, lines 646–647).
   - Inbox and the reimbursement ledger only for the owner UID (`isOwner`, lines 642–643).
   - Job chat only when `canSeeJob` would allow it (`app/features/cloud-storage.js` `canSeeJob`, lines 125–131).
5. Do not put credentials, mailbox tokens, the Firebase web apiKey, customer records, or job documents into the pack or into logs. `app/firebase-config.js` holds the web config for project `heartwood-9f37f`. Those values are omitted here on purpose.
6. Do not deploy this function from the current `cloud/` scripts. `npm run deploy` in `cloud/` runs `refuse-live-deploy.js` and exits 1. A helper deploy is a later, separate approval.

This pack does not implement that function.

## What this pack will not do

It will not merge a PR, deploy rules or functions, or sign in to production. Open PR behaviour is not live.
