# Timesheets, invoices, and Xero

**Status: LIVE** in the client on `main` `01f2c5a6f407e123f7f48432f07f1e9445a36007` for Heartwood’s existing screens. CallUp Base comments say Base has no Xero and no invoicing (`app/features/cloud-storage.js` lines 6–7). Both statements are in the repo. The webpage on `main` still has the invoice and Xero buttons. The cloud Pro executor does not run them. See [11-tenancy-cloud-plans.md](11-tenancy-cloud-plans.md).

There is **no clock-in / clock-out** screen on `main`. Hours are typed as start and finish. A search of open PRs for “timesheet” and “clock” on 2026-11-08 returned no pull request. That is **GAP**, not a hidden screen.

## Timesheets

Document id: `{uid}_{weekStart}` where week start is Monday (`bindTs`, line 851; `weekStartOf`, line 769). Week is Monday–Sunday in the Brisbane date string.

`tsHours` (lines 772–775): finish minus start, overnight if finish is earlier, then minus **30 minutes** (`TS_LUNCH`, line 767). The editor labels every day “less 30 min lunch”. A day with only a start or only a finish does not save: `{dd/mm}: enter both start and finish` (line 861). Notes alone are stored and count as 0 hours. A note on a day with no hours is emailed as `not worked ({note})` (`tsText`, line 810).

**Staff** (anyone who is not Alex’s UID, including other admins): `tsEditor` (lines 783–794). **Save hours** merges the week. Toast `Hours saved`. Failure: `Not saved: {code}`. Leaving the week with unsaved edits asks `You have unsaved hours. Leave this week without saving?` (line 836). “Sent to accounts” is display-only for them.

**Owner** (Alex’s UID only, `isOwner`): `tsAdmin` (lines 815–829) lists every other staff login for that week, plus any timesheet uid that is not in the staff list. Alex’s own row is excluded by `p.uid !== ALEX_UID` (line 818).

Send is not done by the server. **Send to accounts (Gmail)** opens Gmail compose as `authuser=alex@heartwoodew.com` to `accounts@heartwoodew.com` (`ACCOUNTS_EMAIL`, line 766; `tsGmailUrl`, lines 802–803). The body starts `Hi Nicole,` (`tsText`, line 806). **Other mail app** is a `mailto:`. **Copy** copies the same text. Clicking Send or the mailto also sets `sent: true` on the timesheet (line 843). **Unmark sent** clears it. Failure: `Not marked sent` or `Not saved`.

The page tells the owner: “Opens a Gmail draft (alex@heartwoodew.com) to accounts@heartwoodew.com (Nicole); you press Send.” (line 828).

Load errors: `Timesheets not available: {code}` or `Timesheet not available: {code}` (lines 840 and 853).

Retention does not delete `timesheets` (`NEVER_PURGE_COLLECTIONS`).

## Invoices (admin shell only)

`invoicesView` (`app/app.js` lines 1589–1653). Non-admins who somehow land here are sent home (line 1590). The menu item is already hidden unless `me.role === "admin"` (`shell`, line 160).

Data is every job with `status == "Done"` (`ui.done`, listener line 93), not the 6-week window.

Tabs:

| Tab | Jobs |
| --- | --- |
| Ready to invoice | Done, no `invoiceNo`, not `invoiceExcluded`, not `doNotInvoice` |
| Numbered | Has `invoiceNo`, not `invoiced` |
| Recent | Invoiced, invoice or job date within 30 days |
| Removed | `invoiceExcluded` and no invoice number. The job is kept. **Restore** puts it back. |

Ready rows: description (default from `invDescDefault`, lines 1347–1351) and amount ex GST (prefill `invoiceAmount` else `poAmount`; both live on the office-only `jobMoney/{jobId}`, never on the crew-readable job). They save as you type (`bindInvoices` continues at line 1671). Over PO shows a note and **Email supervisor**. It does not block.

**Assign numbers** (`assignNumbers`, lines 1712–1746) reads the price and description from the row. A missing price alerts `Set a price first for:` plus the jobs. Standard clients with no real PO ask you to continue with a blank reference. Over-PO jobs ask you to continue; the typed price is kept. For a Xero UID the confirm says the click assigns numbers and creates draft invoices, then `sendToXero` runs with `skipConfirm` and no CSV. For everyone else it downloads the CSV. A transaction error alerts `Numbers NOT assigned: {code}`. The number is `max(5402, meta last number, box max, existing invoice numbers) + 1`, in date order. If a selected job was numbered in the meantime: `already numbered: …`.

