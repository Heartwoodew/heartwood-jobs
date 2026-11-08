# Roles and navigation

**Status: LIVE** on `main` `01f2c5a6f407e123f7f48432f07f1e9445a36007`.

Sign-in is email and password (`renderLogin`, `app/app.js` lines 106–117). Failure text: `Sign-in failed: ` plus `e.code` or `e.message` (line 115). Sign-out is the header button (`#logout`, line 68).

## How the shell is chosen

`onAuthStateChanged` (`app/app.js` lines 69–104):

1. Read `users/{uid}`. Failure becomes `prof = null` (line 77).
2. Try to list the whole `users` collection (line 80).
3. If both fail: `No access for {email}. Ask Alex to add you.` (line 81). Stop.
4. If the list **succeeds**, the person is treated as **admin**, even when their profile `role` is `operator` or `supervisor` (lines 83–88). The profile role is kept as `me.staffRole`. Comment on lines 74–76: admin means “allowed to list users”; Patrick is described as rules-admin with an operator profile, so he stays bookable. The list of UIDs that the **live** rules allow to list `users` is **GAP** (live rules are not in the repo). The in-repo emulator model allows Alex’s UID, Patrick’s UID, or `users.role == "admin"` (`isAppAdmin`, `cloud/emulator/firestore.rules` lines 21–23). A third “sync” UID is named in the comment on line 74 and is not in the file. Do not invent it.
5. If the list **fails** and a profile exists, `me.role` is the profile role (line 83). The page then uses the operator shell (`renderOperator`).

Alex’s UID `1JKLsoxkQNfkphBBO0vDz2ziEyj2` has no profile document. The code still shows the name “Alex” when the users list succeeds (lines 64 and 83). The same UID is `OWNER_UID` (line 642).

### Three names people use

| Word on the page | What the code checks | Shell |
| --- | --- | --- |
| Admin | `me.role === "admin"` after a successful `users` list | Desktop/admin `shell` (`renderAdmin`, line 1039) |
| Supervisor | Profile `role` (or `staffRole`) is `supervisor`, **or** the person is already an admin | Operator shell if they cannot list users. Admin shell if they can. |
| Operator | Profile `role` is `operator` and they cannot list users | Operator shell |

`canSeeMoney` (`app/app.js` line 650) is true when `me.role` is `admin` or `supervisor`, or `me.staffRole` is `supervisor`. `$$` returns `""` unless that is true (line 1388). Operators do not see dollar amounts in the UI.

`canQuote` is `canSeeMoney` (line 652). `canEditQuoteRates` is `me.role === "admin"` only (line 654).

`canXero` (`lines 646–647`) is **not** the admin role. It is true only for these UIDs:

- `1JKLsoxkQNfkphBBO0vDz2ziEyj2` (Alex, also `OWNER_UID`)
- `R7t41e54Ykcdk9WPdVZnDd697iI2` (Patrick)

Comment on lines 644–645: future staff, including future admins, see no Xero unless they are added here **and** in `firestore.rules` `xeroUser()`. That live function is **GAP**. The emulator model uses the same two UIDs as `isHeartwoodFinance` (`cloud/emulator/firestore.rules` lines 15–17).

`isOwner` (line 643) is Alex’s UID only. Inbox, the reimbursement screen, the Hubdoc address, and the “to reimburse” pill use `isOwner`, not the admin role.

## Admin menu

`shell` (`app/app.js` lines 147–169). A nav entry is omitted when:

- the 4th tuple slot is truthy (`x[3]`) — **Reports** and **Settings** (`NAV` line 148). They have no view function. `renderAdmin` (line 1053) does not mention them. If `ui.view` were one of those strings it would fall through to `jobsView`. They are not a screen.
- the 5th slot is truthy and the person is not the owner — **Inbox** and **Reimbursements**.
- the key is `invoices` and `me.role !== "admin"`.
- the key is `quotes` and `canQuote()` is false.
- the key is `compliance` and `COMP.canSee()` is false.

Top row (`NAV_TOP`, line 154): Home, Chat, Inbox, Clients.

Groups (`NAV_GROUPS`, line 155). Open or closed state is `localStorage` key `hwNavCol` (line 157). The group that contains the current screen stays open (line 163).

