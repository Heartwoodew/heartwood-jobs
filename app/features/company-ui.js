// Screens for company signup, company details, and the platform-owner Master page.
// Master rows are account-level only. This file does not read jobs, photos, or money.

import { POWERED_BY, PRODUCT_NAME } from "../org-settings.js";
import { derivedJobPrefix, filterMaster, friendInviteLink, masterTotals } from "./company.js";
import { LOGO_ACCEPT, acceptLogoValue, isLogoStoragePath } from "./company-logo.js";

const jobPrefixHint = org => derivedJobPrefix(org && org.name);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function when(ms) {
  if (!ms) return "—";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Brisbane",
  }).format(new Date(ms));
}


export function logoFieldHtml(org = {}, { canEdit = false, signup = false } = {}) {
  const lock = canEdit || signup ? "" : " disabled";
  const current = acceptLogoValue((org && org.logoUrl) || "", org && org.companyId);
  const preview = !current ? "" : isLogoStoragePath(current, org && org.companyId)
    ? `<img class="orglogo-preview" data-logo-path="${esc(current)}" alt="Company logo">`
    : `<img class="orglogo-preview" src="${esc(current)}" alt="Company logo">`;
  const remove = (canEdit || signup) && current ? `<button type="button" class="sm-btn" id="logoremove">Remove logo</button>` : "";
  return `<div class="logofield">
    <span>Logo</span>
    <span class="sub">Optional. JPEG or PNG from your photos or files. We'll resize it. Leave empty to keep the name as text.</span>
    <div class="logopreview"${preview ? "" : " hidden"}>${preview}</div>
    <input type="file" name="logoFile" accept="${LOGO_ACCEPT}"${lock}>
    ${remove}
    <input type="hidden" name="logoUrl" value="${esc(current)}">
  </div>`;
}

export function signupFormHtml({ friend = false } = {}) {
  return `<form id="signup" class="card login signup">
    <div class="login-brand"><div class="wordmark" aria-label="${esc(PRODUCT_NAME)}">Call<span>Up</span></div>
      <p class="orgline">${friend ? "Friend trial" : "New company"}</p></div>
    <h2>${friend ? "Start your friend trial" : "Create your company"}</h2>
    <p class="sub">${friend
      ? "You become the admin of your own company. Your emails work as usual. This friend trial is not billed."
      : "You become the admin. Staff join only this company, from an invite. A 14-day trial starts today. Payments are not taken on this screen."}</p>
    <h3>Your login</h3>
    <label>Your name<input name="ownerName" required maxlength="80" autocomplete="name"></label>
    <label>Email<input name="ownerEmail" type="email" required maxlength="120" autocomplete="username"></label>
    <label>Password<input name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label>
    <h3>Company</h3>
    <label>Company name<input name="name" required maxlength="80"></label>
    <label>Legal name<input name="legalName" required maxlength="120"></label>
    <label>ABN<input name="abn" required maxlength="20" inputmode="numeric" placeholder="00 000 000 000"></label>
    <label>Address<input name="address" required maxlength="160"></label>
    <label>Phone<input name="phone" maxlength="40" inputmode="tel"></label>
    <label>Email<input name="email" type="email" required maxlength="120"></label>
    <label>Accounts email<span class="sub">Hours spreadsheets are sent here.</span><input name="accountsEmail" type="email" required maxlength="120"></label>
    <label>Hubdoc address<span class="sub">Optional. Must end in @app.hubdoc.com.</span><input name="hubdocAddress" maxlength="120" placeholder="name@app.hubdoc.com"></label>
    ${logoFieldHtml({}, { signup: true })}
    <button class="big primary" type="submit">Create company</button>
    <button class="big ghost" type="button" id="signupback">Back to sign in</button>
    <p id="signuperr" class="err"></p>
    <p class="powered">${esc(POWERED_BY)}</p>
  </form>`;
}

