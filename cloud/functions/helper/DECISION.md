# Helper model and cost — decision for Alex

This pull request does not deploy, does not enable a model, and does not create a billing account, an API key, or a Vertex quota. `cloud/scripts/refuse-live-deploy.js` still refuses `firebase deploy`.

## What is already in the repo

There is no configured LLM provider. Nothing references Firebase AI Logic, Vertex, Gemini, or an API key for a model. The Firebase web config in `app/firebase-config.js` is the existing client config for project `heartwood-9f37f`. It is not a model credential, and Helper does not add one.

## What this change does

`helperAsk` is a callable Cloud Function in `australia-southeast1`. It checks the Firebase ID token, loads `users/{uid}` with the Admin SDK, and then applies the same membership rules as `resolveMembership` / `canSeeJob` / `canSeeMoney`. The Admin SDK bypasses Firestore rules, so those checks are in the function.

The model call is behind `HELPER_ENABLED`. That variable is unset, so the function treats it as off. A signed-in person with a profile gets a short "switched off" reply. No job text is sent anywhere.

If you later set `HELPER_ENABLED=true`, the provider is Vertex AI Gemini through the function's own service account (Application Default Credentials on Cloud Functions). No API key is read from the client or from this repo. The request stays in `australia-southeast1`. The code refuses any other region, including a silent fallback to `us-central1`. The default model id is `gemini-2.5-flash`. Override it with `HELPER_VERTEX_MODEL` only after you confirm that id is enabled in `australia-southeast1`. There is no tool list on the request. Helper cannot write Firestore, send mail, or call Xero.

## Money

Operators only get jobs assigned to them. Money fields are removed before the prompt is built: PO amounts, invoice fields, quote prices, receipt totals, rate cards, profit, and Xero. Dollar amounts written inside notes are replaced with `[amount hidden]`. The reply is scrubbed again in case the model invents a price.

Supervisors and admins follow `canSeeMoney` (profile role `supervisor` or `admin`, plus Alex and Patrick via the existing bootstrap). They can hear job prices for jobs `canSeeJob` allows.

Company profit (`meta/profitHistory`) and Xero fields follow the narrower Xero gate already in the app: Alex and Patrick only (`membership.finance`). A supervisor does not get the profit chart or Xero match totals.

A client-supplied tenant id, role, or job list is ignored.

## Knowledge pack

How-to answers load `docs/knowledge/callup-knowledge.md` when that file exists. It is not in this branch. A separate docs change (agent `bc-ce9839be`) is writing that pack. Until it lands, Helper loads `cloud/functions/knowledge/callup-knowledge.md` and marks the source `placeholder`. The panel says so. Copy the reviewed pack into the functions folder before a later deploy, or the deployed function will not see a file that lives only under `docs/`.

## Cost

Turning the flag on bills the existing Firebase / Google Cloud project. This repo does not record whether `heartwood-9f37f` is already on the Blaze plan. Vertex AI and Cloud Functions both need billing. This PR does not upgrade the plan and does not enable the Vertex API.

There is no instance kept warm (`minInstances` is not set). A question is one `generateContent` call with a capped prompt (about 16,000 characters of data, plus the short system rules) and at most 700 output tokens.

Do not treat this as a quote. Check Google's current Vertex AI price card for the model you enable in `australia-southeast1` before switching the flag on. Short Flash replies are usually a fraction of a US cent each, but the price card is the source of truth and it changes.

## When you want this live — later, not in this PR

1. Read this note and the knowledge-pack PR. Do not merge until you are happy with the money rules.
2. Confirm the project may call Vertex in `australia-southeast1`, and confirm the model id.
3. Put the reviewed pack at `docs/knowledge/callup-knowledge.md` and copy it to `cloud/functions/knowledge/callup-knowledge.md` if the docs path is outside the functions folder that gets published.
4. Set `HELPER_ENABLED=true` on the function environment only. Do not put a key in git.
5. Deploy `helperAsk` from a branch where the deploy guard has been lifted on purpose. Deploying this branch still exits before anything is published.
6. Do not deploy `cloud/emulator/firestore.rules` from this branch. It is an emulator model, not the live ruleset.

Nothing in that list has been done here.