| Group | Items | Label override |
| --- | --- | --- |
| Jobs | Dispatch Board, Jobs, Unscheduled, Quotes, Completed, My jobs | |
| Money | Invoices, Reimbursements, Timesheet | |
| Safety | Safety, SWMS, Compliance | Safety’s menu label is **Incidents** (`NAV_LBL`, line 156) |

**My jobs** sets `ui.myJobs` and calls `renderOperator` (lines 1065 and 1043). The operator shell shows **Admin view** (`adminBack`, line 1797) to come back.

Phone width is `max-width: 760px` (`PHONE`, line 150). On a phone the admin dispatch board is `mobileDispatch` (line 290). Other admin screens stay in the side-menu shell. A coarse pointer that is not a phone uses press-and-hold (500 ms) to move a dispatch chip (`renderAdmin`, lines 1107–1115).

Header search (`gsearch`, lines 2661–2684) is shown whenever someone is signed in. Admins search every loaded job. Staff search jobs assigned to them.

## Operator and supervisor menu

`renderOperator` (`app/app.js` lines 1862–1956). Bottom tabs (`opTabs`, lines 1792–1796):

| Tab | Screen |
| --- | --- |
| Today | Today’s jobs, run-sheet order if one is approved, SWMS reminder, fleet banner |
| Jobs | Upcoming through 7 days ahead (`wkEnd`, line 1866) |
| Chat | Team chat |
| Photos | Jobs plus “Add photos” |
| More | Hours, Completed (last 30 days), SWMS, Compliance (if `COMP.canSee()`), Report incident, Quotes (only if `canQuote()` and `me.role !== "admin"`) |

A supervisor who is **not** an admin sees Quotes under More (line 1895). They do not get the admin rate editor (`canEditQuoteRates` is false). They do not get Invoices, Inbox, Xero, or the reimbursement ledger.

Job detail (`renderOpDetail`, lines 1957–2008) has two tabs: Job and Chat. Actions: Start job, Complete job, Add note, Add photos, Get directions, receipts, SWMS, incident.

## What each role can open

| Screen | Admin shell | Supervisor on operator shell | Operator |
| --- | --- | --- | --- |
| Home today / tomorrow | Yes | Today tab | Today tab |
| Dispatch | Yes | No | No |
| Jobs list (all staff) | Yes, date window | Own assigned jobs only | Own assigned jobs only |
| Unscheduled (all) | Yes | No | No |
| Quotes | Yes if `canSeeMoney` | Yes, More | No |
| Edit quote rates | Yes | No | No |
| Completed (office) | Yes | Own jobs, last 30 days, More | Same |
| Optimise order | Button on dispatch | No (`canApprove` is admin) | Sees an approved order on Today |
| Invoices / Send to Xero | Admin screen; Xero buttons only if `canXero` | No | No |
| Timesheet | Owner sees everyone’s week; other admins use the owner check, which is Alex’s UID only | Own week | Own week |
| Reimbursements | Owner only | “Owner only.” | “Owner only.” |
| Chat | Yes | Yes | Yes |
| Photos / receipts upload | Yes | Yes | Yes. Operators are not meant to read a receipt image back; see photos topic. |
| Safety incidents | All incidents | Own reports | Own reports |
| SWMS sign | Yes | Yes | Yes |
| SWMS team register and signed PDF | Admin | No | No |
| Compliance edit | Admin, and only if the plan includes fleet | Read-only fleet if the plan includes it | Same |
| Policies | Admin only | Hidden | Hidden |
| Inbox | Owner only | “Owner only.” | “Owner only.” |
| Clients | Read; admin can edit | Read | Read |
| Settings, Reports | Hidden. No screen. | No | No |

Job queries: admins listen to jobs with `date` from 14 days ago through 28 days ahead, plus a separate read of `date == ""`, plus every `status == "Done"` (`onAuthStateChanged`, lines 90–96). Operators listen to `assigned array-contains uid` (lines 98–100). Anything outside those queries is not on screen even if a rule would allow the read.

Provenance: `app/app.js` functions named above, commit `01f2c5a6f407e123f7f48432f07f1e9445a36007`.
