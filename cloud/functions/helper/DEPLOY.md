# Deploy Helper — later, and only when you mean to

This branch does not deploy. `cloud/scripts/refuse-live-deploy.js` still refuses `firebase deploy` from `cloud/`. Nothing here enables an API, sets `HELPER_ENABLED`, or publishes a function.

Helper answers for every signed-in staff member when `HELPER_ENABLED=true`. An operator only hears and changes what that role can already do. Supervisors and admins keep their wider set. The model is Vertex Gemini `gemini-3.5-flash` in `australia-southeast1`. `gemini-2.5-flash` retired on Vertex on 20 October 2026. `gemini-3.8-flash` is only on the global, `us`, and `eu` endpoints, so it is not used.

## 1. APIs

In project `heartwood-9f37f`, enable:

- Vertex AI API: `aiplatform.googleapis.com`
- Cloud Functions API: `cloudfunctions.googleapis.com`
- Cloud Build API: `cloudbuild.googleapis.com` (Cloud Functions uses it to build)
- Artifact Registry API: `artifactregistry.googleapis.com`
- Identity and Access Management API: `iam.googleapis.com` (already on for Firebase)

```bash
gcloud services enable \
  aiplatform.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project heartwood-9f37f
```

The Cloud Functions runtime service account needs `roles/aiplatform.user` on that project. Do not put an API key in git or in the phone app. Application Default Credentials on the function are the credential.

```bash
PROJECT_NUMBER=$(gcloud projects describe heartwood-9f37f --format='value(projectNumber)')
gcloud projects add-iam-policy-binding heartwood-9f37f \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

If the function uses a different runtime service account, grant that account instead. Confirm the model id `gemini-3.5-flash` is listed for `australia-southeast1` before the flag goes on. The code refuses any other region, including `us-central1`.

## 2. Environment

Set this on the function only. It is not a client flag.

```bash
HELPER_ENABLED=true
```

Optional, only if you have checked the id in Sydney:

```bash
HELPER_VERTEX_MODEL=gemini-3.5-flash
HELPER_VERTEX_LOCATION=australia-southeast1
```

Leave `HELPER_ENABLED` unset, or set it to anything other than the string `true`, and the function stays up but does not call a model. The phone hides the Helper button unless a status call returns `enabled: true`.

## 3. Function deploy

Deploy only `helperAsk`. Do not deploy Firestore rules, Storage rules, or the other workers from this branch.

The predeploy guard in `cloud/firebase.json` will stop you. Lifting that guard is a separate decision. When you have lifted it on purpose, from `cloud/`:

```bash
firebase deploy --only functions:helperAsk --project heartwood-9f37f
```

The function is `onCall` in `australia-southeast1`, timeout 30 seconds, memory 256MiB. Pass the env at deploy time, for example:

```bash
firebase deploy --only functions:helperAsk --project heartwood-9f37f \
  --set-env-vars HELPER_ENABLED=true,HELPER_VERTEX_LOCATION=australia-southeast1,HELPER_VERTEX_MODEL=gemini-3.5-flash
```

`--set-env-vars` replaces the function's env vars. If the function already has other vars, include them in that list.

Do not deploy `cloud/emulator/firestore.rules` or `cloud/emulator/storage.rules`. Leave rules, if you want them live, are the paste blocks in `cloud/rules-additions-leave.md`.

## 4. Check

Sign in as any staff member. The Helper button appears only after `helperAsk` returns `enabled: true`. An operator can confirm their own timesheet, their own leave, a prestart, or a note on a job assigned to them. A supervisor can also approve leave and invite. An admin keeps the wider set. Confirm writes the change and a row in `helperAudit` (`via: "helper"`). Cancel writes nothing else.
