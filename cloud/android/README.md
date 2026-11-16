# CallUp Android app (Trusted Web Activity)

The Google Play app `com.callupapp.app` is a Trusted Web Activity that opens
https://app.callupapp.com.au/app/. Android only shows it full screen (no browser bar)
when the site proves it owns the app through Digital Asset Links.

`assetlinks.json` here is copied by `tools/build-callup-hosting.sh` to
`cloud/hosting-dist/.well-known/assetlinks.json`, so the callupapp Firebase Hosting site
(callupapp.web.app, callupapp.firebaseapp.com, app.callupapp.com.au) serves it at
`/.well-known/assetlinks.json` as `application/json`. `cloud/firebase.hosting.json` sets
`"appAssociation": "NONE"` so Firebase stops serving its auto-generated empty `[]` file.
GitHub Pages (jobs.heartwoodew.com) is not affected.

## Fingerprints

- Upload key (alias `callup`, kept on the build box, never in git):
  `4C:39:7A:2B:8C:D3:E3:F2:26:20:06:2C:0B:61:9A:55:77:1A:FA:F5:BB:2A:B3:31:E8:A5:39:8C:46:D7:BD:BA`
- **TODO: Play App Signing key.** Once the app exists in Play Console, copy the SHA-256 from
  Play Console > Test and release > App integrity > App signing key certificate and add it as a
  second entry in `sha256_cert_fingerprints`, then redeploy hosting. Apps installed from Play are
  signed with that key, so without it the Play build shows a browser URL bar.

Check after deploy:
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app.callupapp.com.au&relation=delegate_permission/common.handle_all_urls