export function companySettingsHtml(org, { canEdit = false } = {}) {
  const lock = canEdit ? "" : " disabled";
  return `<div class="sm-head"><h1>Company</h1></div>
    <p class="sub">These details replace the company name on the header, hours spreadsheet, quotes, SWMS, PDFs and emails for everyone in this company.</p>
    <form id="orgform" class="card jf">
      <label>Company name<input name="name" required maxlength="80" value="${esc(org.name)}"${lock}></label>
      <label>Legal name<input name="legalName" required maxlength="120" value="${esc(org.legalName)}"${lock}></label>
      <label>ABN<input name="abn" required maxlength="20" value="${esc(org.abn)}"${lock}></label>
      <label>Address<input name="address" required maxlength="160" value="${esc(org.address || "")}"${lock}></label>
      <label>Phone<input name="phone" maxlength="40" value="${esc(org.phone || "")}"${lock}></label>
      <label>Email<input name="email" type="email" required maxlength="120" value="${esc(org.email || "")}"${lock}></label>
      <label>Accounts email<span class="sub">Hours spreadsheets go here.</span><input name="accountsEmail" type="email" required maxlength="120" value="${esc(org.accountsEmail || "")}"${lock}></label>
      <label>Hubdoc address<span class="sub">${org.companyId === "heartwood" ? "Optional. Heartwood receipts still use the address on the Receipts page." : "Optional. Staff receipts and paid reimbursement claims are emailed here. Leave blank and nothing is sent to Hubdoc."}</span><input name="hubdocAddress" maxlength="120" value="${esc(org.hubdocAddress || "")}" placeholder="name@app.hubdoc.com"${lock}></label>
      ${org.companyId === "heartwood" ? "" : `<label>Accounts contact name<span class="sub">Optional. Timesheet emails start "Hi" and this name.</span><input name="accountsName" maxlength="80" value="${esc(org.accountsName || "")}"${lock}></label>`}
      <label>Email sign-off<input name="signoff" required maxlength="80" value="${esc(org.signoff)}"${lock}></label>
      ${org.companyId === "heartwood" ? "" : `<label>Job number prefix<span class="sub">Optional, up to 5 letters or numbers. Blank uses ${esc(jobPrefixHint(org))}.</span><input name="jobPrefix" maxlength="5" value="${esc(org.jobPrefix || "")}" placeholder="${esc(jobPrefixHint(org))}" autocapitalize="characters"${lock}></label>`}
      ${logoFieldHtml(org, { canEdit })}
      ${canEdit ? `<div class="btns"><button type="submit" class="primary">Save company details</button></div>` : `<p class="sub">Only a company admin can change these.</p>`}
      <p class="powered">${esc(POWERED_BY)}</p>
    </form>
    ${billingCard(org, canEdit)}`;
}

function billingCard(org, canEdit) {
  if (!canEdit || !org || org.companyId === "heartwood" || org.isTest || org.plan === "friend") return "";
  const status = (org.billing && org.billing.status) || "not-configured";
  const subscribed = !!(org.billing && org.billing.stripeCustomerId);
  const label = status === "active" ? "Active" : status === "past_due" ? "Past due" : status === "canceled" ? "Canceled" : "Not set up";
  return `<div class="card" id="billingcard">
    <h2>Billing</h2>
    <p class="sub">The trial is 14 days and does not ask for a card. CallUp is A$20 a month including 1 person, plus A$5 a month for each extra staff member. GST is added at checkout.</p>
    <p>Status: <b>${esc(label)}</b></p>
    ${subscribed
      ? `<button type="button" class="primary" id="billportal">Manage billing</button>`
      : `<button type="button" class="primary" id="billsub">Subscribe</button>`}
  </div>`;
}

function badge(row) {
  if (row.isTest) return `<span class="co-badge co-test">TEST</span>`;
  if (row.plan === "friend") return `<span class="co-badge co-friend">FRIEND</span>`;
  return "";
}

