# Sprint 1 — manager, trades and quote packs

**Status: IN REPO, NOT DEPLOYED.** This describes the source on the Sprint 1 branch. It is not live until the rules, functions and hosting in `cloud/MIGRATION.md` (section “Sprint 1 — manager, trades, job titles”) are published. No production documents are rewritten by this change.

## Permission levels

`INVITE_ROLES` in `app/features/staff-invites.js`: labourer, operator, supervisor, manager, admin.

| Level | Money | Company rates | Leave decide | Invites | Company settings, plan, billing |
| --- | --- | --- | --- | --- | --- |
| labourer, operator | Hidden, except the amount on that person’s own receipt or claim | No | No | No | No |
| supervisor | Yes | No | Yes (unchanged) | Up to supervisor | No |
| manager | Yes | Yes | Yes | Up to manager, never admin | No |
| admin | Yes | Yes | Yes | All, including admin | Yes |

`canSeeMoney` in `app/app.js` is admin, manager or supervisor (including `staffRole`). `canEditQuoteRates` is admin or manager. `companySettingsHtml` stays editable only when `me.role === "admin"`.

A manager uses the staff shell, not the admin desktop. They do not get invoices, Xero, or the company billing card.

Existing profiles keep their current `users.role`. A job title sets the level on a new invite, and `acceptStaffInvite` writes that role. The browser cannot change `users.role` afterwards (company admins and managers may update the job title and skill tags only). People already on the books keep the level they have.

## Trade

Sign-up (`signupFormHtml`) asks for one or more trades: earthworks, landscaping, concreting, fencing, carpentry, tiling, plumbing, electrical. At least one is required. The company stores `trades` (a list). The first one is also written as `trade` so older reads still see a primary. `readTradeList` prefers `trades`, then the old single `trade`, then `["earthworks"]`. Heartwood and `callup-test-h2vx` are not rewritten.

Admins and managers add or remove trades from Company settings. The quotes “other trade” list only shows trades that are not already selected. Quotes open on the first trade and can switch among the selected ones. Job titles and job types are the union. A title that two trades map to different levels uses the lower level unless the primary trade’s level is already that low, and the title says so.

Reimbursement claims (approve, decline, mark paid) are manager and admin only. Supervisors keep the amount on their own claims and do not get the decision buttons.

## Job titles and other trades

Preloaded titles and their levels are `defaultTitles` / `levelForTitleName`. Admins and managers add, rename and remove titles on Staff. The title’s level is the invite’s permission level.

Quotes has “Use another trade”. On the quotes screen that list, and the quote trade switcher, only include a pack once it is ready. Earthworks keeps the plant wizard. Landscaping, concreting and fencing are measured packs (area, volume or linear metres). Carpentry, tiling, plumbing and electrical stay “Quote pack coming soon”. Company settings can still add a coming-soon trade so its job titles and job types are available.

## Skills

`skills` on `users/{uid}` is a short list of free-text tags. The person can edit their own list. Tags do not filter assignment and there is no sign-off flag.

## Quotes

The earthworks pack is data (`QUOTE_PACKS.earthworks`: templates, line types labour / material / compliance / hire / waste, job types spoil, backslab, waterproof, clean, other). The plant wizard maths are unchanged. Landscaping, concreting and fencing each have one data file under `app/features/packs/` with placeholder A$ rates marked as defaults to review.

Extra lines can apply area (m²), volume (m³), linear metre and a waste %. Changing a price on a line, when the person can edit rates, asks “This quote only” or “Save as company default”.

Job categories on a job come from the enabled trades (`jobTypeMap`). The quote wizard only offers types from a ready pack.

## Out of scope

Timesheets stay per person. No stage progress, customer portal, required fields before Done, assignment filtering, mix calculations, Stripe, or Xero. Client companies do not see Heartwood or ServiceM8 in this work.
