// Screens for company signup, company details, and the platform-owner Master page.
// Master rows are account-level only. This file does not read jobs, photos, or money.

import { POWERED_BY, PRODUCT_NAME } from "../org-settings.js";
import { filterMaster, masterTotals } from "./company.js";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function when(ms) {
  if (!ms) return "—";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Brisbane",
  }).format(new Date(ms));
}

export function signupFormHtml() {
  return `<form id="signup" class="card login signup">
    <div class="login-brand"><div class="wordmark" aria-label="${esc(PRODUCT_NAME)}">Call<span>Up</span></div>
      <p class="orgline">New company</p></div>
    <h2>Create your company</h2>
    <p class="sub">You become the admin. Staff join only this company, from an invite. A 14-day trial starts today. Payments are not taken on this screen.</p>
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
    <label>Logo URL<span class="sub">Optional. https address, or leave blank.</span><input name="logoUrl" maxlength="300" placeholder="https://…"></label>
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
      <label>Hubdoc address<span class="sub">Optional.</span><input name="hubdocAddress" maxlength="120" value="${esc(org.hubdocAddress || "")}" placeholder="name@app.hubdoc.com"${lock}></label>
      <label>Email sign-off<input name="signoff" required maxlength="80" value="${esc(org.signoff)}"${lock}></label>
      <label>Logo URL<span class="sub">Optional https address. Blank keeps the name as text.</span><input name="logoUrl" maxlength="300" value="${esc(org.logoUrl || "")}"${lock}></label>
      ${canEdit ? `<div class="btns"><button type="submit" class="primary">Save company details</button></div>` : `<p class="sub">Only a company admin can change these.</p>`}
      <p class="powered">${esc(POWERED_BY)}</p>
    </form>`;
}

export function masterPageHtml(companies, filters = {}) {
  const rows = filterMaster(companies, filters);
  const totals = masterTotals(companies);
  const q = filters.q || "";
  const status = filters.status || "all";
  const plan = filters.plan || "all";
  const opt = (value, current, label) => `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`;
  const body = rows.map(row => `<tr data-company="${esc(row.id)}" class="master-row">
      <td><b>${esc(row.name)}</b><div class="sub">${esc(row.email)}${row.phone ? " · " + esc(row.phone) : ""}</div></td>
      <td>${esc(row.abn)}</td>
      <td>${esc(when(row.signedUpAt))}</td>
      <td>${esc(row.planLabel)}${row.trialEndsAt && row.plan === "trial" ? `<div class="sub">until ${esc(when(row.trialEndsAt))}</div>` : ""}</td>
      <td>${row.staffCount}</td>
      <td>${row.jobCount}</td>
      <td>${esc(when(row.lastActivityAt))}</td>
      <td><span class="qpill ${row.status === "active" ? "q-comp" : "q-uns"}">${esc(row.status)}</span></td>
    </tr>`).join("");
  return `<div class="sm-head"><h1>Master</h1><span class="sub">Platform owner · account details only</span></div>
    <div class="master-totals">
      <div class="tile"><span class="big">${totals.companies}</span><span class="nm">Companies</span></div>
      <div class="tile"><span class="big">${totals.activeTrials}</span><span class="nm">Active trials</span></div>
      <div class="tile"><span class="big">${totals.paying}</span><span class="nm">Paying customers</span></div>
      <div class="tile"><span class="big">${totals.staff}</span><span class="nm">Total staff</span></div>
    </div>
    <form id="masterf" class="bar master-filters">
      <input id="masterq" type="search" placeholder="Search name, ABN, email" value="${esc(q)}" aria-label="Search companies">
      <select id="masterstatus" aria-label="Status">${opt("all", status, "All statuses")}${opt("active", status, "Active")}${opt("suspended", status, "Suspended")}</select>
      <select id="masterplan" aria-label="Plan">${opt("all", plan, "All plans")}${opt("trial", plan, "Active trial")}${opt("trial-ended", plan, "Trial ended")}${opt("paid", plan, "Paying")}</select>
    </form>
    <div class="card master-table-wrap"><table class="jt master-table"><thead><tr>
      <th>Company</th><th>ABN</th><th>Signed up</th><th>Plan</th><th>Staff</th><th>Jobs</th><th>Last activity</th><th>Status</th>
    </tr></thead><tbody>${body || `<tr><td colspan="8" class="muted">No companies match.</td></tr>`}</tbody></table></div>
    <div id="masterdetail"></div>`;
}

export function masterDetailHtml(row) {
  if (!row) return "";
  return `<article class="card master-detail" id="mastercard">
    <div class="sm-head"><h2>${esc(row.name)}</h2><button type="button" class="ghost" id="masterclose">Close</button></div>
    <p class="sub">Read only. Job descriptions, photos and amounts are not shown.</p>
    <dl class="master-dl">
      <div><dt>Legal name</dt><dd>${esc(row.legalName)}</dd></div>
      <div><dt>ABN</dt><dd>${esc(row.abn)}</dd></div>
      <div><dt>Contact</dt><dd>${esc(row.phone || "—")} · ${esc(row.email)}</dd></div>
      <div><dt>Address</dt><dd>${esc(row.address)}</dd></div>
      <div><dt>Accounts email</dt><dd>${esc(row.accountsEmail)}</dd></div>
      <div><dt>Hubdoc</dt><dd>${esc(row.hubdocAddress || "—")}</dd></div>
      <div><dt>Signed up</dt><dd>${esc(when(row.signedUpAt))}</dd></div>
      <div><dt>Plan</dt><dd>${esc(row.planLabel)}</dd></div>
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
    logo: "Logo needs an http(s) address or an icons/ file.",
    "email-in-use": "That login email is already in use.",
    "weak-password": "Use a password of at least 8 characters.",
    "permission-denied": "That company could not be saved.",
  };
  return map[code] || "That didn't work. Try again.";
}