export function masterPageHtml(companies, filters = {}, invites = [], currentOrigin = "", justCreated = "") {
  const rows = filterMaster(companies, filters);
  const totals = masterTotals(companies);
  const q = filters.q || "";
  const status = filters.status || "all";
  const plan = filters.plan || "all";
  const opt = (value, current, label) => `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`;
  const body = rows.map(row => `<tr data-company="${esc(row.id)}" class="master-row">
      <td><b>${esc(row.name)}</b> ${badge(row)}<div class="sub">${esc(row.email)}${row.phone ? " · " + esc(row.phone) : ""}</div></td>
      <td>${esc(row.abn)}</td>
      <td>${esc(when(row.signedUpAt))}</td>
      <td>${esc(row.planLabel)}${row.trialEndsAt && row.plan === "trial" && !row.isTest ? `<div class="sub">until ${esc(when(row.trialEndsAt))}</div>` : ""}${row.plan === "friend" ? `<div class="sub">${row.friendEndsAt ? "until " + esc(when(row.friendEndsAt)) : "no expiry"}</div>` : ""}<div class="sub">${esc(row.billingStatus || "")}</div></td>
      <td>${row.staffCount}</td>
      <td>${row.jobCount}</td>
      <td>${esc(when(row.lastActivityAt))}</td>
      <td><span class="qpill ${row.status === "active" ? "q-comp" : "q-uns"}">${esc(row.status)}</span></td>
    </tr>`).join("");
  const rank = status => status === "pending" ? 0 : status === "used" ? 1 : 2;
  const inviteRows = (invites || []).slice().sort((a, b) => rank(a.status) - rank(b.status) || String(a.id).localeCompare(String(b.id))).map(inv => {
    const pending = inv.status === "pending";
    const link = pending ? friendInviteLink(inv.id, currentOrigin) : "";
    return `<li class="friend-invite" data-friend-status="${esc(inv.status || "")}">
      <div>
        <code>${esc(inv.id)}</code> · ${esc(inv.status || "")}${inv.companyId ? " · " + esc(inv.companyId) : ""}
        ${link ? `<p class="invite-link">${esc(link)}</p>` : ""}
      </div>
      ${pending ? `<div class="inviteacts"><button type="button" data-friend-copy="${esc(link)}">Copy link</button></div>` : ""}
    </li>`;
  }).join("");
  return `<div class="sm-head"><h1>Master</h1><span class="sub">Platform owner · account details only</span></div>
    <div class="master-totals">
      <div class="tile"><span class="big">${totals.companies}</span><span class="nm">Companies</span></div>
      <div class="tile"><span class="big">${totals.activeTrials}</span><span class="nm">Active trials</span></div>
      <div class="tile"><span class="big">${totals.paying}</span><span class="nm">Paying customers</span></div>
      <div class="tile"><span class="big">${totals.friends || 0}</span><span class="nm">Friend trials</span></div>
      <div class="tile"><span class="big">${totals.staff}</span><span class="nm">Total staff</span></div>
    </div>
    <div class="card master-tools">
      <form id="testco" class="jf">
        <h2>Test company</h2>
        <p class="sub">Not a customer. No emails are sent and nothing is billed. Archive keeps the record.</p>
        <label>Name<input name="name" required maxlength="80" placeholder="Yard demo"></label>
        <label class="ck"><input type="checkbox" name="demo"> Add sample jobs and staff names</label>
        <button class="primary" type="submit">Create test company</button>
        <p id="testerr" class="err"></p>
      </form>
      <form id="friendinv" class="jf">
        <h2>Friend trial invite</h2>
        <p class="sub">A real company. Their email works. One use, and you can revoke it before it is used. Copy the link below and send it yourself. No email is sent.</p>
        <button class="primary" type="submit">Create friend invite</button>
        <p id="friendout" class="sub">${esc(justCreated || "")}</p>
        <ul class="friend-codes">${inviteRows || `<li class="muted">No invites yet.</li>`}</ul>
      </form>
    </div>
    <form id="masterf" class="bar master-filters">
      <input id="masterq" type="search" placeholder="Search name, ABN, email" value="${esc(q)}" aria-label="Search companies">
      <select id="masterstatus" aria-label="Status">${opt("all", status, "All statuses")}${opt("active", status, "Active")}${opt("suspended", status, "Suspended")}${opt("archived", status, "Archived")}</select>
      <select id="masterplan" aria-label="Plan">${opt("all", plan, "All plans")}${opt("trial", plan, "Active trial")}${opt("trial-ended", plan, "Trial ended")}${opt("friend", plan, "Friend")}${opt("paid", plan, "Paying")}${opt("test", plan, "Test")}</select>
    </form>
    <div class="card master-table-wrap"><table class="jt master-table"><thead><tr>
      <th>Company</th><th>ABN</th><th>Signed up</th><th>Plan</th><th>Staff</th><th>Jobs</th><th>Last activity</th><th>Status</th>
    </tr></thead><tbody>${body || `<tr><td colspan="8" class="muted">No companies match.</td></tr>`}</tbody></table></div>
    <div id="masterdetail"></div>`;
}

