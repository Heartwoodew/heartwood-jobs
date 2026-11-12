# Photos, gallery, receipts, reimbursements

**Status: LIVE** in the client on `main` `01f2c5a6f407e123f7f48432f07f1e9445a36007`. Cloud Functions that would pull Gmail are **IN REPO, NOT DEPLOYED** and do not read a mailbox. Storage rules are in the repo and `cloud/MIGRATION.md` says they have not been deployed. This audit did not check the live bucket.

## Email photos (the path that always runs)

`emailPhotos` and `emailDialog` (`app/app.js` lines 2114–2167).

1. The person picks images (`accept="image/*"`, multiple). Non-images are dropped.
2. EXIF is read for the camera time and GPS (`readExif`, lines 2047–2076). If a photo has no GPS, the phone asks once per session (`hereNow`, lines 2085–2091). Denial becomes “location unavailable”. This is the only device-GPS use. The route optimiser does not use it.
3. The image is stamped with job number, Brisbane time, coordinates, and address (`stampPhoto`, lines 2096–2113). Three photos totalling at most 20 MB stay full size; otherwise the long edge is 2560 px. A file the browser cannot decode is sent unstamped.
4. A dialog offers the share sheet when `navigator.canShare({ files })` is true. The To address is **not** filled by the share sheet. The instructions say to put `alex@heartwoodew.com` in To (`OFFICE_EMAIL`, line 2039). Subject is `[Job Photos] Job #{n} – {address}` (line 2040).
5. If the browser cannot share files, a `mailto:` opens and the person attaches the photos themselves, then taps **I've sent it**.
6. Over 24 MB the dialog says the message may be too big for one email (line 2143).
7. The page then writes `photosEmailedAt` and adds `photosEmailedCount` (lines 2135–2136). Failure is only `console.warn`. The Gmail icon is `hasPhotos` (line 928): either of those fields. The link searches Gmail as `alex@heartwoodew.com` for `subject:"[Job Photos]" "{job number}"` (lines 926–927). The page does not read the mailbox.

Incident photos use the same dialog with subject `[Incident Photos] {reportNo}` and collection `incidents` (`incidentDetail`, lines 2316–2320). Those files are **not** mirrored to job-photo storage (`emailDialog` only mirrors when `o.coll` is missing or `"jobs"`, line 2133).

## Private cloud copy

After the dialog is built, `mirrorJobPhotos` runs and a failure does not cancel the email (`emailDialog` line 2133; `mirrorJobPhotos` lines 342–361).

Planner: `planJobPhotoMirrors` (`app/features/cloud-storage.js` lines 275–299).

- Tenant comes from `resolveMembership`, not from the page (`cloudMembership`, `app/app.js` lines 333–336).
- Path shape: `tenants/{tenant}/jobs/{jobId}/photos/{photoId}`.
- Types: jpeg, png, webp, gif. Max 15 MB each. Max 10 files in one plan (`JOB_PHOTO_MAX_BYTES`, `JOB_PHOTO_MAX_COUNT`, lines 39–41).
- Metadata purpose `job-photo`. No dollar amounts in metadata (`cloud/MIGRATION.md` line 17).
- `cloudPhotosAt` is written on the job so other open phones list again. Comment (lines 356–357): it is **not** a retention anchor.

`photosEnabled` stays false and is unused by this path. See the scope topic.

The gallery lists that prefix with `listAll` and `getMetadata`, then `getBlob` for thumbnails (`loadJobPhotoListing`, `blobForPhoto`, `app/app.js` lines 372–499). It does not call `getDownloadURL`. Blob URLs stay in the page.

Empty cloud list copy (`cloudEmptyCopy`, `app/features/photo-gallery.js` lines 103–107): emailed photos are a separate history. Example: `No cloud copies on this job yet. The N emailed photos are separate from this gallery.`

A metadata or blob error becomes `Couldn't load photos (storage/…)` or `Couldn't load photos (storage/unknown).` (`photoFailureText`, lines 94–100; `storageErrorCode`, `cloud-storage.js` lines 105–110). A raw server message is not shown. **Try again** calls `ensurePhotoList` with force.

Lightbox (`openPhotoLightbox`, `app/app.js` lines 540–587): arrows, swipe of at least 48 px, Escape. Opening a photo does not change the expiry date (`photoGridHtml` note, `photo-gallery.js` lines 113–115).

**Download cloud copy** is admin-only (`cloudRetentionHtml`, lines 610–614). `buildOperationalExport` (`cloud-retention.js` lines 602+) builds a zip in the browser. Toast: `Downloaded operational copy. Invoices and Xero records are not in the zip.` Operators do not get the button. Refusal: `Only an admin can download the cloud copy.` Over 32 MiB of file bytes the export refuses (`MAX_EXPORT_BYTES`, line 17). `issueExportGrant` wants a 15-minute signed URL and is not what the page calls (`cloud/MIGRATION.md` lines 79–80).

Receipt objects are hidden from the photo list even if they sit on the photo prefix (`listedJobPhoto`, lines 149–157, reason `receipt-hidden`).

## Who can read a cloud photo

Proposed Storage rules (`cloud/production/storage.rules`, same bytes as the emulator file):

- List the folder: `canSeeJob` (line 100).
- Read one object: Alex or Patrick on tenant `heartwood` with **no** Firestore read, or assigned staff via one job `get` (`jobPhotoStaff`, lines 80–85 and 104–105). Comment lines 74–79: production counts two Firestore reads per evaluation. Calling `canSeeJob` on `getBlob` used to deny the read. That is why object read does not call `canSeeJob`.
- Create: `canSeeJob` plus image type, size, and metadata (lines 86–97 and 106).
- Delete of job photos: false (line 107).

