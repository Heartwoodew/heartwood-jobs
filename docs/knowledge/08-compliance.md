# Compliance (fleet, COI, policies)

**Status: LIVE** in the client on `main` `01f2c5a6f407e123f7f48432f07f1e9445a36007` for the Heartwood tenant only. Servicing and prestart are **not** on main. They are open PR #13.

Menu: admin **Safety** group, item **Compliance**, after Incidents and SWMS were grouped (`NAV_GROUPS`, `app/app.js` line 155). That placement is the merge of PR #12.

## Who sees it

`featuresFor` (`app/features/compliance.js` lines 45–48): if membership is ok and `tenantId === "heartwood"`, the plan is Pro (`fleet: true`, `policies: true`). Every other tenant gets Base (`fleet: false`, `policies: false`).

`CALLUP_BASE.features` in `cloud-storage.js` (lines 31–34) stays off. Heartwood is switched on only in `compliance.js`. `resolveMembership` still returns `plan: "base"` (line 78). The compliance screen does not read that field. It calls `complianceFor` → `featuresFor`.

| Person | Fleet register and COI | Policies |
| --- | --- | --- |
| Heartwood admin (`me.role === "admin"`) | Read and edit | Read and edit |
| Heartwood supervisor or operator | Read-only, More → Compliance | Hidden (`canViewPolicies` requires role admin, lines 61–63) |
| Any other tenant | Nav hidden. If the HTML is shown: `Compliance is a CallUp Pro feature.` (line 415) | Hidden |

`canEditCompliance` (lines 58–59) requires the fleet feature and role `admin`. Others who hit a save get `Only an admin can change this.` (line 442).

Staff banner on Today and the admin Home banner use `bannerHtml` (line 251). Due window is 30 days (`DUE_DAYS`, line 12).

## What is stored

No paper photos. The module comment (lines 7–8) says Storage has no fleet or policy path and this build does not add one. Real plates are not seeded (line 8).

Collections, under the caller’s tenant (`installCompliance` `start`, lines 358–387):

- `tenants/{tenantId}/fleet/{assetId}`
- `tenants/{tenantId}/policies/{policyId}` — subscribed only for admins

Asset types (`ASSET_TYPES`, lines 14–18): vehicle, trailer, plant / machine.

Asset fields allowed by the rules paste (`fleetAssetOk`, `cloud/emulator/firestore.rules` lines 224–238): `type`, `name` (1–80), `rego` (≤ 20), `regoExpiry` (`YYYY-MM-DD` or empty), `coiRequired` bool, `coiExpiry`, `notes` (≤ 2000), `updatedAt` must be request time, `updatedBy` must be the caller.

Policy types (`POLICY_TYPES`, lines 20–26): WorkCover (QLD), public liability, vehicle insurance, plant insurance, contract works. Vehicle and plant policies can store an `assetId` (`LINKED_POLICY_TYPES`, line 28).

Policy fields (`fleetPolicyOk`, rules lines 240–258): type, insurer (1–120), policy number (≤ 60), start, expiry, `amount` as a **string** (≤ 40), notes, assetId, updatedAt, updatedBy.

Rules paste (`cloud/production/firestore.fleet.rules` and the emulator block lines 261–271):

- Fleet: any member of that tenant may read. Admin of that tenant may create, update, delete.
- Policies: admin read and write only.

COI is the Queensland certificate of inspection for heavy vehicles and trailers. The file comment (lines 2–4) says COI is not insurance. Insurance is the policy types.

`classifyDate` (lines 83–89): a blank or invalid date is state `expired` with the field label `No date`. A date before today is `Expired`. A date within 30 days is `Due within 30 days`. Later dates are `OK until {date}`. `assetStatus` (lines 101–109) takes the worse of rego and, when `coiRequired` is true, COI. The overall label for that worse state is Expired, Due within 30 days, or OK (`OVERALL`, line 42). The banner counts those.

Save failure: `Not saved: {code}`. Delete: `Not removed: {code}`. Listen failure is stored and shown on the banner (`fleetError`, lines 369–372).

Publishing the fleet rules paste is **GAP**. Until it is in the live rules, the listener fails and the banner shows the Firestore error code. This audit did not read production.

Provenance: `app/features/compliance.js`; `app/app.js` nav and `COMP` wiring (lines 2687–2692); `cloud/production/firestore.fleet.rules`; commit `01f2c5a6f407e123f7f48432f07f1e9445a36007`.
