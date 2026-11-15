# Safety incidents and SWMS

**Status: LIVE** in the client on `main` `01f2c5a6f407e123f7f48432f07f1e9445a36007`. Official SWMS PDF bytes are **not** in the git tree. If `swmsChunks` has no file, the page builds a placeholder that says it is not a SWMS.

## Incidents

Comment (`app/app.js` lines 2232–2234): records shaped like ISO 45001, sequential number from `incidentCounter/main`, reporter cannot edit after submit, no deletes in the UI.

Types (`INC_TYPES`, line 2235): Incident, Near miss, Hazard, Injury, Property damage.

**Report incident** is on Home (operator), More, the admin Safety screen, and a job. `incidentForm` (lines 2257–2289) asks type, date/time (`datetime-local`), optional job number, location, people, what happened, immediate action. Injury type also requires injury details. Submit runs a transaction: read `incidentCounter/main`, increment `n`, write `incidents/INC-0001` (4-digit pad, `incPad` line 2236) with `status: "Open"` and history `Reported`. Toast `{no} saved`. Failure: `Not saved: {code}`.

Admins listen to the whole `incidents` collection. Other people listen to `reportedBy == uid` (lines 94 and 101). A rules error is `console.warn` only (`incidents`, `e.code`).

**Safety** menu label for admins is **Incidents** (`NAV_LBL`). `safetyView` (lines 2343–2359) filters Open / Closed / All and by type. The header button **SWMS** switches to the SWMS screen. Row click opens the detail.

`incidentDetail` (lines 2295–2342):

- Everyone can email incident photos (see the photos topic). They are not a cloud job gallery.
- Admins, while Open, edit root cause, add corrective actions (text, owner from the staff list, due date), tick done, **Save**, and **Close report**.
- Close requires a root cause: `Add the root cause before closing`. If any action is not done, confirm `Some corrective actions aren't done. Close anyway?`
- Closed reports show who closed them. The reporter has no edit controls (`if (!(adm && open)) return`, line 2321).
- History is an append-only list on the document.

Operators see **My safety reports** on Today’s More page and under the operator home body (`myIncidentsHtml`, lines 2360–2365).

Home **Needs attention** counts incidents whose status is not Closed (admin only, `attentionHtml` line 1005).

Retention does not purge `incidents` or `incidentCounter`.

The live security rules for incidents are **GAP** (not in this repo). The emulator model has no `incidents` match.

## SWMS list

SWMS are **Heartwood-only for now**. `companySwms` in `app/features/swms-sign.js` uses `isHeartwoodCompany` from `app/features/company.js`. Company id `heartwood`, and a missing company id (legacy Heartwood records), get the five documents below. Other companies start with none, including a new sign-up and a test company.

An empty list means no SWMS reminder on admin Home or operator Today, no Sign SWMS prompt, and no due or overdue counts. A job hides **View SWMS**. The SWMS screen says `No SWMS set up for your company yet.` It does not list Heartwood titles and it does not build a placeholder PDF. Incidents keep working unchanged.

`app/features/swms-sign.js` `SWMS`, version `2026-07` (`SWMS_VERSION`):

| Id | Title |
| --- | --- |
| `working-near-roads` | Working near roads |
| `mobile-plant` | Mobile plant |
| `working-with-silica` | Working with silica |
| `hazardous-substances` | Hazardous substances |
| `electrical` | Electrical & underground services |

The one-line blurbs in that array are labels, not the SWMS text. `placeholderLines` (lines 70–81) says the official PDF is not in the repository and not to send the placeholder to a client.

## Sign

Entry points: SWMS screen, the reminder banner, a job’s **View SWMS**, operator More.

`signSwms` (`app/app.js` lines 2447–2513):

