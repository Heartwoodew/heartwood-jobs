# Company rollout

Do not deploy `cloud/emulator/firestore.rules`. That file is the emulator model. Publishing it would replace the live jobs, quotes and receipts rules, and job writes in that file are closed on purpose.

Do not run the migration against `heartwood-9f37f`. The script exits unless `FIRESTORE_EMULATOR_HOST` is set, and it exits if the project id is `heartwood-9f37f`.

Stripe is not part of this change. `companies/{id}.billing` is the later hook (`provider: null`, `status: "not-configured"`).

## Dry run (emulator, fake data)

From `cloud/` after `npm install`, with no production credentials:

```
firebase emulators:exec --only firestore --project demo-heartwood "node scripts/migrate-company-id.mjs"
```

That is dry-run. It prints the fields it would add and writes nothing.

Commit against the same emulator only:

```
firebase emulators:exec --only firestore --project demo-heartwood "node scripts/migrate-company-id.mjs --commit"
```

Run it twice. The second run adds nothing.

## Production sequence

Do these in order. Stop if a step is not what you expect. The old webpage stays up until step 4.

1. Back up Firestore. The migration only adds `companyId` and creates `companies/heartwood` if it is missing. It does not delete fields or documents. Confirm the backup before going on.
2. Run the migration for real with a reviewed admin script on a machine that is allowed to write `heartwood-9f37f`, using the same add-only logic as `cloud/scripts/migrate-company-id.mjs`. Do not run this copy while it still refuses the live project. Do this before the new rules and before the new webpage. Heartwood rows with no `companyId` become `heartwood`. A row that already has `companyId` is left alone.
3. Publish the rules that were tested in the emulator. Paste the company helpers and `match /companies/{companyId}` from `cloud/emulator/firestore.rules` (`BEGIN COMPANY RULES`) into the live rules. Paste the updated hours-export, invite, SWMS, leave, reimbursement and timesheet matches from that same file over the live copies of those blocks. Do not upload the emulator file as the whole ruleset. Add the composite indexes in `cloud/firestore.indexes.json` before the new webpage, or the company-scoped job queries will fail.
4. Publish this webpage immediately after the rules. It queries `companyId`. The previous webpage plus the new rules will fail those list queries as soon as a second company exists, so do not leave a gap.
5. Leave Storage rules for a separate review. `cloud/emulator/storage.rules` now scopes hours files and reimbursement and leave files by company, and still refuses a public download. Do not deploy them from `cloud/` (`npm run deploy` still exits 1).

Heartwood's accounts mailbox, spreadsheet subject word "Heartwood", and Hubdoc owner setting stay as they are. A new company uses its own accounts email and Hubdoc address.

## Master page

Only a verified `alex@heartwoodew.com` session can open Master, and only with Alex's uid or the custom claim `platformOwner: true`. Set that claim in the Admin SDK when you want it. Company admins cannot list `companies`.