export function masterDetailHtml(row) {
  if (!row) return "";
  const testActions = row.isTest && row.status !== "archived"
    ? `<div class="btns"><button type="button" id="testopen">Open as admin</button><button type="button" id="testreset">Reset demo data</button><button type="button" id="testarchive">Archive</button></div>`
    : "";
  const friendActions = !row.isTest && row.plan === "friend"
    ? `<form id="friendplan" class="jf"><label>Friend end date<span class="sub">Leave blank for no expiry.</span><input name="end" type="date"></label>
        <div class="btns"><button type="submit" name="act" value="extend">Save end date</button><button type="submit" name="act" value="trial">Convert to trial</button><button type="submit" name="act" value="paid">Convert to paid</button></div></form>`
    : "";
  return `<article class="card master-detail" id="mastercard">
    <div class="sm-head"><h2>${esc(row.name)} ${badge(row)}</h2><button type="button" class="ghost" id="masterclose">Close</button></div>
    <p class="sub">${row.isTest ? "Test company. Opening it does not show another company's jobs. Nothing is emailed or billed." : "Account details only. Job descriptions, photos and amounts are not shown."}</p>
    ${testActions}${friendActions}
    <dl class="master-dl">
      <div><dt>Legal name</dt><dd>${esc(row.legalName)}</dd></div>
      <div><dt>ABN</dt><dd>${esc(row.abn)}</dd></div>
      <div><dt>Contact</dt><dd>${esc(row.phone || "—")} · ${esc(row.email)}</dd></div>
      <div><dt>Address</dt><dd>${esc(row.address)}</dd></div>
      <div><dt>Accounts email</dt><dd>${esc(row.accountsEmail)}</dd></div>
      <div><dt>Hubdoc</dt><dd>${esc(row.hubdocAddress || "—")}</dd></div>
      <div><dt>Signed up</dt><dd>${esc(when(row.signedUpAt))}</dd></div>
      <div><dt>Plan</dt><dd>${esc(row.planLabel)}</dd></div>
      <div><dt>Billing</dt><dd>${esc(row.billingStatus || "")}</dd></div>
      <div><dt>Trial ends</dt><dd>${row.plan === "trial" ? esc(when(row.trialEndsAt)) : "—"}</dd></div>
      <div><dt>Staff</dt><dd>${row.staffCount}</dd></div>
      <div><dt>Jobs</dt><dd>${row.jobCount}</dd></div>
      <div><dt>Last activity</dt><dd>${esc(when(row.lastActivityAt))}</dd></div>
      <div><dt>Status</dt><dd>${esc(row.status)}</dd></div>
    </dl>
  </article>`;
}

export function failureText(code) {
  const map = {
    name: "Enter the company name.",
    legalName: "Enter the legal name.",
    abn: "Enter the ABN as digits, with or without spaces.",
    address: "Enter the company address.",
    phone: "Check the phone number.",
    email: "Enter a valid company email.",
    accountsEmail: "Enter the accounts email that should receive hours spreadsheets.",
    hubdoc: "Hubdoc addresses end in @app.hubdoc.com, or leave the field blank.",
    logo: "Use a JPEG or PNG photo or file.",
    jobPrefix: "Job number prefix: up to 5 letters or numbers.",
    accountsName: "Check the accounts contact name.",
    "email-in-use": "That login email is already in use.",
    "weak-password": "Use a password of at least 8 characters.",
    "permission-denied": "That company could not be saved.",
  };
  return map[code] || "That didn't work. Try again.";
}