1. **Open** the PDF (`swmsBytes`, lines 2525–2536). Chunks live in `swmsChunks` where `file == id`, ordered by `k`, joined base64. The bytes must start with `%PDF-`. Otherwise `buildPlaceholderPdf` runs and the screen says `The official PDF is not in the app. The page above is a placeholder, not the SWMS text.`
2. Tick “I have read and understood this SWMS and will follow it.”
3. Optional job. The list is jobs assigned to you, not cancelled, dated from 7 days ago through 14 days ahead, plus the job you opened from (lines 2449–2451).
4. Draw a signature. Printed name defaults to `me.name`. For Alex’s UID, if the display name is `Alex`, the field defaults to `Alex Daly` (line 2460).
5. **Sign SWMS** stays disabled until the PDF was opened, the box is ticked, the ink length is more than 8 pointer samples, and the name is at least 2 characters (line 2471).
6. The PNG must be at most 90000 characters or the error is `Signature too large, please clear and sign again.` (line 2504).

The write is `swmsSignatures` via `swmsSignatureData` (`swms-sign.js` lines 52–66): uid, name, swms id and title, version `2026-07`, optional job id and label, signature, `signedAtMs`, `expiresAtMs` 12 calendar months later (`addMonths`), device user agent. The page also sends `signedAt: serverTimestamp()` (line 2506).

Rules paste (`cloud/emulator/firestore.rules` lines 327–331, and `cloud/production/firestore.swms.rules`): read your own signatures, or an admin (Alex, Patrick, or profile role admin) reads all. Create only, with the field checks including signature size and expiry between 364 and 367 days. Update and delete are false. Publishing that paste is **GAP**.

Toast: `Signed {title} · valid to {date}`. Save failure: `Could not save: {code}`.

## Validity and reminders

`statusOf` (`swms-sign.js` lines 42–50):

| State | When | Label in the module |
| --- | --- | --- |
| none | no signature | Not signed |
| old | `version` is not `2026-07` | New version – re-sign |
| exp | expiry is now or past | Expired |
| due | expiry is inside 30 days (`SWMS_DUE_DAYS`) | Due soon |
| ok | otherwise | Signed |

The page rewrites ok / due / exp labels with Brisbane dates (`swmsStatus`, `app/app.js` lines 2372–2378).

`swmsReminderHtml` shows when the company's list is non-empty and any document is not `ok`. Today that list is Heartwood's five. Other companies get no reminder. It is on admin Home and on the operator Today screen.

Everyone subscribes to their own signatures. Admins also subscribe to the whole collection (`swmsSub`, lines 2389–2395). A listen error is `console.warn` only.

## Admin register and PDF

`swmsAdminHtml` (lines 2415–2436) is under the SWMS screen for `me.role === "admin"`: per person, five columns, overdue count, due-soon count, and every signature including replaced ones.

**View signature** shows the stored PNG (`sigDetail`, lines 2437–2445). It includes the uid.

**Download signed PDF** (`downloadSigned`, `buildSignedSwmsPdf`) copies the SWMS pages (or the placeholder) and adds a sign-off sheet. For Heartwood that sheet is Heartwood Earthworx Pty Ltd, ABN `31 667 738 098`. Another company is not offered the download, because its list is empty. If a sheet is still built, `swmsSignoffOrg` prints that company's own legal name and ABN and does not print Heartwood's name or ABN. Current valid signers are status ok or due (`validSigners`). Filter by job or one signer. Empty set: `No current valid signatures`. Placeholder downloads say not to send the file to a client as the SWMS (`deliverPdf`). Share / Download / Open uses a blob URL.

If pop-ups are blocked when opening a SWMS in a new tab: `Pop-up blocked. Allow pop-ups to read the SWMS, then sign.` (`openSwms`, line 2540). `PDF library failed to load` comes from `loadPdfLib` (line 2556).

Provenance: `app/app.js` incident and SWMS functions; `app/features/swms-sign.js`; `cloud/production/firestore.swms.rules`; commit `01f2c5a6f407e123f7f48432f07f1e9445a36007`.
