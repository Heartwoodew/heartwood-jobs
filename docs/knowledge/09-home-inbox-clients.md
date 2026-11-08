# Home, inbox, clients, search

**Status: LIVE** on `main` `01f2c5a6f407e123f7f48432f07f1e9445a36007`.

## Admin Home

`homeView` / `homeBody` (`app/app.js` lines 1021–1038).

- Greeting from the Brisbane hour: before 12 Good morning, before 17 Good afternoon, else Good evening (`greet`, line 936). First word of `me.name`.
- Compliance banner, then the cloud-expiry sentence for admins, then the SWMS reminder.
- **Needs attention** (`attentionHtml`, lines 1000–1020), admin only:
  - jobs with a date today or later, not done, nobody allocated
  - jobs with no PO that are done and not invoiced, or dated within 7 days, or in progress
  - unread builder emails (owner, and only after the inbox listener has run)
  - open incidents
  - receipts to reimburse (owner), with a duplicate hint
- Profit chart if `canXero` (see the money topic).
- Today and tomorrow lists. Today also includes earlier jobs still **In progress** (`homeLists`, lines 945–949).

The stat buttons and the big shortcut buttons are in the HTML with class `hidden` (lines 1032–1033). They are not a visible control unless CSS shows `.hidden`, which this pack did not treat as a feature. The lists and the attention block are the visible home.

There is no separate “reminders” collection. Reminders on Home are the SWMS banner, the compliance banner, the cloud-expiry line, and Needs attention.

## Operator Home

The Today tab (`renderOperator`, lines 1931–1942): greeting, job count, approved driving-order note, fleet banner, SWMS reminder, today’s cards. Tomorrow is the Jobs tab, not a second home column. **Report incident** and **SWMS** are on More, and also as buttons in `homeBody` when `admin` is false (line 1031). The operator shell does not call `homeBody`. It uses the Today tab.

## Inbox (owner only)

`inboxView` (`app/app.js` lines 1410–1431). Others see `Owner only.`

Documents: `inbox/{id}`. Comment (line 1398): written by `tools/sync_inbox.py`. That writer is **GAP**. The page does not fetch Gmail.

Caption: “Builder emails · last 30 days”. The 30-day cut is not applied in `inboxView`; it shows every document the listener returns. If the worker only writes 30 days, that limit is outside this repo.

Filters: All, Orbit, Torsion, Silkwood (`BLD`, line 1408). Unread only. Search over subject, from, snippet, match key, job label, attachment names.

Tap the row: opens `m.link` in a new tab and, if unread, sets `read: true` (`bindInbox`, lines 1437–1438). The page does not download attachments. A matched job button opens the job card, or `Job not loaded` if that job is outside the loaded window.

Badge on the Inbox nav is the unread count (`inboxBadge`, lines 1406–1407). Listen failure: `Inbox not available: {code}` (line 1419).

## Clients

`clientsView` (`app/app.js` lines 1477–1488). Collection `clients/{id}`: `name`, `office.{address,phone}`, `contacts[]` with kind, name, role, mobile, phone, email, source, default (comment lines 1442–1443). The JSON file named in the comment is **GAP**.

Anyone signed in who can read the collection sees the cards. Kinds (`KIND`, line 1471): Supervisors, Accounts, Admin / ordering. **Call** and **Email** are links.

Admins (`isAdm`) can add a client (id from the name, lowercased, non-alphanumerics become hyphens, max 40 characters, line 1494) and add or edit a contact (`editContact`, line 1498). Failure: `Not saved: {code}` and `Clients not available: {code}`.

The job card supervisor uses this list when `meta/supervisors` has no match (`jobSupervisor`, lines 1454–1462).

## Search

Two searches:

- Header (`gsearch`, lines 2661–2684): lot, street, PO, job number, client. Twelve hits. Admin searches the loaded pools (jobs, undated, done). Staff only jobs whose `assigned` contains their uid. Enter opens the first hit. Escape clears.
- Jobs / unscheduled / completed / invoices (`matchQ`, lines 194–199): the search box on that screen. It does not query Firestore. It filters rows already loaded.

Provenance: `app/app.js` functions named above, commit `01f2c5a6f407e123f7f48432f07f1e9445a36007`.