**Mark invoiced** (`markInvoiced`, lines 1747–1752) sets `invoiced`, `invoicedAt`, and `invoicedBy`, then opens the Recent tab.

**Remove** sets `invoiceExcluded` so the job is never invoiced or exported (tab caption, line 1642).

Invoice numbers: `nextInvoiceGuess` (lines 1654–1657) is one more than the max of 5402 (`INV_FLOOR`, line 1326), `meta/invoicing.lastNo`, `meta/boxInvoiceMax.max`, and every loaded `invoiceNo`. Assignment is a transaction (`assignNumbers`, line 1712). If those meta docs cannot be read: `Invoicing rules not live: {code}` (line 1667).

Invoice date is the job date. Due date in the CSV is date plus 7 days (`xeroCsv`, line 1577). Contact is `invoiceContact`, or for a client named “private” the tidy address plus `(private)`, otherwise the client (`invContact`, line 1346). A contact that is not one of `STD_CLIENTS` (line 1329) and not a private address gets a warning mark.

Description default: `{Task} - {tidy address}`, and for spoil only ` ({hours} hrs)` (lines 1347–1351). No per-load price is calculated (comment lines 1353–1354).

**Mark invoiced** sets `invoiced` (`markInvoiced`, line 1747).

Monthly totals add 10% for an inc-GST display (`months[m].ex * 110 / 100`, line 1616). That display is not a stored tax invoice. History rows come from `meta/invHistIndex` and `meta/invHist_{year}` (`loadInvHist`, lines 1658–1665). Failure: `Invoice history not loaded`. Those documents are written outside this repo (**GAP** for how they are produced). `meta/invHist_*` is in the retention “never purge meta” pattern (`NEVER_PURGE_META`, `cloud-retention.js` line 44).

## Xero buttons (two UIDs only)

`canXero` hides every Xero label, the profit chart, and Send to Xero from everyone else (`xeroPill` line 1559, `profitChartHtml` line 956, `sendToXero` line 1562). Admins who are not on `XERO_UIDS` still see invoices and a CSV labelled “invoice” rather than “Xero” (`downloadCsv`, line 1583; ready-button text, line 1643).

**Send to Xero** (`sendToXero`, lines 1561–1574) writes `xeroQueue` `{ status: "queued", accountCode: "200", taxType: "OUTPUT", ... }` and sets `jobs.xeroStatus = "queued"`. Confirm text: draft invoices, not approved, not emailed. Jobs without an invoice number and a price are skipped: `Those jobs need an invoice number and a price first.` Already queued or draft: `Already sent to Xero.` Rules denial: `Send to Xero isn't switched on yet: the Firestore rules for Xero haven't been updated. Nothing was sent. Use Download Xero CSV for now.`

The worker named in the comment is `tools/xero_queue.py` (**GAP**). It is described as creating a DRAFT invoice and writing `xeroInvoiceId` / `xeroStatus` back (lines 1555–1558). This repo’s `handleXeroQueue` does **not** do that. It is not imported, and with the default plan it returns `pro-plan-not-enabled` without calling Xero (`cloud/functions/pro/xero-queue.js` lines 11–21). `xero-stub.js` throws `xero-stub: no live Xero client is configured` if something calls it.

**Check Xero** on Completed (`checkXero`, lines 256–266) queues `{ type: "check" }` and sets `xeroCheckPending`. Toast: the box checks every 5 minutes, 6am–8pm. Rules denial: `Check Xero isn't switched on yet (Firestore rules). Nothing was queued.` Result labels (`xcLabel`, lines 244–252): Checking, Invoiced, Draft in Xero, N matches, Xero check failed, Not found in Xero. Dollar amounts inside the tooltip only if `canSeeMoney`.

Emulator rules for `xeroQueue` (`cloud/emulator/firestore.rules` lines 38–45): read and create for Alex or Patrick only; create must be `status == "queued"` and `by` is the caller; no update or delete; a `tenantId` if present must be `heartwood`. Those rules are the emulator model, not a confirmed live deploy.

## Profit chart (Xero UIDs, Home)

`profitChartHtml` (`app/app.js` lines 955–998). Figures are whatever is in `meta/profitHistory.months`. The page does not call Xero. The comment (lines 951–952) says a box script copies Profit and Loss, cash basis, ex GST. That script is **GAP**. Empty doc: `No Xero figures saved yet.` Modes: Profit, or Income vs costs, for 6 or 12 months. The current month is marked as part month.

Provenance: `app/app.js` functions named above; `cloud/functions/pro/xero-queue.js`; `cloud/functions/lib/xero-stub.js`; commit `01f2c5a6f407e123f7f48432f07f1e9445a36007`.
