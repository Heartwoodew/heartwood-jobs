# CallUp landing site (callupapp.com.au)

Static marketing site, separate from the app (app.callupapp.com.au, hosting site `callupapp`).

- Edit `build.py`, then run `python3 build.py` (writes into `public/`).
- Deploy only this site:
  `firebase deploy --only hosting:callup-site --project heartwood-9f37f --config firebase.json`
  (run from this folder). Hosting site: `callup-site` → https://callup-site.web.app
- Custom domains: callupapp.com.au (serves the site), www.callupapp.com.au (redirects to apex).
  DNS is at Crazy Domains: apex A 199.36.158.100 + TXT hosting-site=callup-site; www CNAME callup-site.web.app.
