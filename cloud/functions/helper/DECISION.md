# Helper model and cost — decision for Alex

This pull request does not deploy, does not enable a model, and does not create a billing account, an API key, or a Vertex quota. `cloud/scripts/refuse-live-deploy.js` still refuses `firebase deploy`.

As of 8 Nov 2026 the live helper is hard-off. `helperAsk` refuses every request before Vertex. `HELPER_ENABLED` defaults to `false`, and `HELPER_HARD_OFF` ignores a `true` environment value. See `DEPLOY.md`.

## What is already in the repo

There is no configured LLM provider. Nothing references Firebase AI Logic, Vertex, Gemini, or an API key for a model. The Firebase web config in `app/firebase-config.js` is the existing client config for project `heartwood-9f37f`. It is not a model credential, and Helper does not add one.

## What this change does

`helperAsk` is still a callable Cloud Function in `australia-southeast1`. The live handler returns `failed-precondition` ("Helper is switched off.") before it checks a token, loads `users/{uid}`, writes a proposal, or calls Vertex. `HELPER_HARD_OFF` is what enforces that. `HELPER_ENABLED=true` does not get past it.

The library underneath still describes the old membership checks (`resolveMembership` / `canSeeJob` / `canSeeMoney`). The callable does not reach them. The phone no longer has a Helper button, chat panel, or speech input.

## Money

Operators only get jobs assigned to them. Money fields are removed before the prompt is built: PO amounts, invoice fields, quote prices, receipt totals, rate cards, profit, and Xero. Dollar amounts written inside notes are replaced with `[amount hidden]`. The reply is scrubbed again in case the model invents a price.

Supervisors and admins follow `canSeeMoney` (profile role `supervisor` or `admin`, plus Alex and Patrick via the existing bootstrap). They can hear job prices for jobs `canSeeJob` allows.

Company profit (`meta/profitHistory`) and Xero fields follow the narrower Xero gate already in the app: Alex and Patrick only (`membership.finance`). A supervisor does not get the profit chart or Xero match totals.

A client-supplied tenant id, role, or job list is ignored.

## Actions

Confirm is the only step that changes CallUp. The preview is stored in `helperProposals` and the result is logged in `helperAudit` (who, what, when, `via: "helper"`). Both collections are written by the Admin SDK. This branch does not change Firestore rules, so a signed-in phone cannot write those collections itself.

Allowed, and only when that person could already do it:

- Add a note on a job they can see.
- Update their own timesheet day (start, finish, optional note). It does not mark the sheet sent and it does not email accounts.
- Post a plain text message in team chat, or in the chat for a job they can see. No photos.
- Start or complete a job when their role already can. Cancelling a job stays with an admin.
- Create a job draft or a quote draft when `canSeeMoney` is true (supervisor or admin). The draft has no price.

Not built, because this branch has no such screen: a machine prestart, and a reminder or to-do. A separate change would have to add those to the app first.

Still refused: email, SMS, deletes, money, payments, Xero, role or invite changes, Storage, and `SCHEDULING_APPROVED`.

## Knowledge pack

How-to answers load `docs/knowledge/callup-knowledge.md` when that file exists. It is not in this branch. A separate docs change (agent `bc-ce9839be`) is writing that pack. Until it lands, Helper loads `cloud/functions/knowledge/callup-knowledge.md` and marks the source `placeholder`. The panel says so. Copy the reviewed pack into the functions folder before a later deploy, or the deployed function will not see a file that lives only under `docs/`.

## Cost

Turning the flag on bills the existing Firebase / Google Cloud project. This repo does not record whether `heartwood-9f37f` is already on the Blaze plan. Vertex AI and Cloud Functions both need billing. This PR does not upgrade the plan and does not enable the Vertex API.

There is no instance kept warm (`minInstances` is not set). A question is one `generateContent` call with a capped prompt (about 16,000 characters of data, plus the short system rules) and at most 700 output tokens.

Do not treat this as a quote. Check Google's current Vertex AI price card for the model you enable in `australia-southeast1` before switching the flag on. Short Flash replies are usually a fraction of a US cent each, but the price card is the source of truth and it changes.

## Live state

Do not enable Vertex or set `HELPER_ENABLED=true` to bring Helper back. That environment value is ignored while `HELPER_HARD_OFF` stays true. `DEPLOY.md` is the current instruction. Do not deploy the emulator rules files.
