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

Sign-up (`signupFormHtml`) asks for a main trade: earthworks, landscaping, concreting, fencing, carpentry, tiling, plumbing, electrical. It is stored on `companies/{id}.trade` and the starting catalogue is `companyTrades/{id}`.

`resolveCompanySetup` in `app/features/trades.js` reads a missing trade as earthworks. That covers Heartwood and `callup-test-h2vx` without a write.

## Job titles and other trades

Preloaded titles and their levels are `defaultTitles` / `levelForTitleName`. Admins and managers add, rename and remove titles on Staff. The title’s level is the invite’s permission level.

Quotes has “Use another trade”. That adds the other trade’s titles and job types beside the main trade. Only earthworks has `quotePack().ready === true` (the existing plant wizard and extras). Every other trade is marked “Quote pack coming soon”.

## Skills

`skills` on `users/{uid}` is a short list of free-text tags. The person can edit their own list. Tags do not filter assignment and there is no sign-off flag.

## Quotes

The earthworks pack is data (`QUOTE_PACKS.earthworks`: templates, line types labour / material / compliance / hire / waste, job types spoil, backslab, waterproof, clean, other). The wizard maths are unchanged.

Extra lines can apply area (m²), volume (m³), linear metre and a waste %. Changing a price on a line, when the person can edit rates, asks “This quote only” or “Save as company default”.

Job categories on a job come from the enabled trades (`jobTypeMap`). The quote wizard only offers types from a ready pack.

## Out of scope

Timesheets stay per person. No stage progress, customer portal, required fields before Done, assignment filtering, mix calculations, Stripe, or Xero. Client companies do not see Heartwood or ServiceM8 in this work.
