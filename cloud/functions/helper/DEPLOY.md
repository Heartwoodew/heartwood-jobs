# Helper is switched off

Alex Daly asked on 8 Nov 2026 to remove the live in-app helper. `helperAsk` stays deployed. It refuses every request before Auth, Firestore, or Vertex.

`HELPER_ENABLED` defaults to `false` (`cloud/functions/.env` and `cloud/functions/.env.heartwood-9f37f`). `HELPER_HARD_OFF` in `helper/provider.js` is `true`, so setting `HELPER_ENABLED=true` on the function does not call a model and does not confirm a change. Turning it back on takes a deliberate edit of that constant. Do not flip it to publish the helper again.

`cloud/scripts/refuse-live-deploy.js` still refuses `firebase deploy` from `cloud/`. Do not remove that hook to deploy rules, Storage, or the other workers. Do not deploy `cloud/emulator/firestore.rules` or `cloud/emulator/storage.rules`.

The function name, region (`australia-southeast1`), and any existing `helperProposals` or `helperAudit` rows stay. This does not delete data, billing, or other resources.
