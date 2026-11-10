# CallUp trial dry run (checklist)

Emulator: `cd cloud && npm test && npm run test:emulator` covers self sign-up, company scoping, invites,
incidents, clients, SWMS, receipts, Find PO, quote rates/supervisors (companyMeta) and timesheets per company.

Live (test addresses only, `callup932+...@gmail.com`):
1. Open https://callupapp.web.app/app/ (or https://app.callupapp.com.au/app/ once connected). Sign-in shows CallUp, no Heartwood.
2. Self sign-up: owner `callup932+test@gmail.com`, company "CallUp TEST". Random password kept in a 600 box file.
3. Platform owner (Master) marks the company isTest (never billed).
4. Staff → invite `callup932+staff@gmail.com` (operator). Email arrives from CallUp <noreply@callupapp.com.au>,
   reply-to the company email; link opens the CallUp address.
5. Add a test job and a quote. Settings → Quote rates starts empty; save rates.
6. Check: no Heartwood jobs, clients, quotes, staff, logo or text; no Find PO or builder inbox; reimbursements text generic.
7. Clean up: Master → archive/delete the TEST company; delete the test job, quote, invite and staff login.