`canSeeJob` in the planner (`cloud-storage.js` lines 125–131): same tenant, customer scope if `customerIds` is a non-empty list, then rules-admin **or** uid in `job.assigned`.

A client-typed path is not authority (file header, lines 1–5).

## Receipts

`receiptDialog` (`app/app.js` lines 662–698). Any signed-in person with the job card or the receipt button can upload.

Required: photo, supplier, and either a dollar amount greater than 0 or a tonnes amount greater than 0 (or both). Tip dockets can be uploaded with only a weight. Optional job number (locked when opened from a job). Checkbox **I paid for this myself**, default on. Uncheck for a company-account docket (for example Remondis). A personally paid receipt with no dollar amount is flagged as needing an amount before it can be paid back; a tonnes-only account docket is normal, files to Hubdoc, and is not treated as money owed.

The JPEG is shrunk to a long edge of 1600 px (`shrinkImage`, lines 655–660). Error: `Can't read that image - try a JPEG/PNG photo`. The base64 is split into `receiptChunks/{receiptId}_{i}` of 700000 characters, then `receipts/{id}` is written with `status: "queued"`. Toast: `Receipt uploaded - queued for Hubdoc`.

A cloud mirror is best-effort (`mirrorReceipt`, lines 599–608). Path: `tenants/{tenant}/receipts/{receiptId}/original`. Receipt file cap in the planner: 8 MB, jpeg/png/webp, one file (`RECEIPT_MAX_BYTES`, `cloud-storage.js` lines 38–42).

Who sees amounts: `$$` is blank unless `canSeeMoney`. The recent-receipt list in the dialog still calls `$$`, so an operator sees a blank amount next to the date and supplier. `cloud/MIGRATION.md` lines 17–18: operators may upload and are not allowed to read the file back, because the image shows the amount. Supervisors can read their own receipt file. Alex can read Heartwood receipt files. Storage rule `canReadReceipt` (`storage.rules` lines 129–134) matches that: Alex in the same tenant, or the receipt owner who also `canSeeMoney`.

Job card list (`loadJobReceipts`, lines 701–710): the owner queries by `jobId`; everyone else adds `uid == me.uid`. Status pill Filed or Queued. Error: `Receipts not available yet ({code})`.

The worker that emails Hubdoc and writes `reimbursements` is named `tools/receipts_worker.py` (comment lines 639–641) and is **GAP**.

## Reimbursements (owner only)

`reimbView` (lines 712–726). Anyone else sees `Owner only.`

Hubdoc address is `ownerSettings/hubdoc` field `email`. Save checks `/^[a-z0-9._+-]+@app\.hubdoc\.com$/`. Otherwise: `Hubdoc addresses end in @app.hubdoc.com`. Empty address: receipts stay queued until it is set. The page says mail is sent from `alex@heartwoodew.com`. The sender is the missing worker, not this page.

**Mark paid** is armed (tap twice within 4 seconds, `armBtn` line 1154). It sets `paid` and `reimbursed` on `reimbursements/{id}`.

The amber pill (`reimbPill`, lines 906–924) lists unpaid ledger rows plus personally paid receipts still `queued` and not yet on the ledger (`owedList`, lines 873–877). **Done** writes the ledger (`markReimbursed`, lines 881–888) with a 5-second undo. **CSV** downloads owed rows, including a GST column computed as amount inc / 11 (`reimbCsv`, lines 890–905). It does not mark them paid. iOS uses the share sheet when it can share a file.

Possible duplicates on Home are the same worker, dollar amount (or tonnes when there is no dollar amount), and date (`attentionHtml`). Receipts with no dollar amount are not treated as $0.00 owed.

## Retention (shown, not running)

`SCHEDULING_APPROVED` is `false` (`cloud-retention.js` line 21). `retentionSweepHandler` returns `scheduling-not-approved` unless that constant is true **and** env flags are set (`cloud/functions/lib/retention-run.js` lines 7–20). There is no `onSchedule` export (`cloud/functions/index.js`).

Admin job card text (`retentionAdminText`, lines 197–211) always says deletion is not scheduled, and that invoices and Xero records are not deleted. Home counts copies inside 14 days of expiry or past it (`cloudExpiryNotice`, `app/app.js` lines 615–628) and adds the same sentence, plus “Accounting records are normally kept 5 years.”

Anchor rules are in `retentionAnchor` (lines 110–144) and the table in `cloud/MIGRATION.md` lines 27–33. Missing anchor: not deleted. Diary strings, job `updatedAt`, job `createdAt`, and invoice dates are not anchors (`MIGRATION.md` line 34).

Fields never purged include invoice and `xero*` fields, `poAmount`, `quoteAmount` (`ACCOUNTING_FIELDS`, lines 29–37) and the collections in `NEVER_PURGE_COLLECTIONS` (lines 39–42): `xeroQueue`, `reimbursements`, `timesheets`, `users`, `swmsChunks`, `swmsSignatures`, `incidents`, `incidentCounter`, `ownerSettings`.

`cloud/MIGRATION.md` lines 67–68: a 3-month operational delete does not meet the usual 5-year accounting record. The accounting record is described as Xero, Hubdoc, and existing exports. This pack does not give legal advice beyond that sentence in the migration note.

Provenance: functions and rules cited above, commit `01f2c5a6f407e123f7f48432f07f1e9445a36007`.
