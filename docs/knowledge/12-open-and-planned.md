# Open pull requests, planned work, and names that were not found

Checked 2026-11-08 with `gh pr list --state all` and `gh search prs` on `Heartwoodew/heartwood-jobs`. `main` was `01f2c5a6f407e123f7f48432f07f1e9445a36007`. None of the open PRs are merged. Do not describe them as something the live app does.

## OPEN PR #14 — staff invites

- URL: https://github.com/Heartwoodew/heartwood-jobs/pull/14
- Head: `cursor/staff-invites-b8c3` at `f6336d570bd036e5765ca5f98d316fc9e03541dc`
- Title: Add admin staff invites
- Not on `main`. `app/features/staff-invites.js` does not exist on `main`.

From that head, not from `main`:

- An admin invites an **operator** or a **supervisor**. The module comment says it does not grant admin, does not write Firestore from the browser module, and does not send email (`app/features/staff-invites.js` lines 1–4 on that commit).
- Invite link origin is `https://jobs.heartwoodew.com/app` plus `?invite=`. TTL is 7 days (`INVITE_TTL_MS`, `INVITE_LINK_ORIGIN`).
- Password length 8–128 (`passwordOk`).
- `cloud/functions/index.js` on that branch adds callables `previewStaffInvite` and `acceptStaffInvite` in `australia-southeast1`. Accept creates the Auth user and `users/{uid}` with the invited role. `inviteEmailWorker` queues mail. `INVITE_EMAIL_ENABLED` must be the string `"true"` or the message stays in `inviteMail` and nothing is sent. The file says it does not open an SMTP connection.
- `refuse-live-deploy.js` is still the predeploy guard on that branch. The functions are source, not a deploy this audit performed.
- Rules to paste: `cloud/production/firestore.invites.rules` on that branch. The header says they are a prototype and must not be deployed by publishing `cloud/emulator/firestore.rules`.

## OPEN PR #13 — servicing and prestart

- URL: https://github.com/Heartwoodew/heartwood-jobs/pull/13
- Head: `cursor/fleet-servicing-c4a6` at `1cd102603279f253a1bac48c72c27fc07df1849b`
- Title: Add fleet servicing under Compliance
- Not on `main`. `app/features/servicing.js` and `app/features/prestart.js` do not exist on `main`.

From that head:

- Servicing: last service and next due by date and/or hours/km on a fleet asset. Types include 250 hour, major, repair, other. Cost is a separate field for people who can see money. Invoice photos are not stored (`servicing.js` header).
- Prestart: a daily checklist. Default items depend on vehicle, trailer, or plant (fluids, tyres, lights, brakes, and the rest of `PRESTART_ITEMS`). Staff submit once. A fail stays “defect — check before use” until an admin marks it resolved. Photos are not stored (`prestart.js` header).
- Commit subjects on the PR: “Add a Servicing tab for each fleet machine.”, “Add a daily prestart checklist for each machine.”, “Let every signed-in Heartwood user open Prestart and check any machine.”
- Paste rules on that branch: `cloud/production/firestore.servicing.rules`, `cloud/production/firestore.prestart.rules`. Not merged.

Compliance rego / COI / policies **are** on `main`. Servicing and prestart are not.

## OPEN PR #4 — quote machine bundles

- URL: https://github.com/Heartwoodew/heartwood-jobs/pull/4
- Head: `cursor/machine-quote-bundles-dbce` at `caec8bffaf384dffbd3c1c62d2a311f6b517f260`
- Title: Quote machines with one truck, GST once, and an optional second operator
- Not on `main`. `main` still has the labourer add-on and does not add GST (`app/features/quotes.js` on `main`, line 705: “GST is not added here”).

From that head’s `app/features/quotes.js`:

- `GST_RATE = 0.1`. GST is 10% once on the ex GST subtotal, not per line (comment near `calcQuote`).
- Both skid and excavator: one truck, plus a dual-machines surcharge, not a second truck. Comment says the default surcharge is $50 ex GST.
- A second operator is optional. Comment says the default is $100 ex GST per hour of on-site time, and only when two operators are required.
- The staff run-sheet text lists machines and operators and omits prices and the surcharge (comment “Staff run sheet”).
- A later commit on the PR says the dual-machine surcharge stays off the staff run sheet.

Do not answer a live how-to with these GST rules until this PR is on `main`.

## Merged, so it is on main (do not list as open)

PRs #1–#3 and #5–#12 are merged. Their behaviour is the LIVE topics: cream phone layout, cloud photos and retention, gallery, chat, optimise order, SWMS sign-off, compliance, compliance under the Safety menu. The merge commit for #12 is the `main` SHA above.

## Planned, named in `cloud/MIGRATION.md`, not a screen

These are later owner steps. The source constants that would turn them on are still false or unwired.

| Item | Evidence |
| --- | --- |
| Gmail photo intake that actually reads mail | `photo-intake.js` always holds. `gmail-stub.js` throws. |
| Scheduled 3-month deletion | `SCHEDULING_APPROVED = false`. Handler no-ops. |
| Heartwood historical purge | Needs `HEARTWOOD_RETENTION_APPROVED` and the source constant. `MIGRATION.md` lines 40–42 say enabling it later would make old jobs eligible and needs a backup first. |
| Bucket lifecycle on `_expired/` | `PROPOSED_storage_lifecycle.json` is not applied (`MIGRATION.md` lines 69–70). |
| Storage rules publish | Reviewed command is written. `MIGRATION.md` line 105 says it has not been run. Live bucket state is **GAP** (no production access in this audit). |
| Cloud Pro Xero | `xero-queue.js` not imported. |
| A third “sync” admin | Mentioned in a comment. UID not in the repo. |

`MIGRATION.md` lines 137–148 is an ordered owner checklist. This pack does not mark any of those steps done.

## Looked up, not found

On 2026-11-08 the open PR list and a GitHub search for pull requests containing “rebrand”, “timesheet”, or “clock” did not return a rebrand PR or a timesheet-clock PR. Remote heads from `git ls-remote --heads origin` also had no branch name with those words. There is no clock-in screen on `main` (timesheets are typed start and finish).

If a rebrand or a live clock is being written on a machine that has not pushed, it is outside this repository. Do not invent it.

Provenance: `gh pr list` and `gh pr view` on 2026-11-08; `git show` of the three head commits named above; `cloud/MIGRATION.md` on `01f2c5a6f407e123f7f48432f07f1e9445a36007`.
