// CallUp jobs app. Organisation name and logo come from org-settings.js.
// This install's customer is Heartwood Earthworx. Firebase ids are unchanged.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, connectAuthEmulator }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, getDoc, getDocs, query, where, orderBy, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, runTransaction, Timestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, connectStorageEmulator, listAll, getMetadata, getBlob }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { firebaseConfig, useEmulator } from "./firebase-config.js";
import { installQuotes, adminViewRouter } from "./features/quotes.js";
import { installRouteOrder, orderJobsForRun, runSheetId, geoPatch } from "./features/route-order.js";
import { planJobPhotoMirrors, planStaffReceiptCapture, resolveMembership, putPlanned, jobPhotoPrefix, storageErrorCode, summarizePhotoListing } from "./features/cloud-storage.js";
import { buildOperationalExport, retentionAdminText, retentionView } from "./features/cloud-retention.js";
import { buildJobGallery, stampExpiresAfter, galleryExportPhotos, photoSlotHtml, lightboxHtml, photoFailureText } from "./features/photo-gallery.js";
import { installChatApp } from "./features/chat-ui.js";
import { installCompliance } from "./features/compliance.js";
import { SWMS, SWMS_VERSION, sigMs, sigExp, latestSig, statusOf, swmsSignatureData, buildPlaceholderPdf } from "./features/swms-sign.js";
import {
  acceptLoadingHtml, acceptScreenModel, acceptViewHtml, buildInviteDraft, inviteFailureText,
  newInviteToken, pendingInviteForEmail, staffViewHtml,
} from "./features/staff-invites.js";
import { PRODUCT_NAME, POWERED_BY, orgSettings, saveOrgSettings } from "./org-settings.js";
import {
  TS_CONSENT, accuracyText, brisbaneHM, captureFix, coordText, daysForSheet, editList, entryList,
  locationMap, machineChoicePatch, machinePromptNeeded, mapsHref, needsLocationConsent, newTsId, openClock,
  paidShift, prestartStatus, sheetHours, shiftHours, sortedEntries, stampText,
} from "./features/timesheet.js";

const cfg = useEmulator ? { ...firebaseConfig, apiKey: "demo-key", projectId: "demo-heartwood" } : firebaseConfig;
const fb = initializeApp(cfg);
const auth = getAuth(fb);
// Offline cache: jobs already loaded stay readable and writes queue until the phone is back online.
const db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
const storage = getStorage(fb);
if (useEmulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
if ("serviceWorker" in navigator && !useEmulator) navigator.serviceWorker.register("sw.js", { scope: "./" });

// ------------------------------------------------------------------ constants / helpers
export const CLIENTS = ["Orbit Homes (Qld) Pty Ltd", "Torsion Built Pty Ltd", "Silkwood Homes", "OJ Pippin Homes", "Envision Homes", "Private"];
const TYPES = { spoil: "Spoil removal", backslab: "Backslab", waterproof: "Waterproofing", clean: "Site clean", other: "Other" };
const STATUSES = ["Scheduled", "In progress", "Done", "Cancelled"];
const TZ = "Australia/Brisbane";
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = d => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);           // YYYY-MM-DD in Brisbane
const todayStr = () => (window.HW_TODAY || ymd(new Date()));
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayLabel = s => new Date(s + "T00:00:00Z").toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const dowMon = s => (new Date(s + "T00:00:00Z").getUTCDay() + 6) % 7;      // 0 = Monday
const mapsUrl = a => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a + ", QLD");
function undoToast(msg, undo, ms = 7000) {
  const t = $("#toast"); t.innerHTML = `${esc(msg)} <button type="button" class="toast-undo">Undo</button>`; t.classList.remove("hidden");
  t.querySelector(".toast-undo").onclick = async () => { t.classList.add("hidden"); try { await undo(); } catch (e) { toast("Undo failed: " + (e.code || e.message)); } };
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add("hidden"), ms);
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add("hidden"), 2500); }
function guessType(text) {
  const t = (text || "").toLowerCase();
  const keys = [["slab back blade", "backslab"], ["slab clean", "backslab"], ["back slab", "backslab"], ["backslab", "backslab"], ["spoil", "spoil"], ["clean", "clean"]];
  const hits = keys.filter(([k]) => t.includes(k)).map(([k, v]) => [t.indexOf(k), -k.length, v]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return hits.length ? hits[0][2] : "other";
}

let me = null, staff = [], jobs = [], unsub = null;
let CHAT = { badge() { return ""; }, teamHtml() { return ""; }, jobHtml() { return ""; }, mount() {}, openJob() {}, start() {}, stop() {}, watch() {}, refresh() {} };
let COMP = { start() {}, stop() {}, bind() {}, abandon() {}, adminHtml() { return ""; }, staffHtml() { return ""; }, adminBannerHtml() { return ""; }, staffBannerHtml() { return ""; }, canSee() { return false; }, canEdit() { return false; }, canPrestart() { return false; }, canEditService() { return false; } };
let QG = { bindAdmin() {} }; // Quotes module; filled after helpers load
let ROUTE = { open() {} };
const ALEX_UID = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";      // Alex has no users/{uid} profile doc; always staff
const ui = { view: "list", staffF: "", typeF: "", photoLists: {}, photoUrls: {}, photoBlobs: {}, photoThumbs: {}, photoThumbTasks: {}, photoErrors: {}, photoJobs: {}, photoPaint: 0 };

// ------------------------------------------------------------------ auth
$("#logout").onclick = () => signOut(auth);
onAuthStateChanged(auth, async user => {
  if (unsub) { unsub(); unsub = null; }
  CHAT.stop();
  COMP.stop();
  const inviteToken = new URLSearchParams(location.search).get("invite") || "";
  if (!user) {
    me = null; $("#who").textContent = ""; $("#logout").classList.add("hidden");
    if (inviteToken || window.HW_INVITE_PREVIEW) return renderInviteAccept(inviteToken);
    return renderLogin();
  }
  if (inviteToken) return renderInviteSignedIn();
  // Admin = UID listed in firestore.rules (Alex, sync, Patrick): detected by being ALLOWED to list users - so if the
  // rules don't (yet) make someone admin they simply fall back to the operator view.
  // users/{uid}.role: "operator" (staff, no $) | "supervisor" (staff shell + canSeeMoney). Patrick is rules-admin with an operator profile (bookable).
  const snap = await getDoc(doc(db, "users", user.uid)).catch(() => null);
  const prof = snap && snap.exists() ? snap.data() : null;
  let users = null;
  users = await getDocs(collection(db, "users")).catch(() => null);
  if (!prof && !users) { $("#app").innerHTML = `<p class="pad">No access for ${esc(user.email)}. Ask Alex to add you.</p>`; return; }
  me = users ? { uid: user.uid, name: (prof && prof.name) || "Alex", role: "admin", staffRole: prof && prof.role } : { uid: user.uid, ...prof };
  me.cloudProfile = prof;
  $("#who").textContent = `${me.name} · ${me.role}`; $("#logout").classList.remove("hidden");
  CHAT.start();
  if (me.role === "admin") {
    if (window.HW_PREVIEW_VIEW === "staff") ui.view = "staff";
    const logins = users.docs.map(d => ({ uid: d.id, ...d.data() })).filter(u => u.role === "operator" || u.role === "supervisor");
    staff = [{ uid: ALEX_UID, name: "Alex" }, ...logins.filter(u => u.uid !== ALEX_UID)];
    // two weeks back (catch overdue work) to 4 weeks ahead, plus anything undated
    const q = query(collection(db, "jobs"), where("date", ">=", addDays(todayStr(), -14)), where("date", "<=", addDays(todayStr(), 28)), orderBy("date"));
    const u1 = onSnapshot(q, s => { jobs = s.docs.map(d => ({ id: d.id, ...d.data() })); addNameOnlyStaff(jobs); renderAdmin(); });
    // Invoicing: every Done job (any date), admin only.
    const u2 = onSnapshot(query(collection(db, "jobs"), where("status", "==", "Done")), s => { ui.done = s.docs.map(d => ({ id: d.id, ...d.data() })); donePill(); if (ui.view === "invoices" || ui.view === "completed" || ui.view === "home") renderAdmin(); });
    const u3 = onSnapshot(collection(db, "incidents"), s => { ui.incidents = s.docs.map(d => ({ id: d.id, ...d.data() })); if (ui.view === "safety" || ui.view === "home") renderAdmin(); incRefresh(); }, e => console.warn("incidents", e.code));
    const u4 = onSnapshot(query(collection(db, "invites"), where("tenantId", "==", myTenant())), s => {
      ui.invites = s.docs.map(d => ({ id: d.id, ...d.data() })); ui.invitesErr = "";
      if (ui.view === "staff") renderAdmin();
    }, e => { ui.invites = []; ui.invitesErr = e.code || "permission-denied"; if (ui.view === "staff") renderAdmin(); });
    unsub = () => { u1(); u2(); u3(); u4(); CHAT.stop(); COMP.stop(); tsStop(); if (ui.swmsUnsub) ui.swmsUnsub(); }; swmsSub(); COMP.start();
    getDocs(query(collection(db, "jobs"), where("date", "==", ""))).then(s => { ui.undated = s.docs.map(d => ({ id: d.id, ...d.data() })); addNameOnlyStaff(ui.undated); renderAdmin(); });
  } else {
    // Operators may only list jobs assigned to them (enforced by firestore.rules).
    const q = query(collection(db, "jobs"), where("assigned", "array-contains", user.uid));
    const u1 = onSnapshot(q, s => { jobs = s.docs.map(d => ({ id: d.id, ...d.data() })); renderOperator(); });
    const u3 = onSnapshot(query(collection(db, "incidents"), where("reportedBy", "==", user.uid)), s => { ui.incidents = s.docs.map(d => ({ id: d.id, ...d.data() })); if (!ui.opSel && (ui.opTab || "today") === "today") renderOperator(); incRefresh(); }, e => console.warn("incidents", e.code));
    const u4 = canInvite()
      ? onSnapshot(query(collection(db, "invites"), where("tenantId", "==", myTenant())), s => {
        ui.invites = s.docs.map(d => ({ id: d.id, ...d.data() })); ui.invitesErr = "";
        if ((ui.opTab || "today") === "staff") renderOperator();
      }, e => { ui.invites = []; ui.invitesErr = e.code || "permission-denied"; if ((ui.opTab || "today") === "staff") renderOperator(); })
      : () => {};
    if (canInvite() && window.HW_PREVIEW_VIEW === "staff") ui.opTab = "staff";
    unsub = () => { u1(); u3(); u4(); CHAT.stop(); COMP.stop(); tsStop(); if (ui.swmsUnsub) ui.swmsUnsub(); }; swmsSub(); COMP.start();
  }
});

function myTenant() {
  const profile = me && me.cloudProfile;
  const id = profile && typeof profile.tenantId === "string" ? profile.tenantId.trim() : "";
  return id || "heartwood";
}
function inviteDisplayNow() {
  return window.HW_TODAY ? new Date(window.HW_TODAY + "T12:00:00+10:00") : new Date();
}
function renderInviteSignedIn() {
  paintBrand();
  $("#who").textContent = "";
  $("#logout").classList.remove("hidden");
  $("#app").innerHTML = `<form class="card login" id="invitebusy">
    <h2>Staff invite</h2>
    <p>This link creates a new login. Sign out, then open it again to set a password.</p>
    <button class="big primary" type="button" id="invitesignout">Sign out</button>
  </form>`;
  $("#invitesignout").onclick = () => signOut(auth);
}
async function callInvite(name, data) {
  const projectId = useEmulator ? "demo-heartwood" : firebaseConfig.projectId;
  const url = useEmulator
    ? `http://127.0.0.1:5001/${projectId}/australia-southeast1/${name}`
    : `https://australia-southeast1-${projectId}.cloudfunctions.net/${name}`;
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data }) });
  } catch {
    const err = new Error("unavailable");
    err.code = "unavailable";
    throw err;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const err = new Error("invite-failed");
    err.code = res.status === 404 ? "unavailable" : "unavailable";
    throw err;
  }
  return body.result || {};
}
function renderInviteAccept(token) {
  paintBrand();
  const preview = window.HW_INVITE_PREVIEW;
  if (preview) {
    $("#app").innerHTML = acceptViewHtml(acceptScreenModel(preview, inviteDisplayNow()));
    return bindInviteAccept(token, true);
  }
  $("#app").innerHTML = acceptLoadingHtml();
  callInvite("previewStaffInvite", { token }).then(result => {
    const model = result && result.ok ? acceptScreenModel(result, inviteDisplayNow()) : {
      ok: false, reason: (result && result.reason) || "invalid", name: result && result.name, email: result && result.email,
    };
    $("#app").innerHTML = acceptViewHtml(model);
    if (model.ok) bindInviteAccept(token, false, model.email);
  }).catch(() => {
    $("#app").innerHTML = acceptViewHtml({ ok: false, reason: "unavailable" });
  });
}
function bindInviteAccept(token, previewOnly, email) {
  const form = $("#acceptf");
  if (!form || !form.p) return;
  form.onsubmit = async ev => {
    ev.preventDefault();
    const err = $("#aceerr");
    if (form.p.value !== form.p2.value) { err.textContent = inviteFailureText("mismatch"); return; }
    if (previewOnly) { err.textContent = "Preview only. No login was created and no email was sent."; return; }
    err.textContent = "";
    let created = false;
    try {
      const result = await callInvite("acceptStaffInvite", { token, password: form.p.value });
      if (!result.ok) { err.textContent = inviteFailureText(result.reason); return; }
      created = true;
      const address = result.email || email;
      history.replaceState({}, "", location.pathname);
      await signInWithEmailAndPassword(auth, address, form.p.value);
    } catch (e) {
      err.textContent = created ? "Your login was created. Sign in with that password." : inviteFailureText("unavailable");
    }
  };
}
function orgLogoHtml(org) {
  if (!org.logoUrl) return "";
  return `<img class="orglogo" src="${esc(org.logoUrl)}" alt="">`;
}
function paintBrand() {
  const org = orgSettings();
  const el = document.querySelector(".brand");
  if (el) el.innerHTML = `<span class="wordmark" aria-label="${esc(PRODUCT_NAME)}">Call<span>Up</span></span><span class="orgline">${orgLogoHtml(org)}${esc(org.name)}</span>`;
  document.title = `${PRODUCT_NAME} · ${org.name}`;
}
function renderLogin() {
  const org = orgSettings();
  paintBrand();
  $("#app").innerHTML = `<form id="login" class="card login">
    <div class="login-brand"><div class="wordmark" aria-label="${esc(PRODUCT_NAME)}">Call<span>Up</span></div>
      <p class="orgline">${orgLogoHtml(org)}${esc(org.name)}</p></div>
    <h2>Sign in</h2>
    <p class="sub">CallUp for ${esc(org.legalName)}. Use the email this business gave you.</p>
    <label>Email<input name="e" type="email" autocomplete="username" required></label>
    <label>Password<input name="p" type="password" autocomplete="current-password" required></label>
    <button class="big primary">Sign in</button><p id="lerr" class="err"></p>
    <p class="powered">${esc(POWERED_BY)}</p></form>`;
  $("#login").onsubmit = async ev => {
    ev.preventDefault(); const f = ev.target;
    try { await signInWithEmailAndPassword(auth, f.e.value.trim(), f.p.value); }
    catch (e) { $("#lerr").textContent = "Sign-in failed: " + (e.code || e.message); }
  };
}
function settingsView() {
  const org = orgSettings();
  return `<div class="sm-head"><h1>Organisation</h1></div>
    <p class="sub">CallUp is the product. These fields are the business on the header, SWMS, quotes and emails. Saving stays on this phone. The default for every sign-in is in org settings. This does not rename Firebase, job numbers, or jobs.heartwoodew.com.</p>
    <form id="orgform" class="card jf">
      <label>Trading name<input name="name" required maxlength="80" value="${esc(org.name)}"></label>
      <label>Legal name<input name="legalName" required maxlength="120" value="${esc(org.legalName)}"></label>
      <label>ABN<input name="abn" maxlength="20" value="${esc(org.abn)}"></label>
      <label>Email sign-off<input name="signoff" required maxlength="80" value="${esc(org.signoff)}"></label>
      <label>Logo URL<span class="sub">Optional. Leave blank for the trading name as text. A CallUp picture logo is not in this install, so the product mark stays the CallUp wordmark.</span><input name="logoUrl" maxlength="300" value="${esc(org.logoUrl)}" placeholder="https://… or icons/…"></label>
      <p class="powered">${esc(POWERED_BY)}</p>
      <div class="btns"><button type="submit" class="primary">Save organisation</button></div>
    </form>`;
}
function bindSettings(A) {
  const form = A.querySelector("#orgform");
  if (!form) return;
  form.onsubmit = ev => {
    ev.preventDefault();
    const typed = form.logoUrl.value.trim();
    const saved = saveOrgSettings({
      name: form.name.value, legalName: form.legalName.value, abn: form.abn.value,
      signoff: form.signoff.value, logoUrl: form.logoUrl.value,
    });
    paintBrand();
    toast(typed && !saved.logoUrl ? "Logo needs an http(s) address or an icons/ file. Other fields saved." : "Organisation saved on this phone");
    renderAdmin();
  };
}

// ------------------------------------------------------------------ admin
// staff = people with an app login {uid,name} only (Alex, Patrick). Anyone else shows as Unallocated.
// Jobs keep assigned[] (login uids, used by the rules) and assignedNames[] (everyone, used for display/filter).
const staffName = uid => (staff.find(s => s.uid === uid) || {}).name || "?";
const skey = s => s.uid || "name:" + s.name;
function addNameOnlyStaff(list) { /* no name-only staff: only app logins are listed */ }
const namesOf = j => (j.assignedNames && j.assignedNames.length ? j.assignedNames : (j.assigned || []).map(staffName));
const label = n => staff.some(s => !s.uid && s.name === n) ? `${n} (no login)` : n;
function filtered() {
  const f = ui.staffF, sel = staff.find(s => skey(s) === f);
  return jobs.filter(j => (!f || (f === "_none" ? !namesOf(j).length : namesOf(j).map(x => x.toLowerCase()).includes((sel?.name || "").toLowerCase())))
    && (!ui.typeF || j.type === ui.typeF));
}
// ServiceM8-style queues, derived from existing fields only (status + sm8Status from the importer).
const QUEUES = ["Work Order", "Quote"];          // main Jobs screen: open work only; Completed/Unsuccessful have their own screen
const QCLS = { "Quote": "q-quote", "Work Order": "q-wo", "Unsuccessful": "q-uns", "Completed": "q-comp" };
function queueOf(j) {
  if (j.status === "Cancelled" || j.sm8Status === "Unsuccessful") return "Unsuccessful";
  if (j.status === "Done" || j.sm8Status === "Completed") return "Completed";
  // Explicit CallUp quoteStatus (Draft/Accepted) wins over legacy ServiceM8 sm8Status alone.
  if (j.quoteStatus === "Draft") return "Quote";
  if (j.quoteStatus === "Accepted") return "Work Order";
  if (j.sm8Status === "Quote") return "Quote";
  return "Work Order";
}
const jobNo = j => j.sm8JobNo ? j.sm8JobNo : "HW-" + String(j.id || "").slice(-4).toUpperCase();
const firstLine = s => String(s || "").split(/\n|\. /)[0];
const shortDate = s => s ? new Date(s + "T00:00:00Z").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "Unscheduled";
const NAV = [["home", "⌂", "Home"], ["compliance", "🚐", "Compliance"], ["prestart", "☑", "Prestart"], ["chat", "💬", "Chat"], ["dispatch", "▦", "Dispatch Board"], ["jobs", "☰", "Jobs"], ["unscheduled", "◷", "Unscheduled"], ["quotes", "✎", "Quotes"], ["completed", "✔", "Completed"], ["safety", "⚠", "Safety"], ["swms", "📋", "SWMS"], ["clients", "👤", "Clients"], ["staff", "👥", "Staff"], ["inbox", "✉", "Inbox", 0, 1],
  ["invoices", "$", "Invoices"], ["reports", "📈", "Reports", 1], ["myjobs", "👷", "My jobs"], ["timesheet", "⏱", "Timesheet"], ["reimb", "💵", "Reimbursements", 0, 1], ["settings", "⚙", "Organisation"]];
ui.view = "home"; ui.queue = "All"; ui.dview = "week"; ui.wk = 0; ui.q = "";
const PHONE = matchMedia("(max-width:760px)");
const TOUCH = matchMedia("(pointer:coarse)");
PHONE.addEventListener?.("change", () => { if (me && me.role === "admin") renderAdmin(); });
// Grouped side menu: top items, then collapsible groups (open/closed remembered on this device; the group holding the current screen is always open).
const NAV_TOP = ["home", "chat", "inbox", "clients", "staff"];
const NAV_FOOT = ["settings"];
const NAV_GROUPS = [["jobs", "☰", "Jobs", ["dispatch", "jobs", "unscheduled", "quotes", "completed", "myjobs"]], ["money", "$", "Money", ["invoices", "reimb", "timesheet"]], ["safety", "⚠", "Safety", ["safety", "swms", "prestart", "compliance"]]];
const NAV_LBL = { safety: "Incidents" };
ui.navCol = (() => { try { return JSON.parse(localStorage.getItem("hwNavCol") || "{}"); } catch { return {}; } })();
function shell(inner) {
  const cur = NAV.find(n => n[0] === ui.view);
  const item = k => { const x = NAV.find(n => n[0] === k); if (!x || x[3] || (x[4] && !isOwner()) || (k === "invoices" && (!me || me.role !== "admin")) || (k === "staff" && !canInvite()) || (k === "quotes" && !canQuote()) || (k === "compliance" && !COMP.canSee()) || (k === "prestart" && !COMP.canPrestart())) return "";
    const badge = k === "chat" ? CHAT.badge("staff") : "";
    return `<button class="sm-nav ${ui.view === k ? "on" : ""}" data-view="${k}" title="${esc(NAV_LBL[k] || x[2])}"><span class="ic">${x[1]}</span><span class="lbl">${esc(NAV_LBL[k] || x[2])}</span>${badge}</button>`; };
  const grp = ([g, ic, n, ks]) => { const has = ks.includes(ui.view), open = has || !ui.navCol[g];
    return `<div class="sm-grp ${open ? "open" : ""} ${has ? "has" : ""}"><button class="sm-gh" data-grp="${g}" aria-expanded="${open}"><span class="ic">${ic}</span><span class="lbl">${n}</span><span class="car">${open ? "▾" : "▸"}</span></button>
      <div class="sm-gi">${ks.map(item).join("")}</div></div>`; };
  return `<div class="sm-layout ${ui.navOpen ? "navopen" : ""}"><div class="sm-burgerbar"><button class="sm-burger" id="burger" aria-label="Menu">☰</button><b>${esc(cur ? (NAV_LBL[cur[0]] || cur[2]) : "")}</b></div>
    <nav class="sm-side">${NAV_TOP.map(item).join("")}${NAV_GROUPS.map(grp).join("")}${NAV_FOOT.map(item).join("")}</nav>
    <section class="sm-main">${inner}</section></div>`;
}
// ---- Mixed work: a job whose description lines are different task types (spoil vs backslab vs waterproofing vs clean)
const TASK_RX = [["waterproof", /water ?proof/i], ["spoil", /spoil|soil removal/i], ["backslab", /back ?slab|back ?blade|slab clean|level site/i], ["clean", /\b(site |final )?clean\b/i]];
const lineKind = l => (TASK_RX.find(([, rx]) => rx.test(l)) || [null])[0];
function taskLines(desc) {
  let ls = String(desc || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (ls.length <= 1 && ls[0]) ls = ls[0].split(/(?=\b(?:back ?slab|spoil removal|waterproof\w*|site clean|slab clean)\b)/i).map(x => x.trim()).filter(Boolean);
  return ls.map(t => ({ t, k: lineKind(t) }));
}
const mixedKinds = j => [...new Set(taskLines(j.description).map(x => x.k).filter(Boolean))];
const isMixed = j => mixedKinds(j).length > 1;
const ipPill = (j, cls = "") => j.status === "In progress" ? `<span class="qpill ip ${cls}">In progress</span>` : "";
const ipTop = (j, cls = "") => j.status === "In progress" ? `<div class="ptop">${ipPill(j, cls)}</div>` : "";
const mixedBadge = j => isMixed(j) ? ` <span class="qpill mixed" title="${esc(mixedKinds(j).map(k => TYPES[k] || k).join(" + "))} on one job - split it">Mixed work</span>` : "";
function jobRow(j) {
  const q = queueOf(j), names = namesOf(j).map(label).join(", ");
  return `<tr class="jr" data-id="${j.id}" draggable="true"><td><span class="qdot ${QCLS[q]}" title="${q}"></span></td>
    <td class="jn">#${esc(jobNo(j))}${jobPhotosIcon(j)}</td><td><b>${esc(j.client || "")}</b><div class="sub">${esc(j.address || "-")}</div></td>
    <td>${esc(firstLine(j.description))}${mixedBadge(j)}<div class="sub">${esc(TYPES[j.type] || "")}${j.po ? " · PO " + esc(j.po) : ""}</div></td>
    <td>${esc(shortDate(j.date))}<div class="sub">${esc(j.time || "")}${j.durationHrs ? " · " + esc(j.durationHrs) + "h" : ""}</div></td>
    <td>${names ? esc(names) : `<span class="unal">Unallocated</span>`}</td>
    <td><span class="pstack">${ipPill(j)}<span class="qpill ${QCLS[q]}">${q}</span></span></td></tr>`;
}
// Job-list search: every typed word must appear somewhere in job no / address (lot, street) / client / PO /
// description / staff. Case-insensitive; "#659" == "659".
const qWords = () => (ui.q || "").toLowerCase().replace(/#/g, " ").split(/\s+/).filter(Boolean);
function matchQ(j) {
  const w = qWords(); if (!w.length) return true;
  const hay = [jobNo(j), j.sm8JobNo, j.client, j.address, j.description, j.po, j.type, TYPES[j.type], namesOf(j).join(" ")].map(x => String(x ?? "")).join(" ").toLowerCase();
  return w.every(x => hay.includes(x));
}
const searchBar = () => `<div class="sbar"><span class="sbar-ic">🔍</span><input id="jq" type="search" inputmode="search" autocomplete="off" placeholder="Search job #, address, client, PO, staff…" value="${esc(ui.q || "")}">${ui.q ? `<button type="button" id="jqx" class="sbar-x" title="Clear" aria-label="Clear search">✕</button>` : ""}</div>`;
function groupByDate(list) {
  const m = new Map(); for (const j of list) { const k = j.date || ""; if (!m.has(k)) m.set(k, []); m.get(k).push(j); }
  return [...m.entries()];
}
function jobsView(all) {
  const t = ui.q.toLowerCase();
  const fs = all.filter(matchQ);
  const open = fs.filter(j => j.date && QUEUES.includes(queueOf(j)));      // unscheduled jobs have their own screen
  if (!QUEUES.includes(ui.queue)) ui.queue = "All";
  const cnt = q => open.filter(j => queueOf(j) === q).length;
  const list = open.filter(j => ui.queue === "All" || queueOf(j) === ui.queue)
    .sort((a, b) => ((a.date || "9") + (a.time || "")).localeCompare((b.date || "9") + (b.time || "")));
  return `<div class="sm-head"><h1>Jobs</h1><span class="headbtns"><button id="findall" class="sm-btn" title="Run Find PO on every open and not-yet-invoiced job">🔎 Find all POs</button><button id="new" class="sm-btn primary">+ New Job</button></span></div>${searchBar()}
    <div class="qtabs"><button data-q="All" class="${ui.queue === "All" ? "on" : ""}">All open <span>${open.length}</span></button>
      ${QUEUES.map(q => `<button data-q="${q}" class="${QCLS[q]} ${ui.queue === q ? "on" : ""}"><span class="qdot ${QCLS[q]}"></span>${q} <span>${cnt(q)}</span></button>`).join("")}</div>
    <div class="filters"><select id="fs"><option value="">All staff</option>${staff.map(s => `<option value="${esc(skey(s))}" ${ui.staffF === skey(s) ? "selected" : ""}>${esc(label(s.name))}</option>`).join("")}<option value="_none" ${ui.staffF === "_none" ? "selected" : ""}>Unallocated</option></select>
      <select id="ft"><option value="">All categories</option>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${ui.typeF === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <span class="muted sub">Showing 2 weeks back to 4 weeks ahead (unscheduled jobs: see Unscheduled)</span></div>
    <table class="jt"><thead><tr><th></th><th>Job #</th><th>Client / Site</th><th>Description</th><th>Scheduled</th><th>Staff</th><th>Status</th></tr></thead>
    <tbody>${groupByDate(list).map(([d, js]) => `<tr class="dayhdr"><td colspan="7">${esc(d ? dayLabel(d) : "Unscheduled")} <span class="cnt">${js.length}</span></td></tr>${js.map(jobRow).join("")}`).join("") || `<tr><td colspan="7" class="muted pad">No jobs in this queue for ${esc(orgSettings().name)}.</td></tr>`}</tbody></table>`;
}
// Unscheduled screen: open jobs with no booking date, newest first. "Schedule" opens the job card on the date field.
// (Jobs created in ServiceM8 more than 90 days ago are not imported at all, see tools/sm8_import.py.)
const createdOf = j => j.sm8Created || (j.createdAt && j.createdAt.toDate ? ymd(j.createdAt.toDate()) : "");
function unscheduledView(all) {
  const t = ui.q.toLowerCase();
  const list = all.filter(j => !j.date && QUEUES.includes(queueOf(j)) && (!ui.typeF || j.type === ui.typeF)
      && matchQ(j))
    .sort((a, b) => createdOf(b).localeCompare(createdOf(a)) || String(b.sm8JobNo || "").localeCompare(String(a.sm8JobNo || ""), undefined, { numeric: true }));
  return `<div class="sm-head"><h1>Unscheduled jobs <span class="cnt">${list.length}</span></h1><button id="new" class="sm-btn primary">+ New Job</button></div>${searchBar()}
    <p class="sub muted">Open jobs with no booking date, newest first. Jobs created in ServiceM8 more than 3 months ago are not shown.</p>
    <table class="jt"><thead><tr><th></th><th>Job #</th><th>Client / Site</th><th>Description</th><th>PO</th><th>Created</th><th></th></tr></thead>
    <tbody>${list.map(j => `<tr class="jr" data-id="${j.id}"><td><span class="qdot ${QCLS[queueOf(j)]}"></span></td><td class="jn">#${esc(jobNo(j))}${jobPhotosIcon(j)}</td>
      <td><b>${esc(j.client || "")}</b><div class="sub">${esc(j.address || "-")}</div></td><td>${esc(firstLine(j.description))}<div class="sub">${esc(TYPES[j.type] || "")}</div></td>
      <td>${esc(j.po || "—")}</td><td>${createdOf(j) ? esc(shortDate(createdOf(j))) : "—"}</td>
      <td><button type="button" class="sm-btn primary" data-sched="${j.id}">Schedule</button></td></tr>`).join("") || `<tr><td colspan="7" class="muted pad">Nothing unscheduled – nice.</td></tr>`}</tbody></table>`;
}
// ---- Check Xero (Xero users only). Read-only: QUEUES {type:'check'} in xeroQueue; the box worker (tools/xero_queue.py,
// every 5 min 6am-8pm, or by hand) searches Xero invoices with GET only and writes jobs/{id}.xeroCheck
// {checkedAt, status: invoiced/draft/not found/multiple, matches:[{invoiceNumber,status,totalEx,date,amountDue}]}.
const xcAgo = t => { const ms = Date.now() - new Date(t).getTime(); if (!(ms >= 0)) return ""; const m = Math.round(ms / 60000);
  return m < 1 ? "checked just now" : m < 60 ? `checked ${m} min ago` : m < 1440 ? `checked ${Math.round(m / 60)} h ago` : `checked ${Math.round(m / 1440)} d ago`; };
const XC_ST = { PAID: "Paid", AUTHORISED: "Awaiting payment", DRAFT: "Draft", SUBMITTED: "Awaiting approval" };
function xcLabel(j) {
  if (j.xeroCheckPending) return `<span class="qpill xc-wait">Checking…</span>`;
  const x = j.xeroCheck; if (!x) return "";
  const m = x.matches || [], n0 = m[0] || {};
  const lab = x.status === "invoiced" ? `Invoiced ${esc(n0.invoiceNumber || "")} · ${esc(XC_ST[n0.status] || n0.status || "")}` : x.status === "draft" ? `Draft in Xero${n0.invoiceNumber ? " " + esc(n0.invoiceNumber) : ""}`
    : x.status === "multiple" ? `${m.length} matches in Xero` : x.status === "error" ? "Xero check failed" : "Not found in Xero";
  const cls = x.status === "invoiced" ? "xc-ok" : x.status === "draft" ? "xc-draft" : x.status === "multiple" ? "xc-multi" : x.status === "error" ? "q-alert" : "xc-none";
  const tip = m.map(i => `${i.invoiceNumber} ${i.status}${canSeeMoney() ? ` $${(+i.totalEx || 0).toFixed(2)} ex GST` : ""} ${i.date || ""}${canSeeMoney() ? ` due $${(+i.amountDue || 0).toFixed(2)}` : ""}`).join("\n") || x.error || x.note || "";
  return `<span class="qpill ${cls}" title="${esc(tip)}">${lab}</span> <span class="sub muted xc-ago">${esc(xcAgo(x.checkedAt))}</span>`;
}
function xcCell(j) { if (!canXero() || queueOf(j) !== "Completed") return "";
  return `<div class="xc">${xcLabel(j)} <button type="button" class="sm-btn xero xc-btn" data-xc="${j.id}" ${j.xeroCheckPending ? "disabled" : ""}>${j.xeroCheck ? "Re-check" : "Check Xero"}</button></div>`; }
async function checkXero(list) {
  if (!canXero()) return; list = list.filter(j => queueOf(j) === "Completed" && !j.xeroCheckPending);
  if (!list.length) { toast("Already checking."); return; }
  for (const j of list) {
    try { await addDoc(collection(db, "xeroQueue"), { type: "check", jobId: j.id, status: "queued", by: auth.currentUser.uid, at: serverTimestamp() });
      await updateDoc(doc(db, "jobs", j.id), { xeroCheckPending: true, xeroCheckQueuedAt: serverTimestamp() }); }
    catch (e) { if (e && e.code === "permission-denied") { alert("Check Xero isn't switched on yet (Firestore rules). Nothing was queued."); return; }
      toast("Couldn't queue the Xero check: " + (e.code || e.message)); return; }
  }
  toast(`Checking ${list.length} job${list.length === 1 ? "" : "s"} in Xero – the box checks every 5 min (6am–8pm).`); renderAdmin();
}
function bindXc(root, pool) { root.querySelectorAll("[data-xc]").forEach(b => b.onclick = e => { e.stopPropagation(); e.preventDefault();
  const j = (pool || []).find(x => x.id === b.dataset.xc) || (ui.done || []).find(x => x.id === b.dataset.xc); if (j) checkXero([j]); }); }
// Completed screen: Completed (default) or Unsuccessful, newest first, grouped by day. Uses the 6-week window plus
// every Done job (ui.done, any date) so older completions are still listed.
function completedView(all) {
  const kind = ui.cq === "Unsuccessful" ? "Unsuccessful" : "Completed", t = ui.q.toLowerCase();
  const m = new Map(); for (const j of [...all, ...(ui.done || [])]) if (!m.has(j.id)) m.set(j.id, j);
  const pool = [...m.values()].filter(j => (!ui.typeF || j.type === ui.typeF) && matchQ(j));
  const cnt = k => pool.filter(j => queueOf(j) === k).length;
  const list = pool.filter(j => queueOf(j) === kind).sort((a, b) => ((b.date || "") + (b.time || "")).localeCompare((a.date || "") + (a.time || "")));
  const xc = canXero() && kind === "Completed"; ui.xcList = xc ? list : [];
  return `<div class="sm-head"><h1>${kind} jobs</h1>${xc && list.length ? `<button id="xcall" class="sm-btn xero" title="Read-only: looks each job up in Xero. Nothing is created or changed in Xero.">Check all in Xero (${list.length})</button>` : ""}</div>${searchBar()}
    <div class="qtabs">${["Completed", "Unsuccessful"].map(k => `<button data-cq="${k}" class="${QCLS[k]} ${kind === k ? "on" : ""}"><span class="qdot ${QCLS[k]}"></span>${k} <span>${cnt(k)}</span></button>`).join("")}</div>
    <table class="jt"><thead><tr><th></th><th>Job #</th><th>Client / Site</th><th>Description</th><th>Scheduled</th><th>Staff</th><th>Status</th>${xc ? "<th>Xero</th>" : ""}</tr></thead>
    <tbody>${groupByDate(list).map(([d, js]) => `<tr class="dayhdr"><td colspan="${xc ? 8 : 7}">${esc(d ? dayLabel(d) : "No date")} <span class="cnt">${js.length}</span></td></tr>${js.map(j => xc ? jobRow(j).replace(/<\/tr>$/, `<td>${xcCell(j)}</td></tr>`) : jobRow(j)).join("")}`).join("") || `<tr><td colspan="7" class="muted pad">No ${kind.toLowerCase()} jobs</td></tr>`}</tbody></table>`;
}
function rowsFor(all) {
  const rows = staff.map(s => ({ key: skey(s), name: label(s.name), raw: s.name }));
  rows.push({ key: "_none", name: "Unallocated", raw: null });
  const has = (j, r) => r.raw ? namesOf(j).map(x => x.toLowerCase()).includes(r.raw.toLowerCase()) : !namesOf(j).length;
  return rows.map(r => ({ ...r, has: j => has(j, r) }));
}
function dispatchView(all) {
  if (PHONE.matches) return mobileDispatch(all);
  const t0 = todayStr(), wk0 = addDays(addDays(t0, -dowMon(t0)), 7 * ui.wk);
  const dayD = addDays(t0, ui.wk);
  const days = ui.dview === "week" ? [...Array(7)].map((_, i) => addDays(wk0, i)) : [dayD];
  const sched = all.filter(j => j.date && queueOf(j) !== "Unsuccessful");
  const rows = rowsFor(all);
  const chip = j => `<div class="dchip ${QCLS[queueOf(j)]} t-${j.type} ${j.status === "In progress" ? "inprog" : ""}" draggable="true" data-id="${j.id}" title="${esc(j.client)} – ${esc(j.description)}">${ipTop(j, "sm")}
      <b>${esc(j.time || "")}</b> ${esc((j.address || "").split(",")[0])}<div class="sub">${esc(TYPES[j.type] || "")} · #${esc(jobNo(j))}</div></div>`;
  let grid;
  if (ui.dview === "week") {
    grid = `<div class="dgrid" style="grid-template-columns:150px repeat(7,minmax(0,1fr))"><div class="dh"></div>${days.map(d => `<div class="dh ${d === t0 ? "today" : ""}">${shortDate(d)}</div>`).join("")}
      ${rows.map(r => `<div class="dname">${esc(r.name)}</div>${days.map(d => `<div class="dcell drop ${d === t0 ? "today" : ""}" data-date="${d}" data-staff="${esc(r.key)}">
        ${sched.filter(j => j.date === d && r.has(j)).sort((a, b) => (a.time || "").localeCompare(b.time || "")).map(chip).join("")}</div>`).join("")}`).join("")}</div>`;
  } else {
    const hrs = [...Array(13)].map((_, i) => 6 + i);
    grid = `<div class="dgrid" style="grid-template-columns:150px repeat(13,minmax(0,1fr))"><div class="dh"></div>${hrs.map(h => `<div class="dh">${h > 12 ? h - 12 + "pm" : h + (h === 12 ? "pm" : "am")}</div>`).join("")}
      ${rows.map(r => `<div class="dname">${esc(r.name)}</div>${hrs.map(h => `<div class="dcell drop" data-date="${dayD}" data-hour="${h}" data-staff="${esc(r.key)}">
        ${sched.filter(j => j.date === dayD && r.has(j) && parseInt(j.time || "7") === h).map(chip).join("")}</div>`).join("")}`).join("")}</div>`;
  }
  return `<div class="sm-head"><h1>Dispatch Board</h1>
      <div class="seg"><button data-dv="day" class="${ui.dview === "day" ? "on" : ""}">Day</button><button data-dv="week" class="${ui.dview === "week" ? "on" : ""}">Week</button></div>
      <button class="sm-btn" data-wk="-1">‹</button><button class="sm-btn" data-wk="0">Today</button><button class="sm-btn" data-wk="1">›</button>
      <span class="drange">${ui.dview === "week" ? shortDate(days[0]) + " – " + shortDate(days[6]) : dayLabel(dayD)}</span>
      <button type="button" class="sm-btn route-open" id="optorder">Optimise order</button>
      <button id="new" class="sm-btn primary">+ New Job</button></div>
    <div class="dwrap"><div class="dboard"><p class="touchhint">Tap a job to open it. Press and hold a job to move it to another day or staff member.</p><div class="dgrid-scroll">${grid}</div><p class="sub muted">Drag a job to another day or staff member to reschedule (saved in the app, sent to ServiceM8 by the next sync).</p></div>
      </div>`;
}
// Floating "Done today" card (dispatch board + job list). Today = Brisbane date of completedAt (fallback: job date when
// there is no completion stamp). Live via the Done-jobs snapshot. Collapsed state remembered on this device.
const tsDay = v => { if (v == null) return null; const d = v.toDate ? v.toDate() : new Date(v); return isNaN(d) ? null : ymd(d); };
function doneToday() {
  const t = todayStr(), m = new Map();
  for (const j of [...(ui.done || []), ...jobs.filter(x => x.status === "Done")]) {
    if (j.status !== "Done" || m.has(j.id)) continue;
    const cd = j.completedAt === null ? t : tsDay(j.completedAt);        // null = our own pending server timestamp
    if (cd ? cd === t : j.date === t) m.set(j.id, j);
  }
  const ms = j => j.completedAt?.toMillis?.() ?? (j.completedAt === null ? Date.now() : 0);
  return [...m.values()].sort((a, b) => ms(b) - ms(a));
}
// Parallel private Storage mirror. Email and receiptChunks stay until a reviewed cutover.
// Failures here must not block the existing queue. Tenant comes from the profile, not the page.
function cloudMembership() {
  if (!me) return { ok: false, reason: "no-membership" };
  return resolveMembership({ uid: me.uid, profile: me.cloudProfile || null });
}
function b64ToBlob(b64, type) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
async function mirrorJobPhotos(j, files) {
  const at = galleryNow();
  let plan = planJobPhotoMirrors({
    membership: cloudMembership(), job: j,
    files: files.map((f, i) => ({
      name: f.name, type: f.type || "image/jpeg", size: f.size || 1,
      photoId: (`p${i}${Math.random().toString(36).slice(2, 10)}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 41),
    })),
  });
  if (!plan.ok) { console.warn("cloud photo mirror skipped", (plan.skipped || []).map(s => s.reason).join(",") || "none"); return; }
  plan = stampExpiresAfter(plan, j, at);
  await putPlanned(plan, target => uploadBytes(storageRef(storage, target.path), files[target.sourceIndex], {
    contentType: target.contentType, customMetadata: target.metadata,
  }));
  // Not a retention anchor, including on a completed job. Listing still uses the
  // job's completion or existing activity date. This only asks other open phones to list again.
  updateDoc(doc(db, "jobs", j.id), { cloudPhotosAt: at.toISOString() }).catch(e => console.warn("cloud photo stamp not saved", e.code || e.message));
  await ensurePhotoList(j, true);
  paintPhotoSlots();
}
function galleryNow() {
  const pin = typeof window !== "undefined" ? window.HW_TODAY : "";
  if (typeof pin === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pin)) return new Date(pin + "T12:00:00+10:00");
  return new Date();
}
function photoMark(j) { return String(j && j.cloudPhotosAt || "") + "|" + String(j && j.photosEmailedAt || ""); }
function rememberJob(j) { if (j && j.id) ui.photoJobs[j.id] = j; }
function findJob(id) {
  return [...(jobs || []), ...(ui.done || []), ...(ui.undated || [])].find(j => j.id === id) || ui.photoJobs[id] || null;
}
async function loadJobPhotoListing(j) {
  const prefix = jobPhotoPrefix(cloudMembership(), j);
  if (!prefix.ok) return { ok: false, reason: prefix.reason };
  const listed = await listAll(storageRef(storage, prefix.prefix));
  const rows = [];
  for (const itemRef of listed.items || []) {
    const path = itemRef.fullPath || itemRef.path;
    try {
      const meta = await getMetadata(itemRef);
      rows.push({ path, contentType: meta.contentType || "", customMetadata: meta.customMetadata || {}, size: meta.size, timeCreated: meta.timeCreated || null });
    } catch (e) {
      rows.push({ path, error: e });
    }
  }
  return summarizePhotoListing(rows);
}
function ensurePhotoList(j, force) {
  if (!j?.id) return Promise.resolve();
  const mark = photoMark(j);
  const row = ui.photoLists[j.id];
  if (!force && row && row.mark === mark && row.status === "ready") return Promise.resolve(row);
  if (!force && row && row.mark === mark && row.status === "loading" && row.pending) return row.pending;
  const seq = (row?.seq || 0) + 1;
  ui.photoLists[j.id] = { status: "loading", count: row?.count || 0, mark, seq, error: "" };
  const pending = loadJobPhotoListing(j).then(res => {
    if (ui.photoLists[j.id]?.seq !== seq) return;
    const current = findJob(j.id) || j;
    if (!res.ok) ui.photoLists[j.id] = { status: "error", count: 0, mark: photoMark(current), seq, error: res.reason || "error" };
    else {
      const gallery = buildJobGallery({ membership: cloudMembership(), job: current, listing: res.items, now: galleryNow() });
      ui.photoLists[j.id] = {
        status: gallery.ok ? "ready" : "error", count: gallery.ok ? gallery.photos.length : 0,
        mark: photoMark(current), seq, gallery: gallery.ok ? gallery : null, error: gallery.ok ? "" : (gallery.reason || "error"),
      };
    }
    paintPhotoSlots();
  }).catch(e => {
    if (ui.photoLists[j.id]?.seq !== seq) return;
    ui.photoLists[j.id] = { status: "error", count: 0, mark, seq, error: storageErrorCode(e) };
    paintPhotoSlots();
  });
  ui.photoLists[j.id].pending = pending;
  paintPhotoSlots();
  return pending;
}
function watchJobPhotos(j) {
  return ensurePhotoList(j).then(() => { paintPhotoSlots(); });
}
function paintPhotoSlots() {
  if (ui.photoObserver) ui.photoObserver.disconnect();
  document.querySelectorAll("[data-photoslot]").forEach(el => {
    const id = el.dataset.photoslot;
    const row = ui.photoLists[id];
    const photos = (row?.gallery?.photos || []).map(p => ({
      path: p.path,
      thumb: ui.photoThumbs[p.path] || "",
      failed: !!ui.photoErrors?.[p.path],
      error: ui.photoErrors?.[p.path] || "",
    }));
    el.innerHTML = photoSlotHtml({
      jobId: id, status: row?.status || "loading", count: row?.count || 0,
      role: el.dataset.photorole || "both", variant: el.dataset.photovariant === "sm" ? "sm" : "phone",
      iconHtml: el.dataset.photovariant === "sm" ? "" : ICO.photos,
      error: row?.error || "",
      emailedCount: Number(findJob(id)?.photosEmailedCount) || 0,
      photos, retentionText: row?.gallery?.retentionText || "",
    });
    el.dataset.settled = row && row.status && row.status !== "loading" ? "1" : "";
    el.querySelectorAll("button.pth[data-photo-path]").forEach(b => b.onclick = ev => {
      ev.preventDefault(); ev.stopPropagation();
      const job = findJob(id); if (job) openPhotoLightbox(job, b.dataset.photoPath);
    });
    el.querySelectorAll("[data-photoretry]").forEach(b => b.onclick = ev => {
      ev.preventDefault(); ev.stopPropagation();
      const job = findJob(b.dataset.photoretry); if (job) ensurePhotoList(job, true).then(() => paintPhotoSlots());
    });
  });
  queuePhotoThumbs();
}
function photoObserver() {
  if (ui.photoObserver) return ui.photoObserver;
  if (typeof IntersectionObserver !== "function") return null;
  ui.photoObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      ui.photoObserver.unobserve(entry.target);
      const img = entry.target.querySelector?.("img[data-photo-path]") || entry.target;
      loadThumb(img);
    }
  }, { root: null, rootMargin: "600px 0px" });
  return ui.photoObserver;
}
function queuePhotoThumbs(root) {
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll("button.pth[data-photo-path]").forEach(btn => {
    const img = btn.querySelector("img[data-photo-path]");
    if (!img || img.getAttribute("src") || btn.closest("[hidden]")) return;
    const io = photoObserver();
    if (io) io.observe(btn);
    else loadThumb(img);
  });
}
async function blobForPhoto(path) {
  if (ui.photoBlobs[path]) return ui.photoBlobs[path];
  const blob = await getBlob(storageRef(storage, path));
  ui.photoBlobs[path] = blob;
  if (!ui.photoUrls[path]) ui.photoUrls[path] = URL.createObjectURL(blob);
  return blob;
}
async function thumbUrlFor(path) {
  if (ui.photoThumbs[path]) return ui.photoThumbs[path];
  const blob = await blobForPhoto(path);
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" }).catch(() => null);
  if (!bmp) {
    ui.photoThumbs[path] = ui.photoUrls[path];
    return ui.photoThumbs[path];
  }
  const edge = Math.max(bmp.width, bmp.height) || 1;
  const k = Math.min(1, 320 / edge);
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const out = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.72));
  ui.photoThumbs[path] = URL.createObjectURL(out || blob);
  return ui.photoThumbs[path];
}
function loadThumb(img) {
  const path = img && img.dataset.photoPath;
  if (!path) return Promise.resolve();
  const paint = src => {
    if (!src) return;
    document.querySelectorAll("img[data-photo-path]").forEach(el => {
      if (el.dataset.photoPath !== path) return;
      el.hidden = false;
      el.src = src;
    });
  };
  if (ui.photoThumbs[path]) { paint(ui.photoThumbs[path]); return Promise.resolve(); }
  if (!ui.photoThumbTasks[path]) {
    ui.photoThumbTasks[path] = thumbUrlFor(path).catch(e => {
      const code = storageErrorCode(e);
      ui.photoErrors = ui.photoErrors || {};
      ui.photoErrors[path] = code;
      document.querySelectorAll("button.pth").forEach(btn => {
        if (btn.dataset.photoPath !== path) return;
        btn.disabled = true;
        btn.classList.add("perr");
        btn.textContent = photoFailureText(code);
      });
      return "";
    });
  }
  return ui.photoThumbTasks[path].then(paint);
}
function photoCaption(j, path) {
  const meta = ui.photoLists[j.id]?.gallery?.photos?.find(p => p.path === path);
  if (meta?.timeCreated) {
    const d = new Date(meta.timeCreated);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString("en-AU", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
  }
  return "Job photo";
}
function lightboxHost() {
  return document.querySelector("dialog[open]") || document.body;
}
async function openPhotoLightbox(j, path, index) {
  const photos = ui.photoLists[j.id]?.gallery?.photos || [];
  if (!photos.length || !j) return;
  let i = Number.isInteger(index) ? index : photos.findIndex(p => p.path === path);
  if (i < 0) i = 0;
  i = ((i % photos.length) + photos.length) % photos.length;
  const photo = photos[i];
  let src = "";
  let caption = photoCaption(j, photo.path);
  try {
    await blobForPhoto(photo.path);
    src = ui.photoUrls[photo.path] || "";
  } catch (e) {
    caption = photoFailureText(storageErrorCode(e));
  }
  const host = lightboxHost();
  host.querySelectorAll(".pview").forEach(node => node.remove());
  const wrap = document.createElement("div");
  wrap.innerHTML = lightboxHtml({ src, caption, closeHtml: "×", index: i, count: photos.length });
  const el = wrap.firstElementChild;
  el.dataset.jobId = j.id;
  el.dataset.index = String(i);
  host.appendChild(el);
  wireLightbox(el, j);
  el.focus();
}
function wireLightbox(el, j) {
  const close = () => { if (el.isConnected) el.remove(); };
  const step = delta => openPhotoLightbox(j, null, (Number(el.dataset.index) || 0) + delta);
  el.querySelector(".px").onclick = ev => { ev.preventDefault(); ev.stopPropagation(); close(); };
  el.querySelector(".pp")?.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); step(-1); });
  el.querySelector(".pn")?.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); step(1); });
  let x0 = null;
  el.addEventListener("touchstart", ev => { x0 = ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0].clientX : null; }, { passive: true });
  el.addEventListener("touchend", ev => {
    if (x0 == null || !ev.changedTouches || !ev.changedTouches[0]) return;
    const dx = ev.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) < 48) return;
    step(dx < 0 ? 1 : -1);
  }, { passive: true });
  el.addEventListener("keydown", ev => {
    if (ev.key === "ArrowRight") { ev.preventDefault(); step(1); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); step(-1); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); }
  });
  const dlg = el.closest("dialog");
  if (dlg) dlg.addEventListener("cancel", ev => { if (!el.isConnected) return; ev.preventDefault(); close(); });
}
async function downloadGalleryCopy(j) {
  const gallery = ui.photoLists[j.id]?.gallery;
  if (!gallery?.ok) return toast("Couldn't build the download.");
  const blobs = {};
  for (const p of gallery.photos) {
    const blob = await blobForPhoto(p.path);
    blobs[p.path] = new Uint8Array(await blob.arrayBuffer());
  }
  return downloadCloudCopy(j, galleryExportPhotos(gallery, blobs, j));
}
function mirrorReceipt(receiptId, b64, job, written) {
  const blob = b64ToBlob(b64, "image/jpeg");
  const plan = planStaffReceiptCapture({
    membership: cloudMembership(), job, receiptId, receiptDoc: written,
    file: { type: "image/jpeg", size: blob.size || 1, name: "original.jpg" },
  });
  if (!plan.ok) { console.warn("cloud receipt mirror skipped", plan.reason); return Promise.resolve(); }
  return uploadBytes(storageRef(storage, plan.storage.path), blob, {
    contentType: plan.storage.contentType, customMetadata: plan.storage.metadata,
  });
}
function cloudRetentionHtml(j) {
  if (!me || me.role !== "admin") return "";
  const view = retentionView(j, new Date());
  return `<p class="sub cloudret">${esc(retentionAdminText(view))} <button type="button" class="sm-btn" id="cloudexport">Download cloud copy</button></p>`;
}
function cloudExpiryNotice(all) {
  if (!me || me.role !== "admin") return "";
  const seen = new Set();
  const pool = [...(all || []), ...(ui.done || [])].filter(j => j && j.id && !seen.has(j.id) && seen.add(j.id));
  const now = new Date();
  let soon = 0, due = 0;
  for (const j of pool) {
    const view = retentionView(j, now);
    if (view.warning) soon += 1;
    else if (view.due && view.state !== "held" && view.state !== "purged") due += 1;
  }
  if (!soon && !due) return "";
  return `<p class="sub cloudret">Cloud copies: ${soon ? soon + " expiring within 14 days. " : ""}${due ? due + " past the 3-month operational window. " : ""}Deletion is not scheduled. Invoices, GST and Xero records are not part of that deletion. Accounting records are normally kept 5 years.</p>`;
}
async function downloadCloudCopy(j, photos) {
  const built = buildOperationalExport({ membership: cloudMembership(), scope: "job", jobId: j.id, jobs: [j], photos: photos || [], now: galleryNow() });
  if (!built.ok) return toast(built.reason === "not-authorised" ? "Only an admin can download the cloud copy." : "Couldn't build the download.");
  const blob = new Blob([built.zip], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = built.filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast("Downloaded operational copy. Invoices and Xero records are not in the zip.");
}
// ---- Receipts: worker photo + amount -> receipts/{id} + receiptChunks (base64 JPEG, kept until cutover).
// The box (tools/receipts_worker.py, cron every 2 min) emails it from Alex's account to his Hubdoc email-in address,
// records personally-paid ones in reimbursements/ (owner only) and notifies Alex. Workers only see their own Queued/Filed.
const OWNER_UID = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const isOwner = () => me && me.uid === OWNER_UID;
// Who sees anything Xero (profit chart, Send to Xero, Xero labels/wording). Explicit list, NOT the admin role, so future
// staff (even admins) see no Xero unless added here AND in firestore.rules xeroUser(). Alex, Patrick.
const XERO_UIDS = [OWNER_UID, "R7t41e54Ykcdk9WPdVZnDd697iI2"];
const canXero = () => !!me && XERO_UIDS.includes(me.uid);
// Money ($ PO/invoice/receipt/profit amounts): admins + users/{uid}.role "supervisor". Operators (staff) see none in the UI.
// App roles on users/{uid}: "operator" (staff) | "supervisor" (sees money, still operator shell unless also Firebase-admin).
const canSeeMoney = () => !!me && (me.role === "admin" || me.role === "supervisor" || me.staffRole === "supervisor");
const canInvite = () => !!(me && (me.role === "admin" || me.role === "supervisor" || me.staffRole === "supervisor"));
// Quotes: same people who see money (admins + users.role/staffRole supervisor). Ordinary staff: no Quotes nav or dollars.
const canQuote = () => canSeeMoney();
// Business quote rates (meta/quoteRates): admin edit only — supervisors can read/use rates while quoting, not change them.
const canEditQuoteRates = () => !!(me && me.role === "admin");
async function shrinkImage(file, max = 1600, q = 0.72) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error("Can't read that image - try a JPEG/PNG photo");
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q).split(",")[1];
}
function receiptDialog(j) {
  const jn = j ? String(jobNo(j) || "") : "";
  let d = $("#rdlg"); if (!d) { d = document.createElement("dialog"); d.id = "rdlg"; d.className = "rdlg"; document.body.appendChild(d); }
  d.innerHTML = `<form id="rf" method="dialog"><h3>🧾 Upload receipt${jn ? ` · Job #${esc(jn)}` : ""}</h3>${j ? `<div class="sub">${esc(j.address || "")}</div>` : ""}
    <label class="rphoto">Photo of the receipt<input name="photo" type="file" accept="image/*" capture="environment" required></label>
    <div class="row"><label>Amount $ (inc GST)<input name="amt" type="number" step="0.01" min="0" inputmode="decimal" required></label>
      <label>Job # (optional)<input name="job" inputmode="numeric" placeholder="e.g. 697" value="${esc(jn)}" ${j ? "readonly" : ""}></label></div>
    <label>Supplier / what it was for<input name="sup" required placeholder="e.g. Bunnings - silt fence"></label>
    <label class="ck"><input type="checkbox" name="mine" checked> I paid for this myself (reimburse me)</label>
    <p id="rerr" class="err"></p>
    <div class="btns"><button value="cancel" formnovalidate class="sm-btn">Close</button><button value="send" class="sm-btn primary" id="rsend">Upload</button></div>
    <h4>My recent receipts</h4><div id="rmine" class="sub">Loading…</div></form>`;
  d.showModal();
  const f = $("#rf"), mine = $("#rmine");
  getDocs(query(collection(db, "receipts"), where("uid", "==", me.uid))).then(sn => {
    const L = sn.docs.map(x => ({ id: x.id, ...x.data() })).sort((a, b) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || ""))).slice(0, 8);
    mine.innerHTML = L.map(r => `<div class="rrow"><span>${esc(String(r.createdAtIso || "").slice(0, 10))} · ${esc(r.supplier || "")} · ${$$(r.amountInc || 0)}</span>
      <span class="qpill ${r.status === "filed" ? "q-comp" : ""}">${r.status === "filed" ? "Filed" : "Queued"}</span></div>`).join("") || "None yet.";
  }).catch(e => { mine.textContent = "Receipts not available yet (" + (e.code || e.message) + ")"; });
  f.onsubmit = async ev => {
    if (ev.submitter?.value !== "send") return; ev.preventDefault();
    const file = f.photo.files[0], amt = Math.round(+f.amt.value * 100) / 100;
    if (!file || !(amt > 0) || !f.sup.value.trim()) { $("#rerr").textContent = "Photo, amount and supplier are needed."; return; }
    $("#rsend").disabled = true; $("#rsend").textContent = "Uploading…";
    try {
      const b64 = await shrinkImage(file), CH = 700000, n = Math.ceil(b64.length / CH);
      const ref = doc(collection(db, "receipts"));
      for (let i = 0; i < n; i++) await setDoc(doc(db, "receiptChunks", `${ref.id}_${i}`), { rid: ref.id, i, uid: me.uid, data: b64.slice(i * CH, (i + 1) * CH) });
      const written = { id: ref.id, uid: me.uid, jobId: j ? j.id : null, status: "queued" };
      await setDoc(ref, { uid: me.uid, workerName: me.name, amountInc: amt, supplier: f.sup.value.trim(), paidPersonally: f.mine.checked,
        jobNo: f.job.value.trim().replace(/^#/, "") || null, jobId: written.jobId, address: j ? (j.address || null) : null, chunks: n, mime: "image/jpeg", bytes: Math.round(b64.length * 0.75),
        status: "queued", createdAt: serverTimestamp(), createdAtIso: new Date().toISOString() });
      d.close(); toast("Receipt uploaded - queued for Hubdoc"); if (j) loadJobReceipts(j);
      mirrorReceipt(ref.id, b64, j || null, written).catch(e => console.warn("cloud receipt mirror", e && (e.code || e.message) || e));
    } catch (e) { $("#rerr").textContent = "Not uploaded: " + (e.code || e.message); $("#rsend").disabled = false; $("#rsend").textContent = "Upload"; }
  };
}
// Job card: Upload receipt + that job's receipts. Workers see their own; Alex sees all (rules enforce the same).
const jobReceiptsHtml = j => `<h4>Receipts</h4><button type="button" class="sm-btn" id="jrcbtn">🧾 Upload receipt</button><div id="jrc" class="jrc sub">Loading…</div>`;
async function loadJobReceipts(j) {
  const box = $("#jrc"); if (!box) return;
  try {
    const qs = isOwner() ? query(collection(db, "receipts"), where("jobId", "==", j.id)) : query(collection(db, "receipts"), where("jobId", "==", j.id), where("uid", "==", me.uid));
    const L = (await getDocs(qs)).docs.map(x => ({ id: x.id, ...x.data() })).sort((a, b) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || "")));
    if ($("#jrc") !== box) return;
    box.innerHTML = L.map(r => `<div class="rrow"><span>🧾 ${esc(String(r.createdAtIso || "").slice(0, 10))} · <b>${$$(r.amountInc || 0)}</b> · ${esc(r.supplier || "")}${isOwner() ? ` · ${esc(r.workerName || "")}${r.paidPersonally ? " (to reimburse)" : ""}` : ""}</span>
      <span class="qpill ${r.status === "filed" ? "q-comp" : ""}">${r.status === "filed" ? "Filed" : "Queued"}</span></div>`).join("") || "No receipts on this job yet.";
  } catch (e) { box.textContent = "Receipts not available yet (" + (e.code || e.message) + ")"; }
}
function wireJobReceipts(j) { const b = $("#jrcbtn"); if (!b) return; b.onclick = () => receiptDialog(j); loadJobReceipts(j); }
function reimbView() {
  if (!isOwner()) return `<div class="sm-head"><h1>Reimbursements</h1></div><p class="muted pad">Owner only.</p>`;
  const L = ui.reimb || [], open = L.filter(r => !r.paid), by = {};
  for (const r of open) (by[r.workerName || "?"] ||= []).push(r);
  const hd = ui.hubdocCfg?.email || "";
  return `<div class="sm-head"><h1>Reimbursements</h1><span class="sub">Owed to workers for receipts they paid personally (owner only)</span></div>
    <div class="filters"><label>Hubdoc email-in address <input id="hdmail" value="${esc(hd)}" placeholder="yourname.xxxx@app.hubdoc.com" size="34"></label>
      <button id="hdsave" class="sm-btn">Save</button><span class="sub">${hd ? "Receipts are emailed here from alex@heartwoodew.com." : "<b>Not set</b> - receipts stay queued until it is."}</span></div>
    ${Object.keys(by).length ? Object.entries(by).map(([w, rs]) => `<h3>${esc(w)} · owed <b>${$$(rs.reduce((t, r) => t + (+r.amountInc || 0), 0))}</b> inc GST (${rs.length})</h3>
      <table class="jt"><thead><tr><th>Date</th><th>Supplier / for</th><th>Job</th><th>Amount</th><th>Hubdoc</th><th></th></tr></thead><tbody>${rs.map(r => `<tr data-rb="${esc(r.id)}">
        <td>${esc(String(r.date || "").slice(0, 10))}</td><td>${esc(r.supplier || "")}</td><td>${r.jobNo ? "#" + esc(r.jobNo) : ""}</td><td>${$$(r.amountInc || 0)}</td>
        <td><span class="qpill ${r.hubdocStatus === "filed" ? "q-comp" : ""}">${r.hubdocStatus === "filed" ? "Filed" : "Queued"}</span></td>
        <td><button class="sm-btn rbpaid">Mark paid</button></td></tr>`).join("")}</tbody></table>`).join("") : `<p class="muted pad">Nothing owed.</p>`}
    <p class="sub">Paid: ${L.filter(r => r.paid).length} entr${L.filter(r => r.paid).length === 1 ? "y" : "ies"} (${$$(L.filter(r => r.paid).reduce((t, r) => t + (+r.amountInc || 0), 0))}).</p>`;
}
function bindReimb(A) {
  if (!isOwner()) return;
  if (!ui.reimbSub) {
    ui.reimbSub = onSnapshot(collection(db, "reimbursements"), s => { ui.reimb = s.docs.map(x => ({ id: x.id, ...x.data() })); if (ui.view === "reimb") renderAdmin(); },
      e => toast("Reimbursements not available: " + (e.code || e.message)));
    getDoc(doc(db, "ownerSettings", "hubdoc")).then(x => { ui.hubdocCfg = x.data() || {}; if (ui.view === "reimb") renderAdmin(); }).catch(() => {});
  }
  if ($("#hdsave")) $("#hdsave").onclick = async () => { const v = $("#hdmail").value.trim().toLowerCase();
    if (v && !/^[a-z0-9._+-]+@app\.hubdoc\.com$/.test(v)) return toast("Hubdoc addresses end in @app.hubdoc.com");
    try { await setDoc(doc(db, "ownerSettings", "hubdoc"), { email: v || null, updatedAt: serverTimestamp() }); ui.hubdocCfg = { email: v }; toast("Saved"); renderAdmin(); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); } };
  A.querySelectorAll(".rbpaid").forEach(b => b.onclick = async () => { const id = b.closest("[data-rb]").dataset.rb;
    if (!armBtn(b, "Mark paid", "Tap again: paid")) return;
    try { const at = new Date().toISOString(); await updateDoc(doc(db, "reimbursements", id), { paid: true, reimbursed: true, paidAt: at, reimbursedAt: at, reimbursedBy: me.uid, reimbursedByName: me.name }); toast("Marked paid"); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); } });
}
function donePill() {
  let el = $("#donepill");
  const show = me && me.role === "admin" && !ui.myJobs && (ui.view === "dispatch" || ui.view === "jobs");
  let fw = $("#fabwrap");
  if (!show) { if (fw) fw.remove(); return; }
  if (!fw) { fw = document.createElement("div"); fw.id = "fabwrap"; fw.className = "fabwrap";
    document.body.appendChild(fw); }
  if (!el) { el = document.createElement("div"); el.id = "donepill"; fw.appendChild(el); }
  const L = doneToday(), open = localStorage.getItem("hwDonePill") === "open";
  const amt = j => j.invoiceAmount ?? j.poAmount ?? null, known = L.filter(j => amt(j) != null);
  const tot = known.reduce((t, j) => t + +amt(j), 0);
  const who = j => j.completedByName || (namesOf(j).join(", ") || "—");
  el.className = "donepill" + (open ? " open" : "");
  el.innerHTML = `<button type="button" class="dp-head" aria-expanded="${open}"><span class="dp-tick">✓</span> <b>${L.length}</b> done today${canSeeMoney() && known.length ? ` · ${$$(tot)}` : ""}<span class="dp-car">${open ? "▾" : "▴"}</span></button>
    ${open ? `<div class="dp-body">${L.map(j => `<button type="button" class="dp-row" data-dp="${esc(j.id)}"><span class="dp-no">#${esc(jobNo(j))}</span>
      <span class="dp-main"><b>${esc(tidyAddress(j.address || "").split(",")[0])}</b> · ${esc(TYPES[j.type] || firstLine(j.description || ""))}<small>${esc(who(j))}</small></span>
      <span class="dp-amt">${canSeeMoney() && amt(j) != null ? $$(amt(j)) : ""}</span></button>`).join("") || `<p class="sub pad">Nothing completed yet today.</p>`}
      ${canSeeMoney() ? `<div class="dp-foot sub">Total ex GST ${$$(tot)}${known.length < L.length ? ` (${L.length - known.length} without a PO/invoice amount)` : ""}</div>` : ""}</div>` : ""}`;
  el.querySelector(".dp-head").onclick = () => { localStorage.setItem("hwDonePill", open ? "closed" : "open"); donePill(); };
  el.querySelectorAll("[data-dp]").forEach(b => b.onclick = () => { const j = L.find(x => x.id === b.dataset.dp); if (j) editJob(j); });
}
// ---- Timesheets: timesheets/{uid}_{weekStart}. The week document is unchanged for accounts.
// Clock on / clock off adds one entry per shift, with a server timestamp and one GPS fix at that tap.
// Manual shifts are labelled Manual and keep an edit trail. Alex still emails accounts; he alone marks Sent.
const ACCOUNTS_EMAIL = "accounts@heartwoodew.com";
const TS_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TS_CONSENT_KEY = "hwTsLocConsent";
const weekStartOf = s => { const d = new Date(s + "T00:00:00Z"); return addDays(s, -((d.getUTCDay() + 6) % 7)); };
const dmy = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "";
const tsDow = ds => TS_DAYS[(new Date(ds + "T00:00:00Z").getUTCDay() + 6) % 7];
function tsHours(d) { return shiftHours(d); }
const tsTotal = days => Math.round(Object.values(days || {}).reduce((t, d) => t + shiftHours(d), 0) * 100) / 100;
const hrs = h => (Math.round((+h || 0) * 100) / 100).toFixed(2).replace(/\.?0+$/, "") + " h";
function tsWeek() { ui.tsWs = ui.tsWs || weekStartOf(todayStr()); return ui.tsWs; }
function tsIsAdminSheet() { return !!(me && me.role === "admin" && !ui.myJobs && ui.view === "timesheet"); }
function tsStop() {
  ui.tsSub?.(); ui.tsSub = null; ui.tsSubWs = null; ui.tsAll = null; ui.tsAllWs = null;
  ui.tsWatch?.(); ui.tsWatch = null; ui.tsWatchId = null; ui.tsMine = undefined;
  ui.tsPrev = null; ui.tsPrevFor = "";
  ui.tsEdit = null; ui.tsDirty = false; ui.tsBusy = false; ui.tsAsk = null;
}
function tsSnapshotBlocked() {
  if (ui.tsBusy || ui.tsAsk || (ui.tsMachineShift && document.getElementById("tsmachine"))) return true;
  if ($("#dlg")?.open) return true;
  return !!((ui.tsDirty || ui.tsEdit) && ($("#tsman") || $("#tsf")));
}
function tsRerender() {
  ui.tsForce = true;
  try { if (ui.tsPaint) ui.tsPaint(); }
  finally { ui.tsForce = false; }
}
function tsWorkerReady() { return ui.tsWatchId === `${me.uid}_${tsWeek()}` && ui.tsMine !== undefined; }
function tsHasConsent(sheet) {
  let stored = false;
  try { stored = localStorage.getItem(TS_CONSENT_KEY) === "1"; } catch { /* private mode */ }
  const already = !!(sheet && sheet.locationConsentAt) || !!(ui.tsMine && ui.tsMine.locationConsentAt) || !!(ui.tsPrev && ui.tsPrev.locationConsentAt);
  return !needsLocationConsent({ stored, already });
}
function tsOwnSheet() {
  if (tsIsAdminSheet()) return (ui.tsAll || []).find(t => t.uid === me.uid) || null;
  return ui.tsMine || null;
}
function tsSheets() {
  const ws = tsWeek();
  const own = tsOwnSheet();
  const here = openClock(own?.entries);
  if (here) return { ws, sheet: own, entry: here, where: "view" };
  if (ws === weekStartOf(todayStr())) {
    const prev = openClock(ui.tsPrev?.entries);
    if (prev) return { ws: ui.tsPrev.weekStart, sheet: ui.tsPrev, entry: prev, where: "prev" };
  }
  return { ws, sheet: own, entry: null, where: "view" };
}
function tsNav() {
  const ws = tsWeek(), cur = ws === weekStartOf(todayStr());
  return `<div class="ts-nav"><button type="button" class="sm-btn" data-tsw="-7">‹</button><b>Mon ${dmy(ws)} – Sun ${dmy(addDays(ws, 6))}</b><button type="button" class="sm-btn" data-tsw="7">›</button>${cur ? "" : `<button type="button" class="sm-btn" data-tsw="0">This week</button>`}</div>`;
}
function tsWeekTotal(sheet) {
  return `<div class="ts-tot">Week total <b>${hrs(sheet ? sheetHours(sheet) : 0)}</b></div><p class="ts-privacy">A 30-minute lunch comes off each finished shift unless a break is entered.</p>`;
}
function tsFixLine(label, fix) {
  if (!fix) return "";
  const when = stampText(fix.at);
  const head = `${label}${when ? " " + when : ""}`;
  if (fix.fix === "no location") return `<p class="ts-loc">${esc(head)}: <b>no location</b></p>`;
  if (fix.fix !== "gps" || typeof fix.lat !== "number") return when ? `<p class="ts-stamp">${esc(head)}</p>` : "";
  const acc = accuracyText(fix);
  return `<p class="ts-loc">${esc(head)}: <a href="${esc(mapsHref(fix.lat, fix.lng))}" target="_blank" rel="noopener">Map</a> <span class="sub">${esc(coordText(fix))}${acc ? " · " + esc(acc) : ""}</span></p>`;
}
function tsAdjustedLine(raw, field, fix) {
  if (!editList(raw).length || !fix) return "";
  const hm = brisbaneHM(fix.at), cur = raw[field] || "";
  if (!hm || !cur || hm === cur) return "";
  return `<p class="ts-stamp">Adjusted to ${esc(ampm(cur))}. Original stamp ${esc(stampText(fix.at))} stays.</p>`;
}
function tsEntryCard(raw, canEdit) {
  const e = paidShift(raw) || raw;
  const badge = raw.source === "manual" ? `<span class="ts-badge manual">Manual</span>` : `<span class="ts-badge clock">Clocked</span>`;
  const day = e.date ? `${tsDow(e.date)} ${dmy(e.date).slice(0, 5)}` : "";
  const hours = shiftHours(e);
  const open = raw.source === "clock" && raw.status !== "closed";
  const span = `${e.start ? ampm(e.start) : "—"}${e.finish ? " – " + ampm(e.finish) : open ? " · still on" : ""}`;
  const br = e.breakStart && e.breakEnd ? `<p class="sub">Break ${esc(ampm(e.breakStart))} – ${esc(ampm(e.breakEnd))}</p>` : raw.status === "break" ? `<p class="sub">On break${e.breakStart ? " from " + esc(ampm(e.breakStart)) : ""}</p>` : "";
  const job = [e.job, e.note].filter(Boolean).join(" — ");
  const audit = raw.source === "manual" ? `<p class="sub">Entered by ${esc(raw.enteredByName || "")}${raw.enteredAt ? " · " + esc(stampText(raw.enteredAt)) : ""}</p>` : "";
  const edits = editList(raw).map(ed => `<p class="sub">Edited by ${esc(ed.byName || "")}${ed.at ? " · " + esc(stampText(ed.at)) : ""}${ed.summary ? " · " + esc(ed.summary) : ""}</p>`).join("");
  return `<article class="ts-entry">${badge}<div class="ts-dl"><b>${esc(day)}</b><span class="ts-h">${hours ? hrs(hours) : open ? "On" : ""}</span></div>
    <p class="ts-when">${esc(span)}</p>${br}${job ? `<p class="sub">${esc(job)}</p>` : ""}
    ${tsFixLine("Clocked on", raw.clockOn)}${tsAdjustedLine(raw, "start", raw.clockOn)}
    ${tsFixLine("Clocked off", raw.clockOff)}${tsAdjustedLine(raw, "finish", raw.clockOff)}
    ${tsFixLine("Break start", raw.breakOn)}${tsFixLine("Break end", raw.breakOff)}
    ${audit}${edits}
    ${tsMachineStatusHtml(raw)}
    ${canEdit ? `<button type="button" class="sm-btn tsedit" data-eid="${esc(raw.id)}">Edit</button>` : ""}</article>`;
}
function tsLegacyCards(sheet, canEdit) {
  if (!sheet) return "";
  const taken = new Set(entryList(sheet.entries).map(e => e.date));
  return TS_DAYS.map((n, i) => {
    const ds = addDays(sheet.weekStart || tsWeek(), i);
    if (taken.has(ds)) return "";
    const d = (sheet.days || {})[ds];
    if (!d || (!d.start && !d.finish && !d.note)) return "";
    const h = shiftHours(d);
    return `<article class="ts-entry"><span class="ts-badge week">Week hours</span><div class="ts-dl"><b>${n} ${dmy(ds).slice(0, 5)}</b><span class="ts-h">${h ? hrs(h) : ""}</span></div>
      <p class="ts-when">${esc(d.start ? ampm(d.start) : "—")}${d.finish ? " – " + esc(ampm(d.finish)) : ""}</p>
      ${d.note ? `<p class="sub">${esc(d.note)}</p>` : ""}
      ${canEdit ? `<button type="button" class="sm-btn tslegacy" data-legacy="${ds}">Edit as manual</button>` : ""}</article>`;
  }).join("");
}
function tsCards(sheet, canEdit) {
  const entries = sortedEntries(sheet?.entries).map(raw => tsEntryCard(raw, canEdit)).join("");
  const legacy = tsLegacyCards(sheet, canEdit);
  if (!entries && !legacy) return `<p class="sub">No shifts this week yet.</p>`;
  return entries + legacy;
}
function tsClockHtml() {
  if (tsIsAdminSheet()) { if (!(ui.tsAll && ui.tsAllWs === tsWeek())) return ""; }
  else if (!tsWorkerReady()) return "";
  if (ui.tsAsk) {
    const label = { on: "Agree and clock on", off: "Agree and clock off", "break-start": "Agree and start break", "break-end": "Agree and end break" }[ui.tsAsk] || "Agree and continue";
    return `<div class="ts-consent" role="dialog" aria-label="Location at clock on and clock off"><p>${esc(TS_CONSENT)}</p>
      <button type="button" class="ts-go on" id="tsagree">${label}</button>
      <button type="button" class="sm-btn" id="tsno">Not now</button></div>`;
  }
  const active = tsSheets();
  const cur = tsWeek() === weekStartOf(todayStr());
  if (!active.entry && !cur) return `<p class="ts-privacy">Clock on and clock off stay on the current week. <button type="button" class="sm-btn" data-tsw="0">This week</button></p>`;
  const e = active.entry ? paidShift(active.entry) : null;
  const where = active.where === "prev" ? " from last week" : "";
  const main = ui.tsBusy ? `<button type="button" class="ts-go" disabled>Checking location…</button>`
    : active.entry ? `<p class="ts-live">${active.entry.status === "break" ? "On break" : "Clocked on"}${where}${e.start ? " · " + esc(ampm(e.start)) : ""}</p>
        <button type="button" class="ts-go off" id="tsclockoff">Clock off</button>
        <div class="ts-break">${active.entry.status === "break" ? `<button type="button" class="ts-mini" id="tsbrkend">Break end</button>` : `<button type="button" class="ts-mini" id="tsbrk">Break start</button>`}</div>`
      : `<p class="ts-live">Not clocked on</p><button type="button" class="ts-go on" id="tsclockon">Clock on</button>`;
  return `<div class="ts-clock">${main}<p class="ts-privacy">Location is captured only when you tap Clock on, Clock off, Break start, or Break end.</p></div>`;
}
function tsTenant() {
  const m = cloudMembership();
  return m && m.ok && m.tenantId ? m.tenantId : "heartwood";
}
function tsShiftById(id) {
  if (!id) return null;
  const sheets = [tsOwnSheet(), ui.tsPrev];
  for (const sheet of sheets) {
    if (sheet && sheet.entries && sheet.entries[id]) return sheet.entries[id];
  }
  return null;
}
function tsEnsureFleet() {
  if (ui.tsFleetState) return;
  ui.tsFleetState = "loading";
  getDocs(collection(db, "tenants", tsTenant(), "fleet")).then(s => {
    ui.tsFleet = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(a => a && a.name).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    ui.tsFleetState = "ok";
    if (ui.tsMachineShift) tsRerender();
  }).catch(() => { ui.tsFleet = []; ui.tsFleetState = "absent"; if (ui.tsMachineShift) tsRerender(); });
}
function tsEnsurePrestarts() {
  if (ui.tsPrestartState) return;
  ui.tsPrestartState = "loading";
  getDocs(collection(db, "tenants", tsTenant(), "prestarts")).then(s => {
    ui.tsPrestarts = s.docs.map(d => ({ id: d.id, ...d.data() }));
    ui.tsPrestartState = "ok";
    tsRerender();
  }).catch(() => { ui.tsPrestarts = []; ui.tsPrestartState = "absent"; tsRerender(); });
}
function tsMachineHtml() {
  const entry = tsShiftById(ui.tsMachineShift);
  if (!ui.tsMachineShift || (entry && entry.machineChoice)) return "";
  if (entry && !machinePromptNeeded(entry, ui.tsMachineShift)) return "";
  tsEnsureFleet();
  const assets = ui.tsFleetState === "ok" ? (ui.tsFleet || []) : [];
  const buttons = assets.map(a => `<button type="button" class="ts-mini tsmach" data-asset="${esc(a.id)}" data-name="${esc(a.name)}">${esc(a.name)}${a.rego ? " · " + esc(a.rego) : ""}</button>`).join("");
  return `<div class="ts-machine" id="tsmachine"><p><b>Which machine are you on today?</b></p>
    ${ui.tsFleetState === "loading" ? `<p class="sub">Loading machines…</p>` : ""}
    <div class="ts-fleet">${buttons}<button type="button" class="ts-mini tsmach" data-asset="">No machine / other work</button>
    <button type="button" class="sm-btn" id="tsmachskip">Skip</button></div></div>`;
}
function tsMachineStatusHtml(entry) {
  if (!entry || !entry.machineChoice || entry.id === ui.tsMachineShift) return "";
  const label = entry.machineChoice === "asset" ? entry.machineName : entry.machineChoice === "none" ? "No machine / other work" : "Skipped";
  const line = `<p class="sub">Machine: ${esc(label || "Skipped")}</p>`;
  if (entry.machineChoice !== "asset" || !entry.machineId) return line;
  if (ui.tsPrestartState !== "ok" && ui.tsPrestartState !== "absent") { tsEnsurePrestarts(); return line; }
  const status = prestartStatus({ available: ui.tsPrestartState === "ok", records: ui.tsPrestarts, assetId: entry.machineId, day: entry.date || todayStr() });
  if (status.kind === "soon") return line + `<p class="ts-soon">Prestart coming soon</p>`;
  if (status.kind === "done") {
    const when = stampText(status.when) || "today";
    return line + `<p class="ts-prestart">Prestart done (${esc(when)}, ${esc(status.by || "someone")})</p>`;
  }
  return line + `<p class="ts-prestart">Prestart isn't done for this machine today.</p><button type="button" class="sm-btn tsprestart" data-asset="${esc(entry.machineId)}">Open prestart</button>`;
}
function tsOpenPrestart(assetId) {
  ui.prestartAsset = assetId;
  const admin = me.role === "admin" && !ui.myJobs;
  if (admin) { ui.view = "prestart"; ui.navOpen = false; renderAdmin(); }
  else { ui.opTab = "prestart"; renderOperator(); }
  const select = document.querySelector("#prestartform [name=assetId]");
  if (select) { select.value = assetId; select.dispatchEvent(new Event("change")); return; }
  if (!document.querySelector("#prestartform, [data-ctab=prestart]")) {
    ui.tsPrestartState = "absent";
    if (admin) { ui.view = "timesheet"; renderAdmin(); }
    else { ui.opTab = "hours"; renderOperator(); }
  }
}
async function tsChooseMachine(choice, asset) {
  const patch = machineChoicePatch(choice, asset);
  const id = ui.tsMachineShift;
  const ws = ui.tsMachineWs || tsWeek();
  if (!patch || !id) return;
  try {
    const sheet = await tsLoad(ws);
    const prev = sheet && sheet.entries && sheet.entries[id];
    if (!prev) { toast("You're clocked on. The machine list didn't save."); return; }
    if (prev.machineChoice) { ui.tsMachineShift = null; tsRerender(); return; }
    await updateDoc(doc(db, "timesheets", `${me.uid}_${ws}`), {
      [`entries.${id}.machineChoice`]: patch.machineChoice,
      [`entries.${id}.machineId`]: patch.machineId,
      [`entries.${id}.machineName`]: patch.machineName,
      lastEntryId: id,
      updatedAt: serverTimestamp(),
      updatedAtIso: new Date().toISOString(),
    });
    ui.tsMachineShift = null;
    if (patch.machineChoice === "asset") tsEnsurePrestarts();
  } catch (err) {
    toast("You're clocked on. The machine wasn't saved.");
  }
  tsRerender();
}
function tsManualForm(sheet) {
  const legacyDs = String(ui.tsEdit || "").startsWith("legacy:") ? ui.tsEdit.slice(7) : "";
  const existing = ui.tsEdit && ui.tsEdit !== "new" && !legacyDs ? (sheet?.entries || {})[ui.tsEdit] : null;
  const day = legacyDs ? ((sheet?.days || {})[legacyDs] || {}) : null;
  const e = existing || { date: legacyDs || (tsWeek() === weekStartOf(todayStr()) ? todayStr() : tsWeek()), start: day?.start || "", finish: day?.finish || "", breakStart: day?.breakStart || "", breakEnd: day?.breakEnd || "", job: "", note: day?.note || "" };
  const clock = !!(existing && existing.source === "clock");
  const dates = TS_DAYS.map((n, i) => { const ds = addDays(tsWeek(), i); return `<option value="${ds}" ${e.date === ds ? "selected" : ""}>${n} ${dmy(ds).slice(0, 5)}</option>`; }).join("");
  return `<form id="tsman" class="ts-man"><div class="ts-dl">${clock ? `<span class="ts-badge clock">Clocked</span>` : `<span class="ts-badge manual">Manual</span>`}<b>${existing ? "Edit shift" : "Add hours manually"}</b></div>
    ${clock ? `<div class="ts-keep"><p>The original clock stamp stays visible after you save.</p>${tsFixLine("Clocked on", existing.clockOn)}${tsFixLine("Clocked off", existing.clockOff)}${tsFixLine("Break start", existing.breakOn)}${tsFixLine("Break end", existing.breakOff)}</div><input type="hidden" name="date" value="${esc(existing.date)}">` : `<label>Day<select name="date">${dates}</select></label>`}
    <div class="ts-in"><label>Start<input type="time" name="start" value="${esc(e.start || "")}"></label><label>Finish<input type="time" name="finish" value="${esc(e.finish || "")}"></label></div>
    <div class="ts-in"><label>Break start<input type="time" name="breakStart" value="${esc(e.breakStart || "")}"></label><label>Break end<input type="time" name="breakEnd" value="${esc(e.breakEnd || "")}"></label></div>
    <label>Job<input name="job" maxlength="200" value="${esc(existing?.job || e.job || "")}" placeholder="Site or job"></label>
    <label>Notes<input name="note" maxlength="200" value="${esc(existing?.note || e.note || "")}" placeholder="Optional"></label>
    <p id="tsmsg" class="sub"></p>
    <div class="btns"><button type="button" class="sm-btn" id="tsmancancel">Cancel</button><button type="submit" class="sm-btn primary">Save shift</button></div></form>`;
}
function tsManualArea(sheet) {
  if (ui.tsEdit) return tsManualForm(sheet);
  return `<button type="button" class="sm-btn ts-add" id="tsadd">Add manual hours</button>`;
}
function tsGrid(sheet) {
  const ws = tsWeek(), days = (sheet && sheet.days) || {};
  return `<form id="tsf" class="ts-form"><p class="sub">Or type the week. Saving here does not clock you on.</p>${TS_DAYS.map((n, i) => { const ds = addDays(ws, i), d = days[ds] || {};
    return `<div class="ts-day" data-ds="${ds}"><div class="ts-dl"><b>${n}</b> <span class="sub">${dmy(ds).slice(0, 5)}</span><span class="ts-h">${tsHours(d) ? hrs(tsHours(d)) : ""}</span></div>
      <div class="ts-in"><label>Start<input type="time" name="start" value="${esc(d.start || "")}"></label><label>Finish<input type="time" name="finish" value="${esc(d.finish || "")}"></label>
      <span class="ts-lunch">less 30 min lunch</span></div>
      <input class="ts-note" name="note" placeholder="Note / job (optional)" value="${esc(d.note || "")}"></div>`; }).join("")}
    <div class="ts-tot">Week total <b id="tstot">${hrs(tsTotal(days))}</b></div>
    <div class="btns"><span id="tsmsg" class="sub">${sheet && sheet.sent ? `Sent to accounts ${esc(dmy(String(sheet.sentAt || "").slice(0, 10)))}${String(sheet.updatedAtIso || "") > String(sheet.sentAt || "") ? " · edited since" : ""}` : sheet ? "Saved" : ""}</span>
      <button type="submit" class="sm-btn primary">Save hours</button></div></form>`;
}
function tsEditor() {
  if (!tsWorkerReady()) return tsNav() + `<p class="sub pad">Loading…</p>`;
  const sheet = ui.tsMine;
  const has = entryList(sheet?.entries).length > 0;
  const body = !has && !ui.tsEdit ? tsGrid(sheet) : has ? `${tsCards(sheet, true)}${tsWeekTotal(sheet)}` : "";
  return `${tsNav()}${tsClockHtml()}${tsMachineHtml()}${tsManualArea(sheet)}${body}`;
}
const TS_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const tsDayLbl = (ds, wd) => `${wd} ${+ds.slice(8, 10)} ${TS_MON[+ds.slice(5, 7) - 1]}`;
const tsLong = (ds, wd) => `${tsDayLbl(ds, wd)} ${ds.slice(0, 4)}`;
const ampm = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); if (!m) return t || ""; const h = +m[1]; return `${h % 12 || 12}:${m[2]}${h < 12 ? "am" : "pm"}`; };
const hr1 = h => { const r = Math.round(h * 100) / 100; return (Number.isInteger(r * 10) ? r.toFixed(1) : String(r)) + " hrs"; };
const tsGmailUrl = (su, body) => "https://mail.google.com/mail/?view=cm&fs=1&authuser=" + encodeURIComponent("alex@heartwoodew.com") +
  "&to=" + encodeURIComponent(ACCOUNTS_EMAIL) + "&su=" + encodeURIComponent(su) + "&body=" + encodeURIComponent(body);
const tsSubject = (t, name) => `Timesheet: ${name}, week of ${tsLong(t.weekStart, "Mon")} · ${orgSettings().name}`;
function tsText(t, name, eol = "\n") {
  const ws = t.weekStart, entries = sortedEntries(t.entries).map(paidShift);
  const L = ["Hi Nicole,", "", `Here are ${name}'s hours for the week of ${tsLong(ws, "Mon")} to ${tsLong(addDays(ws, 6), "Sun")}.`, ""];
  if (!entries.length) {
    let worked = 0;
    TS_DAYS.forEach((n, i) => { const ds = addDays(ws, i), d = (t.days || {})[ds] || {}, h = tsHours(d);
      if (h) { worked++; L.push(`${tsDayLbl(ds, n)}   ${ampm(d.start)} to ${ampm(d.finish)}   ${hr1(h)}`); if (d.note) L.push(`      ${d.note}`); }
      else if (d.note) L.push(`${tsDayLbl(ds, n)}   not worked (${d.note})`); });
    if (!worked) L.push("No hours entered this week.");
    L.push("", "A 30-minute lunch break has already been taken off each day.", "", `TOTAL: ${hr1(tsTotal(t.days))}`, "", "Thanks,", "Alex", orgSettings().signoff, POWERED_BY);
    return L.join(eol);
  }
  let worked = 0;
  const used = new Set();
  for (const e of entries) {
    used.add(e.date);
    const h = shiftHours(e);
    const kind = e.source === "manual" ? "manual" : "clocked";
    const br = e.breakStart && e.breakEnd ? ` (break ${ampm(e.breakStart)} to ${ampm(e.breakEnd)})` : "";
    if (h) { worked++; L.push(`${tsDayLbl(e.date, tsDow(e.date))}   ${ampm(e.start)} to ${ampm(e.finish)}   ${hr1(h)}   ${kind}${br}`); }
    else if (e.source === "clock" && e.status !== "closed") L.push(`${tsDayLbl(e.date, tsDow(e.date))}   clocked on ${ampm(e.start)} (not clocked off yet)`);
    const note = [e.job, e.note].filter(Boolean).join(" — ");
    if (note) L.push(`      ${note}`);
  }
  TS_DAYS.forEach((n, i) => {
    const ds = addDays(ws, i);
    if (used.has(ds)) return;
    const d = (t.days || {})[ds] || {}, h = tsHours(d);
    if (h) { worked++; L.push(`${tsDayLbl(ds, n)}   ${ampm(d.start)} to ${ampm(d.finish)}   ${hr1(h)}`); if (d.note) L.push(`      ${d.note}`); }
  });
  if (!worked) L.push("No hours entered this week.");
  L.push("", "Clocked rows were stamped at clock on and clock off. Manual rows were typed in.", "A 30-minute lunch is taken off unless a break was entered.", "", `TOTAL: ${hr1(sheetHours(t))}`, "", "Thanks,", "Alex", orgSettings().signoff, POWERED_BY);
  return L.join(eol);
}
function tsPeople(L) {
  const known = new Set();
  const people = [];
  for (const p of staff) {
    if (p.uid === ALEX_UID) continue;
    known.add(p.uid);
    people.push({ uid: p.uid, name: p.name });
  }
  for (const t of L) {
    if (known.has(t.uid)) continue;
    known.add(t.uid);
    people.push({ uid: t.uid, name: t.name || (staff.find(p => p.uid === t.uid) || {}).name || "?" });
  }
  return people;
}
function tsPerson(p, t) {
  if (!t) return `<div class="ts-card"><h3>${esc(p.name)}</h3><p class="sub">No hours entered for this week.</p></div>`;
  const subj = tsSubject(t, p.name), body = tsText(t, p.name, "\r\n"), plain = tsText(t, p.name);
  const sent = t.sent ? ` <span class="qpill q-comp">Sent ${esc(dmy(String(t.sentAt || "").slice(0, 10)))}</span>` : "";
  const edited = t.sent && String(t.updatedAtIso || "") > String(t.sentAt || "") ? ` <span class="qpill">Edited since sent</span>` : "";
  const legacyTable = `<table class="jt ts-t"><thead><tr><th>Day</th><th>Start</th><th>Finish</th><th>Lunch</th><th>Hours</th><th>Note</th></tr></thead><tbody>${TS_DAYS.map((n, i) => { const ds = addDays(t.weekStart, i), d = (t.days || {})[ds] || {};
    return `<tr><td>${n} ${dmy(ds).slice(0, 5)}</td><td>${esc(d.start || "")}</td><td>${esc(d.finish || "")}</td><td>${tsHours(d) ? "−30m" : ""}</td><td>${tsHours(d) ? hrs(tsHours(d)) : ""}</td><td>${esc(d.note || "")}</td></tr>`; }).join("")}</tbody></table>`;
  const detail = entryList(t.entries).length ? tsCards(t, t.uid === me.uid) : legacyTable;
  const send = !isOwner() ? "" : `<div class="btns"><a class="sm-btn primary tssend" target="_blank" rel="noopener" href="${esc(tsGmailUrl(subj, plain))}">✉ Send to accounts (Gmail)</a>
      <a class="tsmailto sub" href="mailto:${ACCOUNTS_EMAIL}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}">Other mail app</a>
      <button type="button" class="sm-btn tscopy">Copy</button>${t.sent ? `<button type="button" class="sm-btn tsunsent">Unmark sent</button>` : ""}</div>
    <p class="sub">Opens a Gmail draft (alex@heartwoodew.com) to ${ACCOUNTS_EMAIL} (Nicole); you press Send.</p>`;
  return `<div class="ts-card" data-tsid="${esc(t.id)}"><h3>${esc(p.name)} · <b>${hrs(sheetHours(t))}</b>${sent}${edited}</h3>${detail}${send}</div>`;
}
function tsAdmin() {
  const ws = tsWeek(), L = ui.tsAll && ui.tsAllWs === ws ? ui.tsAll : null;
  if (!L) return tsNav() + `<p class="sub pad">Loading…</p>`;
  const people = tsPeople(L);
  const shown = ui.tsStaff ? people.filter(p => p.uid === ui.tsStaff) : people;
  const sum = shown.reduce((n, p) => n + sheetHours(L.find(t => t.uid === p.uid) || {}), 0);
  const who = ui.tsStaff ? (people.find(p => p.uid === ui.tsStaff) || {}).name || "Staff" : "all staff";
  return `${tsNav()}<h2 class="ts-live">Your shift</h2>${tsClockHtml()}${tsMachineHtml()}${tsManualArea(tsOwnSheet())}<label class="ts-filter">Staff <select id="tsstaff"><option value="">All staff</option>${people.map(p => `<option value="${esc(p.uid)}" ${ui.tsStaff === p.uid ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    <div class="ts-tot">Total <b>${hrs(sum)}</b> <span class="sub">${esc(who)}</span></div>
    ${shown.map(p => tsPerson(p, L.find(t => t.uid === p.uid) || null)).join("") || `<p class="sub">Nobody matches that filter.</p>`}`;
}
function tsView() {
  const admin = me.role === "admin";
  return `<div class="sm-head"><h1>Timesheet</h1><span class="sub">${admin ? "Clocked and manual hours" : "Clock on, or enter your hours"}</span></div><div class="ts-wrap">${admin ? tsAdmin() : tsEditor()}</div>`;
}
async function tsLoad(ws) {
  const snap = await getDoc(doc(db, "timesheets", `${me.uid}_${ws}`));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
async function tsWrite(ws, sheet, entries, lastEntryId, opts = {}) {
  const days = daysForSheet({ days: (sheet && sheet.days) || {}, entries });
  const ref = doc(db, "timesheets", `${me.uid}_${ws}`);
  const data = {
    uid: me.uid,
    name: String(me.name || "Staff").slice(0, 80),
    weekStart: ws,
    weekEnd: addDays(ws, 6),
    days,
    totalHrs: sheetHours({ days, entries }),
    updatedAt: serverTimestamp(),
    updatedAtIso: new Date().toISOString(),
    lastEntryId,
  };
  if (opts.consent) data.locationConsentAt = serverTimestamp();
  // Update one shift key. Rewriting the whole entries map makes the rules re-check every stamp.
  if (sheet) {
    data[`entries.${lastEntryId}`] = entries[lastEntryId];
    await updateDoc(ref, data);
    return;
  }
  data.entries = { [lastEntryId]: entries[lastEntryId] };
  await setDoc(ref, data);
}
function tsFixAt(fix) { return { ...locationMap(fix), at: serverTimestamp() }; }
function tsDiffSummary(prev, next) {
  const bits = [];
  for (const [k, label] of [["date", "Day"], ["start", "Start"], ["finish", "Finish"], ["breakStart", "Break start"], ["breakEnd", "Break end"], ["job", "Job"], ["note", "Note"]]) {
    if ((prev[k] || "") !== (next[k] || "")) bits.push(`${label} ${prev[k] || "—"} → ${next[k] || "—"}`);
  }
  return bits.join(". ").slice(0, 200);
}
async function tsPunch(kind) {
  const active = tsSheets();
  if (kind === "on" && active.entry) return;
  if (kind !== "on" && !active.entry) return;
  if (!tsHasConsent(active.sheet)) { ui.tsAsk = kind; tsRerender(); return; }
  if ((ui.tsDirty || ui.tsEdit) && !confirm("Leave what you're typing and record the clock time?")) return;
  ui.tsDirty = false; ui.tsEdit = null;
  if (ui.tsBusy) return;
  ui.tsBusy = true;
  const btn = $("#tsclockon") || $("#tsclockoff") || $("#tsbrk") || $("#tsbrkend");
  if (btn) { btn.disabled = true; btn.textContent = "Checking location…"; }
  try {
    const fix = await captureFix();
    const ws = kind === "on" ? weekStartOf(todayStr()) : active.ws;
    const sheet = await tsLoad(ws);
    const entries = { ...(sheet?.entries || {}) };
    const hm = brisbaneHM(new Date());
    if (kind === "on") {
      const prev = await tsLoad(addDays(weekStartOf(todayStr()), -7));
      if (openClock(entries) || openClock(prev?.entries)) { toast("Clock off the open shift first"); ui.tsPrev = prev; return; }
      const id = newTsId();
      entries[id] = {
        id, source: "clock", status: "open", date: todayStr(), start: hm, finish: "", breakStart: "", breakEnd: "", note: "", job: "",
        clockOn: tsFixAt(fix), enteredBy: me.uid, enteredByName: String(me.name || "Staff").slice(0, 80), enteredAt: serverTimestamp(),
        edits: {}, lastEditId: "",
      };
      await tsWrite(ws, sheet, entries, id, { consent: !(sheet && sheet.locationConsentAt) });
      ui.tsMachineShift = id;
      ui.tsMachineWs = ws;
      toast(fix.fix === "gps" ? "Clocked on" : "Clocked on · no location");
    } else {
      const e = openClock(entries);
      if (!e) { toast("No open shift on this week"); return; }
      const next = { ...e };
      if (kind === "break-start") {
        if (e.status !== "open") return;
        next.status = "break"; next.breakStart = hm; next.breakOn = tsFixAt(fix);
      } else if (kind === "break-end") {
        if (e.status !== "break") return;
        next.status = "open"; next.breakEnd = hm; next.breakOff = tsFixAt(fix);
      } else {
        next.status = "closed"; next.finish = hm; next.clockOff = tsFixAt(fix);
        if (e.status === "break") { next.breakEnd = next.breakEnd || hm; next.breakOff = tsFixAt(fix); }
      }
      entries[e.id] = next;
      await tsWrite(ws, sheet, entries, e.id, { consent: !(sheet && sheet.locationConsentAt) });
      toast(kind === "off" ? (fix.fix === "gps" ? "Clocked off" : "Clocked off · no location") : "Break saved");
      ui.tsPrevFor = "";
    }
  } catch (err) {
    toast("Not saved: " + (err.code || err.message));
  } finally {
    ui.tsBusy = false;
    tsRerender();
  }
}
async function tsSaveManual(ev) {
  ev.preventDefault();
  const f = ev.target;
  const next = {
    date: f.date.value, start: f.start.value, finish: f.finish.value,
    breakStart: f.breakStart.value, breakEnd: f.breakEnd.value,
    job: f.job.value.trim().slice(0, 200), note: f.note.value.trim().slice(0, 200),
  };
  const msg = $("#tsmsg");
  if ((next.breakStart && !next.breakEnd) || (!next.breakStart && next.breakEnd)) { if (msg) msg.textContent = "Enter both break start and break end, or leave both empty"; return; }
  const ws = tsWeek();
  ui.tsBusy = true;
  let paint = true;
  try {
    const sheet = await tsLoad(ws);
    const entries = { ...(sheet?.entries || {}) };
    const legacy = String(ui.tsEdit || "").startsWith("legacy:");
    const existing = !legacy && ui.tsEdit && ui.tsEdit !== "new" ? entries[ui.tsEdit] : null;
    if (ui.tsEdit && ui.tsEdit !== "new" && !legacy && !existing) { paint = false; if (msg) msg.textContent = "That shift is not on this week"; return; }
    const needFinish = !existing || existing.source !== "clock" || existing.status === "closed";
    if (!next.start || (needFinish && !next.finish)) { paint = false; if (msg) msg.textContent = "Enter a start and a finish"; return; }
    if (existing) {
      const summary = tsDiffSummary(existing, { ...next, date: existing.source === "clock" ? existing.date : next.date });
      if (!summary) { ui.tsEdit = null; ui.tsDirty = false; toast("No change"); return; }
      const editId = newTsId();
      entries[existing.id] = {
        ...existing,
        ...next,
        date: existing.source === "clock" ? existing.date : next.date,
        edits: { ...(existing.edits || {}), [editId]: { at: serverTimestamp(), by: me.uid, byName: String(me.name || "Staff").slice(0, 80), summary } },
        lastEditId: editId,
      };
      await tsWrite(ws, sheet, entries, existing.id, {});
    } else {
      const id = newTsId();
      entries[id] = {
        id, source: "manual", status: "closed", ...next,
        enteredBy: me.uid, enteredByName: String(me.name || "Staff").slice(0, 80), enteredAt: serverTimestamp(),
        edits: {}, lastEditId: "",
      };
      await tsWrite(ws, sheet, entries, id, {});
    }
    ui.tsEdit = null; ui.tsDirty = false;
    toast("Shift saved");
  } catch (err) {
    toast("Not saved: " + (err.code || err.message));
  } finally {
    ui.tsBusy = false;
    if (paint) tsRerender();
  }
}
function bindTs(A, rerender) {
  ui.tsPaint = rerender;
  const ws = tsWeek();
  A.querySelectorAll("[data-tsw]").forEach(b => b.onclick = () => { const n = +b.dataset.tsw;
    if ((ui.tsDirty || ui.tsEdit) && !confirm("Leave this week without saving this shift?")) return;
    ui.tsDirty = false; ui.tsEdit = null; ui.tsAsk = null; ui.tsWs = n ? addDays(ws, n) : weekStartOf(todayStr()); rerender(); });
  if (tsIsAdminSheet()) {
    if (ui.tsSubWs !== ws) { ui.tsSub?.(); ui.tsSubWs = ws; ui.tsAll = null;
      ui.tsSub = onSnapshot(query(collection(db, "timesheets"), where("weekStart", "==", ws)), s => {
        ui.tsAll = s.docs.map(x => ({ id: x.id, ...x.data() })); ui.tsAllWs = ws;
        if (!tsIsAdminSheet() || tsSnapshotBlocked()) return; rerender();
      }, e => { const w = A.querySelector(".ts-wrap"); if (w) w.innerHTML = tsNav() + `<p class="err pad">Timesheets not available: ${esc(e.code || e.message)}</p>`; }); }
  } else if (ui.tsWatchId !== `${me.uid}_${ws}`) {
    ui.tsWatch?.(); ui.tsWatchId = `${me.uid}_${ws}`; ui.tsMine = undefined;
    ui.tsWatch = onSnapshot(doc(db, "timesheets", `${me.uid}_${ws}`), s => {
      ui.tsMine = s.exists() ? { id: s.id, ...s.data() } : null;
      if (tsSnapshotBlocked()) return;
      if ((ui.opTab === "hours" && !ui.opSel) || (ui.view === "timesheet" && !tsIsAdminSheet())) rerender();
    }, e => { const w = A.querySelector(".ts-wrap") || A.querySelector(".pad"); if (w) w.innerHTML = tsNav() + `<p class="err pad">Timesheet not available: ${esc(e.code || e.message)}</p>`; });
  }
  const prevKey = `${me.uid}_${addDays(weekStartOf(todayStr()), -7)}`;
  if (tsWeek() === weekStartOf(todayStr())) {
    if (ui.tsPrevFor !== prevKey) { ui.tsPrevFor = prevKey;
      getDoc(doc(db, "timesheets", prevKey)).then(s => { if (ui.tsPrevFor !== prevKey) return; ui.tsPrev = s.exists() ? { id: s.id, ...s.data() } : null; if (!tsSnapshotBlocked()) rerender(); }).catch(() => {}); }
  } else { ui.tsPrev = null; ui.tsPrevFor = ""; }
  const staffSel = $("#tsstaff"); if (staffSel) staffSel.onchange = () => { ui.tsStaff = staffSel.value; rerender(); };
  const onBtn = $("#tsclockon"); if (onBtn) onBtn.onclick = () => tsPunch("on");
  const offBtn = $("#tsclockoff"); if (offBtn) offBtn.onclick = () => tsPunch("off");
  const brk = $("#tsbrk"); if (brk) brk.onclick = () => tsPunch("break-start");
  const brkEnd = $("#tsbrkend"); if (brkEnd) brkEnd.onclick = () => tsPunch("break-end");
  const agree = $("#tsagree"); if (agree) agree.onclick = () => { try { localStorage.setItem(TS_CONSENT_KEY, "1"); } catch { /* ignore */ } const kind = ui.tsAsk; ui.tsAsk = null; tsPunch(kind); };
  A.querySelectorAll(".tsmach").forEach(b => b.onclick = () => tsChooseMachine(b.dataset.asset ? "asset" : "none", b.dataset.asset ? { id: b.dataset.asset, name: b.dataset.name } : null));
  const skip = $("#tsmachskip"); if (skip) skip.onclick = () => tsChooseMachine("skip");
  A.querySelectorAll(".tsprestart").forEach(b => b.onclick = () => tsOpenPrestart(b.dataset.asset));
  const no = $("#tsno"); if (no) no.onclick = () => { ui.tsAsk = null; rerender(); };
  const add = $("#tsadd"); if (add) add.onclick = () => { if (ui.tsDirty && !confirm("Leave the week grid without saving?")) return; ui.tsEdit = "new"; ui.tsDirty = false; rerender(); };
  A.querySelectorAll(".tsedit").forEach(b => b.onclick = () => { ui.tsEdit = b.dataset.eid; ui.tsDirty = false; rerender(); });
  A.querySelectorAll(".tslegacy").forEach(b => b.onclick = () => { ui.tsEdit = "legacy:" + b.dataset.legacy; ui.tsDirty = false; rerender(); });
  const cancel = $("#tsmancancel"); if (cancel) cancel.onclick = () => { ui.tsEdit = null; ui.tsDirty = false; rerender(); };
  const man = $("#tsman"); if (man) { man.oninput = () => { ui.tsDirty = true; }; man.onsubmit = tsSaveManual; }
  if (tsIsAdminSheet()) {
    A.querySelectorAll("[data-tsid]").forEach(c => { const t = (ui.tsAll || []).find(x => x.id === c.dataset.tsid); if (!t) return;
      const name = (staff.find(p => p.uid === t.uid) || {}).name || t.name || "?";
      c.querySelectorAll(".tssend,.tsmailto").forEach(a => a.onclick = () => { updateDoc(doc(db, "timesheets", t.id), { sent: true, sentAt: new Date().toISOString(), sentBy: me.uid }).catch(e => toast("Not marked sent: " + (e.code || e.message))); });
      const copy = c.querySelector(".tscopy"); if (copy) copy.onclick = async () => { const txt = tsText(t, name);
        try { await navigator.clipboard.writeText(txt); } catch { const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
        toast("Timesheet copied"); };
      const un = c.querySelector(".tsunsent"); if (un) un.onclick = () => updateDoc(doc(db, "timesheets", t.id), { sent: false, sentAt: null, sentBy: null }).catch(e => toast("Not saved: " + (e.code || e.message)));
    });
  }
  const f = A.querySelector("#tsf"); if (!f) return;
  const read = () => { const days = {}; f.querySelectorAll(".ts-day").forEach(r => { const g = n => r.querySelector(`[name=${n}]`).value.trim();
    const d = { start: g("start"), finish: g("finish"), note: g("note") };
    if (d.start || d.finish || d.note) days[r.dataset.ds] = d; }); return days; };
  f.oninput = () => { const days = read(); const tot = $("#tstot"); if (tot) tot.textContent = hrs(tsTotal(days));
    f.querySelectorAll(".ts-day").forEach(r => { const h = tsHours(days[r.dataset.ds]); r.querySelector(".ts-h").textContent = h ? hrs(h) : ""; }); const m = $("#tsmsg"); if (m) m.textContent = "Not saved"; ui.tsDirty = true; };
  f.onsubmit = async ev => { ev.preventDefault(); const days = read();
    for (const [ds, d] of Object.entries(days)) if ((d.start && !d.finish) || (!d.start && d.finish)) { const m = $("#tsmsg"); if (m) m.textContent = `${dmy(ds).slice(0, 5)}: enter both start and finish`; return; }
    const data = { uid: me.uid, name: String(me.name || "Staff").slice(0, 80), weekStart: ws, weekEnd: addDays(ws, 6), days, totalHrs: tsTotal(days), updatedAt: serverTimestamp(), updatedAtIso: new Date().toISOString() };
    try { await setDoc(doc(db, "timesheets", `${me.uid}_${ws}`), data, { merge: true }); ui.tsMine = { ...(ui.tsMine || {}), ...data, weekStart: ws }; ui.tsDirty = false; const m = $("#tsmsg"); if (m) m.textContent = "Saved ✓"; toast("Hours saved"); }
    catch (e) { const m = $("#tsmsg"); if (m) m.textContent = "Not saved: " + (e.code || e.message); } };
}
// ---- Owner-only amber "to reimburse" pill (same look/behaviour as the done-today pill). Ledger + queued personally-paid
// receipts the box hasn't written to the ledger yet. Never rendered (or subscribed) for anyone but Alex's UID.
function reimbSubs() {
  if (!isOwner() || ui.rpSubs) return; ui.rpSubs = true;
  if (!ui.reimbSub) ui.reimbSub = onSnapshot(collection(db, "reimbursements"), s => { ui.reimb = s.docs.map(x => ({ id: x.id, ...x.data() })); reimbPill(); if (ui.view === "reimb") renderAdmin(); }, () => {});
  onSnapshot(query(collection(db, "receipts"), where("paidPersonally", "==", true)), s => { ui.rqueued = s.docs.map(x => ({ id: x.id, ...x.data() })); reimbPill(); }, () => {});
}
function owedList() {
  const led = ui.reimb || [], ids = new Set(led.map(r => r.receiptId || r.id));
  const L = [...led.filter(r => !r.paid), ...(ui.rqueued || []).filter(r => r.status === "queued" && !ids.has(r.id)).map(r => ({ ...r, date: r.createdAtIso, pending: true }))];
  return L.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}
// "Done" on a pill line: paid back to the worker. Ledger entry reimbursements/{receiptId} gets paid/reimbursed + who/when
// (created from the receipt if the box hasn't written it yet; the box keeps an existing entry and skips its "you owe" text).
// Nothing is deleted; Undo (5 s) puts paid back to false.
async function markReimbursed(r) {
  const id = r.receiptId || r.id, ref = doc(db, "reimbursements", id), at = new Date().toISOString();
  const base = r.pending ? { receiptId: id, uid: r.uid || null, workerName: r.workerName || null, date: r.createdAtIso || r.date || null, supplier: r.supplier || null,
    amountInc: +r.amountInc || 0, jobNo: r.jobNo || null, jobId: r.jobId || null, hubdocStatus: "queued", createdFrom: "pill" } : {};
  await setDoc(ref, { ...base, paid: true, reimbursed: true, paidAt: at, reimbursedAt: at, reimbursedBy: me.uid, reimbursedByName: me.name }, { merge: true });
  undoToast(`Reimbursed ${r.workerName || ""} ${$$(+r.amountInc || 0)} (${r.supplier || "receipt"})`, () =>
    setDoc(ref, { paid: false, reimbursed: false, paidAt: null, reimbursedAt: null, reimbursedBy: null, reimbursedByName: null, undoneAt: new Date().toISOString() }, { merge: true }), 5000);
}
// Read-only export of the currently owed receipts (does not touch paid status).
async function reimbCsv(L) {
  const all = [...jobs, ...(ui.undated || []), ...(ui.done || [])], q = v => `"${String(v ?? "").replace(/"/g, '""')}"`, r2 = v => (Math.round(v * 100) / 100).toFixed(2);
  const addr = r => r.address || ((r.jobId && all.find(x => x.id === r.jobId)) || (r.jobNo && all.find(x => String(jobNo(x)) === String(r.jobNo))) || {}).address || "";
  let ti = 0, tg = 0;
  const rows = [["Worker", "Date", "Supplier/Description", "Job #", "Job address", "Amount inc GST", "GST", "Amount ex GST", "Status", "Receipt ID"]];
  for (const r of L) { const inc = +r.amountInc || 0, g = inc / 11; ti += inc; tg += g;
    rows.push([r.workerName || "", String(r.date || "").slice(0, 10), r.supplier || "", r.jobNo || "", addr(r), r2(inc), r2(g), r2(inc - g), r.pending ? "queued" : "owed", r.receiptId || r.id]); }
  rows.push(["TOTAL", "", `${L.length} receipt${L.length === 1 ? "" : "s"}`, "", "", r2(ti), r2(tg), r2(ti - tg), "", ""]);
  const csv = "\ufeff" + rows.map(x => x.map(q).join(",")).join("\r\n") + "\r\n";
  const name = `reimbursements_${new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" })}.csv`;
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const file = new File([csv], name, { type: "text/csv" });
  if (iOS && navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file], title: name });
  const url = URL.createObjectURL(file), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function reimbPill() {
  const fw = $("#fabwrap"); let el = $("#rbpill");
  if (!fw || !isOwner()) { if (el) el.remove(); return; }
  reimbSubs();
  const L = owedList(); if (!L.length) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "rbpill"; fw.insertBefore(el, fw.firstChild); }
  el.className = "donepill rbpill rblines";
  el.innerHTML = L.map(r => `<div role="button" tabindex="0" class="dp-head rb-line" data-rp="${esc(r.id)}" title="${esc(String(r.date || "").slice(0, 10))}${r.pending ? " · queued" : ""}">
    <span class="dp-tick">🧾</span><span class="rb-t">${esc(r.workerName || "?")} · ${esc(r.supplier || "receipt")}${r.jobNo ? " · #" + esc(r.jobNo) : ""}</span><b class="rb-a">${$$(r.amountInc || 0)}</b>
    <button type="button" class="rb-done" data-rbdone="${esc(r.id)}" title="Done - paid back to ${esc(r.workerName || "worker")}" aria-label="Mark reimbursed">✓</button></div>`).join("");
  el.insertAdjacentHTML("beforeend", `<button type="button" class="dp-head rb-csv" id="rbcsv"><span class="dp-tick">⬇</span><span class="rb-t">CSV · ${L.length} owed</span></button>`);
  $("#rbcsv").onclick = () => reimbCsv(L).catch(e => e?.name !== "AbortError" && toast("CSV failed: " + (e.message || e)));
  el.querySelectorAll("[data-rbdone]").forEach(b => b.onclick = ev => { ev.stopPropagation(); ev.preventDefault();
    const r = L.find(x => x.id === b.dataset.rbdone); if (r) markReimbursed(r).catch(e => toast("Not saved: " + (e.code || e.message))); });
  el.querySelectorAll("[data-rp]").forEach(b => b.onclick = () => { const r = L.find(x => x.id === b.dataset.rp) || {};
    const all = [...jobs, ...(ui.undated || []), ...(ui.done || [])];
    const j = (r.jobId && all.find(x => x.id === r.jobId)) || (r.jobNo && all.find(x => String(jobNo(x)) === String(r.jobNo)));
    if (j) editJob(j); else { ui.view = "reimb"; renderAdmin(); } });
}
// ---- Home: first screen after login. Today + tomorrow, quick counts, big buttons to the other screens.
const GM = "https://mail.google.com/mail/u/?authuser=alex@heartwoodew.com";
const jobPhotosUrl = j => GM + "#search/" + encodeURIComponent(`subject:"[Job Photos]" "${jobNo(j)}"`);
const hasPhotos = j => !!(j.photosEmailedAt || j.photosEmailedCount);
const jobPhotosIcon = j => hasPhotos(j) ? ` <a class="phicon" href="${jobPhotosUrl(j)}" target="_blank" rel="noopener" title="Photos in Gmail" onclick="event.stopPropagation()">📷</a>` : "";
const jobPhotosLink = j => !hasPhotos(j) ? "" : ` <a class="phlink" href="${jobPhotosUrl(j)}" target="_blank" rel="noopener">📷 Photos (${j.photosEmailedCount || 1} sent)</a>`;
const emailedPhotosNote = j => {
  const n = Number(j && j.photosEmailedCount) || 0;
  if (n < 1) return "";
  return `<span class="sub emailed-note"><a class="phlink" href="${jobPhotosUrl(j)}" target="_blank" rel="noopener">Email history (${n} photo${n === 1 ? "" : "s"})</a></span>`;
};
const greet = () => { const h = +new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(new Date()); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
function homeRow(j) {
  const q = queueOf(j), names = namesOf(j);
  return `<div class="hrow" data-id="${j.id}"><div class="htime"><b>${esc(j.time || "--")}</b><small>${j.durationHrs ? esc(j.durationHrs) + "h" : ""}</small></div>
    <div class="hbody"><div class="hcl"><span class="qdot ${QCLS[q]}"></span>${esc(j.client || "")} <span class="jn">#${esc(jobNo(j))}</span>${jobPhotosIcon(j)}</div>
    <div class="sub">${esc(j.address || "-")}</div><div class="sub">${esc(firstLine(j.description))}</div>
    <div class="sub">${names.length ? esc(names.map(label).join(", ")) : `<span class="unal">Unallocated</span>`}</div></div>
    <span class="pstack">${ipPill(j)}<span class="qpill ${QCLS[q]}">${j.status === "Done" ? "Work completed" : q}</span></span></div>`;
}
function homeLists(all, admin) {
  const t0 = todayStr(), t1 = addDays(t0, 1);
  const live = all.filter(j => j.status !== "Cancelled" && queueOf(j) !== "Unsuccessful" && (admin || (j.assigned || []).includes(me.uid)));
  const by = d => live.filter(j => j.date === d || (d === t0 && j.date && j.date < t0 && j.status === "In progress")).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  return { live, today: by(t0), tomorrow: by(t1), t0, t1 };
}
// ---- Monthly PROFIT chart (Alex only). Figures are Xero's Profit and Loss (cash basis, ex GST), copied by a box script
// (tools/xero_profit_sync.py) into meta/profitHistory, because the app can't call Xero itself. Nothing here is estimated.
function profHistLoad() { if (ui.profReq || !canXero()) return; ui.profReq = true;
  getDoc(doc(db, "meta", "profitHistory")).then(s => { ui.profHist = s && s.exists() ? s.data() : null; if (ui.view === "home") renderAdmin(); }).catch(() => { ui.profHist = null; }); }
function profitChartHtml() {
  if (!canXero()) return "";
  profHistLoad(); const sm = v => (v < 0 ? "−" : "") + $$(Math.abs(v));
  const t0 = todayStr().slice(0, 7), N = ui.revN || 12, mode = ui.profMode || "net", months = [];
  for (let i = N - 1; i >= 0; i--) { const d = new Date(t0 + "-01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const H = (ui.profHist && ui.profHist.months) || {}, rows = months.map(m => ({ m, d: H[m] || null }));
  setTimeout(() => { document.querySelectorAll("[data-revn]").forEach(b => b.onclick = () => { ui.revN = +b.dataset.revn; renderAdmin(); });
    document.querySelectorAll("[data-pmode]").forEach(b => b.onclick = () => { ui.profMode = b.dataset.pmode; renderAdmin(); }); });
  const seg = `<span class="seg rv-seg">${[["net", "Profit"], ["ie", "Income vs costs"]].map(([k, l]) => `<button type="button" data-pmode="${k}" class="${mode === k ? "on" : ""}">${l}</button>`).join("")}</span>
    <span class="seg rv-seg">${[6, 12].map(n => `<button type="button" data-revn="${n}" class="${N === n ? "on" : ""}">${n} mo</button>`).join("")}</span>`;
  const head = `<div class="hsec-h rv-h">Profit by month <small>net profit from Xero, ex GST</small><span class="rv-ctl">${seg}</span></div>`;
  if (!ui.profHist) return `<div class="hsec revsec">${head}<p class="sub rv-note">${ui.profReq && ui.profHist === undefined ? "Loading…" : "No Xero figures saved yet."}</p></div>`;
  const nice = v => (v < 0 ? "−" : "") + (Math.abs(v) >= 1000 ? "$" + (Math.abs(v) / 1000).toFixed(Math.abs(v) >= 100000 ? 0 : 1) + "k" : "$" + Math.round(Math.abs(v)));
  const ml = m => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" }) + (m.endsWith("-01") ? " " + m.slice(2, 4) : "");
  const W = 640, T = 22, B = 200, pad = 40, bw = (W - pad) / rows.length;
  const PY = m => { const d = new Date(m + "-01T00:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() - 1); return H[d.toISOString().slice(0, 7)] || null; };
  const vals = rows.flatMap(r => [r.d, PY(r.m)].filter(Boolean).flatMap(d => mode === "net" ? [d.netProfit] : [d.income, d.expenses]));
  const hi = Math.max(1, ...vals), lo = Math.min(0, ...vals), y = v => T + (hi - v) / (hi - lo) * (B - 16 - T), y0 = y(0);
  const ticks = [hi, 0, ...(lo < 0 ? [lo] : [])];
  const grid = ticks.map(v => `<line x1="${pad}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="rv-g${v === 0 ? " zero" : ""}"/><text x="${pad - 4}" y="${y(v) + 4}" class="rv-y">${nice(v)}</text>`).join("");
  const py = m => { const d = new Date(m + "-01T00:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() - 1); return H[d.toISOString().slice(0, 7)] || null; };
  const ghost = k => { let d = "", on = false; rows.forEach((r, i) => { const g = py(r.m); if (!g) { on = false; return; } d += `${on ? "L" : "M"}${X(i).toFixed(1)},${y(g[k]).toFixed(1)} `; on = true; }); return d; };
  const gdots = k => rows.map((r, i) => { const g = py(r.m); return g ? `<circle cx="${X(i)}" cy="${y(g[k])}" r="3" class="rv-gdot ${k}"><title>${esc(ml(r.m) + " last year: " + sm(g[k]))}</title></circle>` : ""; }).join("");
  const X = i => pad + i * bw + bw / 2, pts = rows.map((r, i) => ({ r, i, cx: X(i), cur: r.m === t0 }));
  const labs = pts.map(p => `<text x="${p.cx}" y="${B + 16}" class="rv-x">${ml(p.r.m)}${p.cur ? "*" : ""}</text>`).join("");
  const path = k => { let d = "", on = false; pts.forEach(p => { if (!p.r.d) { on = false; return; } d += `${on ? "L" : "M"}${p.cx.toFixed(1)},${y(p.r.d[k]).toFixed(1)} `; on = true; }); return d; };
  const tipOf = p => `${ml(p.r.m)}${p.cur ? " (part month)" : ""}: income ${sm(p.r.d.income)} · costs ${sm(p.r.d.expenses)} (cost of sales ${sm(p.r.d.costOfSales)}, operating ${sm(p.r.d.operatingExpenses)}) · net profit ${sm(p.r.d.netProfit)}`;
  const none = pts.filter(p => !p.r.d).map(p => `<g class="rv-b none"><title>${ml(p.r.m)}: no Xero figures</title><text x="${p.cx}" y="${y0 - 4}" class="rv-v muted">–</text></g>`).join("");
  let bars;
  const anyPy = rows.some(r => py(r.m));
  if (mode === "net") bars = `<path d="${ghost("netProfit")}" class="rv-ghost net"/>${gdots("netProfit")}<path d="${path("netProfit")}" class="rv-line net"/>` + pts.filter(p => p.r.d).map(p => { const v = p.r.d.netProfit, yy = y(v);
      return `<g class="rv-b ${v < 0 ? "neg" : "pos"} ${p.cur ? "cur" : ""}"><title>${esc(tipOf(p))}</title><circle cx="${p.cx}" cy="${yy}" r="${p.cur ? 4 : 5}" class="rv-dot"/>
        <text x="${p.cx}" y="${v < 0 ? yy + 16 : yy - 9}" class="rv-v${v < 0 ? " negt" : ""}">${nice(v)}</text></g>`; }).join("");
  else bars = `<path d="${ghost("income")}" class="rv-ghost inc"/><path d="${ghost("expenses")}" class="rv-ghost exp"/>${gdots("income")}${gdots("expenses")}<path d="${path("income")}" class="rv-line inc"/><path d="${path("expenses")}" class="rv-line exp"/>` + pts.filter(p => p.r.d).map(p =>
      `<g class="rv-b ${p.cur ? "cur" : ""}"><title>${esc(tipOf(p))}</title><circle cx="${p.cx}" cy="${y(p.r.d.income)}" r="4" class="rv-dot inc"/><circle cx="${p.cx}" cy="${y(p.r.d.expenses)}" r="4" class="rv-dot exp"/></g>`).join("");
  bars = labs + none + bars;
  const full = rows.filter(r => r.d && r.m !== t0), tot = full.reduce((a, r) => a + r.d.netProfit, 0), loss = full.filter(r => r.d.netProfit < 0).length;
  const upd = ui.profHist.updatedAt ? new Date(ui.profHist.updatedAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
  return `<div class="hsec revsec">${head}
    <div class="rv-wrap"><svg viewBox="0 0 ${W} ${B + 22}" class="rv-svg" role="img" aria-label="Profit by month">${grid}${bars}</svg></div>
    <p class="sub rv-key">${mode === "ie" ? `<i class="k inc"></i>Income <i class="k exp"></i>Costs (cost of sales + operating expenses) ` : ""}<i class="ln"></i>This year <i class="ln gh"></i>Last year${anyPy ? "" : " (no Xero figures for those months yet)"}${anyPy && rows.some(r => !py(r.m)) ? " · gaps = no Xero figures" : ""}</p>
    <p class="sub rv-note">From Xero Profit and Loss (cash basis, ex GST). Net profit over the ${full.length} full months shown: <b class="${tot < 0 ? "negt" : ""}">${sm(tot)}</b>${loss ? `, ${loss} month${loss === 1 ? "" : "s"} at a loss` : ""}.
      * ${ml(t0)} is part month so far.${upd ? ` Updated from Xero ${esc(upd)}.` : ""}</p></div>`;
}
// "Needs attention": each line is a count you can open to see (and tap) the jobs behind it. Admin only.
function attentionHtml(all) {
  const t0 = todayStr(), seen = new Set(), pool = [...all, ...(ui.done || [])].filter(j => !seen.has(j.id) && seen.add(j.id));
  const live = pool.filter(j => j.status !== "Cancelled" && queueOf(j) !== "Unsuccessful");
  const unal = live.filter(j => j.date && j.date >= t0 && j.status !== "Done" && !namesOf(j).length).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const nopo = live.filter(j => !String(j.po || "").trim() && ((j.status === "Done" && !j.invoiceNo && !j.doNotInvoice && j.invoiceExcluded !== true) || (j.date && j.date >= t0 && j.date <= addDays(t0, 7)) || j.status === "In progress"));
  const incs = (ui.incidents || []).filter(r => r.status !== "Closed");
  const owed = isOwner() ? owedList() : [], dk = r => [r.workerName, (+r.amountInc || 0).toFixed(2), String(r.date || "").slice(0, 10)].join("|");
  const dups = owed.filter(r => owed.filter(x => dk(x) === dk(r)).length > 1);
  const unread = isOwner() && ui.inbox ? inboxUnread() : 0;
  const jl = j => `<div class="at-j" data-id="${j.id}"><b>${esc(j.date ? shortDate(j.date) : "—")}</b> ${esc(j.time || "")} · ${esc(j.address || j.client || "")} <span class="jn">#${esc(jobNo(j))}</span></div>`;
  const row = (n, txt, cls, body, go) => !n ? "" : body
    ? `<details class="at-row ${cls}"><summary><span class="at-n">${n}</span><span class="at-t">${txt}</span><span class="car">▸</span></summary><div class="at-list">${body}</div></details>`
    : `<button class="at-row at-btn ${cls}" data-go="${go}"><span class="at-n">${n}</span><span class="at-t">${txt}</span><span class="car">›</span></button>`;
  const rows = [
    row(unal.length, `job${unal.length === 1 ? "" : "s"} with no one allocated`, "red", unal.slice(0, 15).map(jl).join("")),
    row(nopo.length, `job${nopo.length === 1 ? "" : "s"} with no PO number`, "amber", nopo.slice(0, 15).map(jl).join("")),
    row(unread, `unread builder email${unread === 1 ? "" : "s"}`, "", "", "inbox"),
    row(incs.length, `open safety incident${incs.length === 1 ? "" : "s"}`, "red", incs.map(r => `<div class="at-j" data-incid="${esc(r.id)}"><b>${esc(r.reportNo || "")}</b> ${esc(r.type || "")} · ${esc(r.location || "")}</div>`).join("")),
    row(owed.length, `receipt${owed.length === 1 ? "" : "s"} to check / reimburse${dups.length ? ` · <span class="dupw">${dups.length} possible duplicate${dups.length === 1 ? "" : "s"}</span>` : ""}`, dups.length ? "amber" : "", "", "reimb")].join("");
  return `<div class="hsec attn"><div class="hsec-h">Needs attention</div>${rows || `<p class="muted pad">All clear. Nothing needs you right now.</p>`}</div>`;
}
function homeBody(all, admin, btns) {
  const { live, today, tomorrow, t0, t1 } = homeLists(all, admin);
  const ip = live.filter(j => j.status === "In progress").length;
  const unal = live.filter(j => j.date >= t0 && j.status !== "Done" && !namesOf(j).length).length;
  const ready = (ui.done || []).filter(j => !j.invoiceNo && j.invoiceExcluded !== true && !j.doNotInvoice).length;
  const stat = (n, l, cls, go) => `<button class="hstat ${cls}" ${go ? `data-go="${go}"` : ""}><b>${n}</b><span>${l}</span></button>`;
  const sec = (title, d, js) => `<div class="hsec"><div class="hsec-h">${title} <small>${esc(dayLabel(d))}</small> <span class="cnt">${js.length}</span></div>
    ${js.map(homeRow).join("") || `<p class="muted pad">Nothing booked for ${esc(orgSettings().name)}.</p>`}</div>`;
  return `<div class="home"><div class="hhead"><h1>${greet()}, ${esc(String(me.name || "").split(" ")[0])}</h1><div class="muted">${esc(dayLabel(t0))} · ${esc(orgSettings().name)}</div></div>
    ${admin ? COMP.adminBannerHtml() : ""}${admin ? cloudExpiryNotice(all) : ""}
    ${swmsReminderHtml()}${admin ? attentionHtml(all) + (canXero() ? profitChartHtml() : "") : `<div class="hbtns opbtns"><button class="hbtn inc" data-inc=""><span class="ic">⚠</span>Report incident</button><button class="hbtn" data-go="swms"><span class="ic">📋</span>SWMS</button></div>`}
    <div class="hstats hidden">${stat(today.length, "Today", "q-wo")}${stat(ip, "In progress", "ip", admin ? "q-ip" : "")}${admin ? stat(ready, "Ready to invoice", "q-comp", "invoices") + stat(unal, "Unallocated", "q-uns", "dispatch") + (isOwner() && ui.inbox ? stat(inboxUnread(), "Unread builder emails", "q-inbox", "inbox") : "") : stat(tomorrow.length, "Tomorrow", "q-quote")}</div>
    <div class="hbtns hidden"><button class="hbtn inc" data-inc=""><span class="ic">⚠</span>Report incident</button>${btns.map(([go, ic, n]) => `<button class="hbtn" data-go="${go}"><span class="ic">${ic}</span>${n}</button>`).join("")}</div>
    ${sec("Today", t0, today)}${sec("Tomorrow", t1, tomorrow)}${admin ? "" : myIncidentsHtml()}</div>`;
}
function homeView(all) {
  return homeBody(all, true, NAV.filter(x => x[0] !== "home" && !x[3] && (!x[4] || isOwner())).map(([k, ic, n]) => [k, ic, n]));
}
async function saveInvite(fields) {
  const draft = buildInviteDraft({ ...fields, createdBy: me.uid, now: new Date(), token: newInviteToken(), tenantId: myTenant() });
  if (!draft.ok) return draft.reason;
  if (pendingInviteForEmail(ui.invites || [], draft.invite.email)) return "already-pending";
  const inviteRef = doc(collection(db, "invites"));
  const expiresAt = Timestamp.fromDate(draft.invite.expiresAt);
  const payload = { ...draft.invite, createdAt: serverTimestamp(), expiresAt };
  try {
    await runTransaction(db, async tx => {
      const lockRef = doc(db, "inviteEmails", payload.email);
      const existing = await tx.get(lockRef);
      if (existing.exists() && existing.data().status === "pending") {
        const err = new Error("already-pending");
        err.code = "already-pending";
        throw err;
      }
      tx.set(inviteRef, payload);
      tx.set(lockRef, {
        email: payload.email, status: "pending", inviteId: inviteRef.id,
        expiresAt, role: payload.role, tenantId: payload.tenantId,
      });
    });
  } catch (e) {
    if (e.code === "already-pending") return "already-pending";
    return e.code === "permission-denied" ? "already-pending" : "permission-denied";
  }
  return "";
}
async function resendInvite(id) {
  const row = (ui.invites || []).find(item => item.id === id);
  if (!row || row.status !== "pending") return;
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const token = newInviteToken();
  await runTransaction(db, async tx => {
    tx.update(doc(db, "invites", id), { token, expiresAt, resentAt: serverTimestamp(), resentBy: me.uid });
    tx.update(doc(db, "inviteEmails", row.email), { expiresAt, status: "pending" });
  });
}
async function cancelInvite(id) {
  const row = (ui.invites || []).find(item => item.id === id);
  if (!row || row.status !== "pending") return;
  await runTransaction(db, async tx => {
    tx.update(doc(db, "invites", id), { status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: me.uid });
    tx.update(doc(db, "inviteEmails", row.email), { status: "cancelled" });
  });
}
function bindStaff(A) {
  const form = A.querySelector("#invitef");
  if (form) form.onsubmit = async ev => {
    ev.preventDefault();
    const err = A.querySelector("#inviteerr");
    const reason = await saveInvite({ name: form.name.value, email: form.email.value, role: form.role.value });
    if (reason) { if (err) err.textContent = inviteFailureText(reason); return; }
    toast("Invite saved. Copy the link. Mail was not sent.");
  };
  A.querySelectorAll("[data-invite-copy]").forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.inviteCopy); toast("Link copied. Mail was not sent."); }
    catch { toast("Select the link to copy it. Mail was not sent."); }
  });
  A.querySelectorAll("[data-invite-resend]").forEach(b => b.onclick = async () => {
    try { await resendInvite(b.dataset.inviteResend); toast("Invite resent. Copy the new link. Mail was not sent."); }
    catch (e) { toast("Couldn't resend (" + (e.code || "error") + ")."); }
  });
  A.querySelectorAll("[data-invite-cancel]").forEach(b => b.onclick = async () => {
    if (!confirm("Cancel this invite? The link will stop working.")) return;
    try { await cancelInvite(b.dataset.inviteCancel); toast("Invite cancelled."); }
    catch (e) { toast("Couldn't cancel (" + (e.code || "error") + ")."); }
  });
}
function renderAdmin() {
  donePill(); reimbPill(); inboxSub();
  if (!me || me.role !== "admin") return;
  if (ui.view === "invoices" && me.role !== "admin") ui.view = "home";
  if (ui.myJobs) return renderOperator();
  if ($("#dlg").open) return;          // don't redraw under an open job card
  const force = ui.forceRender; ui.forceRender = false;
  if (!force && (ui.view === "compliance" || ui.view === "prestart") && document.querySelector("#compform, #prestartform")) return;
  if (!ui.tsForce && ui.view === "timesheet" && (ui.tsBusy || ui.tsAsk || (ui.tsMachineShift && document.getElementById("tsmachine")))) return;
  if (!ui.tsForce && ui.view === "timesheet" && (ui.tsDirty || ui.tsEdit) && ($("#tsman") || $("#tsf"))) return;
  if (ui.view === "chat" && document.activeElement?.closest?.(".chat-compose")) return;
  if (ui.view === "staff" && document.activeElement?.closest?.("#invitef")) return;
  document.body.className = "admin";
  const fj = filtered(), und = (ui.undated || []).filter(j => (!ui.typeF || j.type === ui.typeF));
  const all = [...fj, ...und.filter(u => !fj.some(j => j.id === u.id))];
  const quotesHtml = ui.view === "quotes" ? adminViewRouter(ui.view, ui, { esc, $$, staff, jobs: all, todayStr, rerender: () => renderAdmin(), canEditQuoteRates }) : null;
  const staffHtml = ui.view === "staff" ? staffViewHtml(ui.invites || [], { now: inviteDisplayNow(), error: ui.invitesErr || "" }) : null;
  paintBrand();
  $("#app").innerHTML = shell(staffHtml != null ? staffHtml : ui.view === "settings" ? settingsView() : ui.view === "dispatch" ? dispatchView(all) : ui.view === "invoices" ? invoicesView() : ui.view === "reimb" ? reimbView() : ui.view === "timesheet" ? tsView() : ui.view === "completed" ? completedView(all) : ui.view === "unscheduled" ? unscheduledView(all) : ui.view === "home" ? homeView(all) : ui.view === "compliance" || ui.view === "prestart" ? COMP.adminHtml() : ui.view === "safety" ? safetyView() : ui.view === "swms" ? swmsView() : ui.view === "clients" ? clientsView() : ui.view === "inbox" ? inboxView(all) : ui.view === "chat" ? CHAT.teamHtml() : quotesHtml != null ? quotesHtml : jobsView(all));
  const A = $("#app"); inboxBadge();
  CHAT.watch([...(jobs || []), ...(ui.undated || [])]);
  if (ui.view === "chat") CHAT.mount(A);
  if (ui.view === "invoices") bindInvoices(A);
  if (ui.view === "clients") bindClients(A);
  if (ui.view === "inbox") bindInbox(A);
  if (ui.view === "reimb") bindReimb(A);
  if (ui.view === "timesheet") bindTs(A, renderAdmin);
  if (ui.view === "quotes") QG.bindAdmin({ ui, A });
  if (ui.view === "staff") bindStaff(A);
  if (ui.view === "compliance" || ui.view === "prestart") COMP.bind(A);
  if (ui.view === "settings") bindSettings(A);
  A.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { ui.navOpen = false;
    if (b.dataset.view === "myjobs") { ui.myJobs = true; ui.opSel = null; window.scrollTo(0, 0); return renderAdmin(); }
    if (b.dataset.view !== "compliance") COMP.abandon();
    ui.view = b.dataset.view; if (ui.view === "invoices" && me.role !== "admin") ui.view = "home"; ui.forceRender = true; renderAdmin(); });
  if ($("#burger")) $("#burger").onclick = () => { ui.navOpen = !ui.navOpen; renderAdmin(); };
  A.querySelectorAll("[data-grp]").forEach(b => b.onclick = () => { const g = b.dataset.grp; if (NAV_GROUPS.find(x => x[0] === g)[3].includes(ui.view)) return;
    ui.navCol[g] = !ui.navCol[g]; try { localStorage.setItem("hwNavCol", JSON.stringify(ui.navCol)); } catch {} renderAdmin(); });
  if (ui.view === "dispatch" && PHONE.matches) bindMobileDispatch(A, [...jobs, ...(ui.undated || [])]);
  if ($("#optorder")) $("#optorder").onclick = () => ROUTE.open({ date: (PHONE.matches && ui.mday) || todayStr() });
  A.querySelectorAll("[data-cq]").forEach(b => b.onclick = () => { ui.cq = b.dataset.cq; renderAdmin(); });
  if (ui.view === "completed" && canXero()) { bindXc(A, ui.xcList); if ($("#xcall")) $("#xcall").onclick = () => { const l = ui.xcList.filter(j => !j.xeroCheckPending);
    if (l.length && confirm(`Check ${l.length} completed job${l.length === 1 ? "" : "s"} in Xero?\n\nRead-only: nothing is created or changed in Xero.`)) checkXero(l); }; }
  A.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { ui.queue = b.dataset.q; renderAdmin(); });
  A.querySelectorAll("[data-dv]").forEach(b => b.onclick = () => { ui.dview = b.dataset.dv; ui.wk = 0; renderAdmin(); });
  A.querySelectorAll("[data-wk]").forEach(b => b.onclick = () => { ui.wk = +b.dataset.wk === 0 ? 0 : ui.wk + +b.dataset.wk; renderAdmin(); });
  if ($("#fs")) $("#fs").onchange = e => { ui.staffF = e.target.value; renderAdmin(); };
  if ($("#ft")) $("#ft").onchange = e => { ui.typeF = e.target.value; renderAdmin(); };
  if ($("#new")) $("#new").onclick = () => editJob(null);
  if ($("#findall")) $("#findall").onclick = async () => {
    try { await setDoc(doc(db, "meta", "findAllPos"), { status: "pending", requestedBy: me.name, requestedAt: new Date().toISOString() });
      toast("Find all POs queued - the box runs it within 2 min (6am-8pm); each job shows its result"); }
    catch (e) { toast("Not queued: " + (e.code || e.message)); } };
  const jq = $("#jq");
  if (jq) {
    jq.oninput = () => { const pos = jq.selectionStart; ui.q = jq.value; renderAdmin(); const n = $("#jq"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } };
    jq.onkeydown = e => { if (e.key === "Escape" && ui.q) { ui.q = ""; renderAdmin(); $("#jq")?.focus(); } };
  }
  if ($("#jqx")) $("#jqx").onclick = () => { ui.q = ""; renderAdmin(); $("#jq")?.focus(); };
  A.querySelectorAll("[data-sched]").forEach(b => b.onclick = ev => { ev.stopPropagation();
    const j = [...jobs, ...(ui.undated || [])].find(x => x.id === b.dataset.sched); if (!j) return;
    editJob(j); const f = $("#jf"); if (f) { f.date.value = todayStr(); f.date.focus(); f.date.showPicker?.(); } });
  A.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { const v = b.dataset.go;
    if (v === "myjobs") { ui.myJobs = true; ui.opSel = null; window.scrollTo(0, 0); return renderAdmin(); }
    if (v === "q-ip") { ui.view = "jobs"; ui.queue = "All"; } else ui.view = v;
    if (ui.view !== "compliance") COMP.abandon();
    if (ui.view === "invoices" && me.role !== "admin") ui.view = "home";
    ui.navOpen = false; window.scrollTo(0, 0); ui.forceRender = true; renderAdmin(); });
  const pool = [...jobs, ...(ui.undated || [])];
  A.querySelectorAll("[data-id]").forEach(el => {
    el.onclick = ev => { if (ev.target.closest("input,button,label,textarea")) return; editJob(pool.find(j => j.id === el.dataset.id) || (ui.done || []).find(j => j.id === el.dataset.id)); };
    el.ondragstart = ev => { ev.dataTransfer.setData("text/plain", el.dataset.id + "|" + (el.closest("[data-staff]")?.dataset.staff || "")); el.classList.add("dragging"); };
    el.ondragend = () => el.classList.remove("dragging");
  });
  // iPad / touch: HTML5 drag is unreliable, so press-and-hold a board chip or unscheduled card to open the Move sheet; tap still opens the job.
  if (TOUCH.matches && !PHONE.matches) A.querySelectorAll(".dchip[data-id],.uj[data-id]").forEach(el => {
    el.draggable = false; el.ondragstart = null; let t = null, held = false;
    const clear = () => { clearTimeout(t); t = null; };
    el.addEventListener("touchstart", () => { held = false; clear(); t = setTimeout(() => { held = true; const j = pool.find(x => x.id === el.dataset.id); if (j) moveSheet(j); }, 500); }, { passive: true });
    el.addEventListener("touchmove", clear, { passive: true }); el.addEventListener("touchend", clear); el.addEventListener("touchcancel", clear);
    el.addEventListener("contextmenu", e => e.preventDefault());
    el.addEventListener("click", e => { if (held) { e.stopImmediatePropagation(); e.preventDefault(); held = false; } }, true);
  });
  A.querySelectorAll(".drop").forEach(z => {
    z.ondragover = ev => { ev.preventDefault(); z.classList.add("over"); };
    z.ondragleave = () => z.classList.remove("over");
    z.ondrop = ev => { ev.preventDefault(); z.classList.remove("over");
      const [id, from] = ev.dataTransfer.getData("text/plain").split("|"); const j = pool.find(x => x.id === id);
      if (j) dispatchMove(j, z.dataset.date, from, z.dataset.staff, z.dataset.hour); };
  });
}
// Dispatch drag: date (and optionally hour / staff row). Writes Firestore only (admin), marks editedInApp so the
// 30-min ServiceM8 import keeps the change. Nothing is written to ServiceM8.
async function dispatchMove(j, date, fromKey, toKey, hour) {
  const u = { date, editedInApp: true, updatedAt: serverTimestamp(), updatedBy: me.uid };
  if (hour) u.time = String(hour).padStart(2, "0") + ":" + ((j.time || "00:00").slice(3) || "00");
  if (toKey && fromKey !== toKey) {
    const find = k => staff.find(s => skey(s) === k);
    let names = namesOf(j).slice(); const from = find(fromKey), to = find(toKey);
    if (from) names = names.filter(n => n.toLowerCase() !== from.name.toLowerCase());
    if (toKey === "_none") names = []; else if (to && !names.some(n => n.toLowerCase() === to.name.toLowerCase())) names.push(to.name);
    u.assignedNames = names;
    u.assigned = names.map(n => (staff.find(s => s.name.toLowerCase() === n.toLowerCase()) || {}).uid).filter(Boolean);
  }
  if (j.date === date && !u.assignedNames && !u.time) return;
  try { await updateDoc(doc(db, "jobs", j.id), u); } catch (e) { return toast("Not saved: " + (e.code || e.message)); }
  if (ui.undated) ui.undated = ui.undated.filter(x => x.id !== j.id);
  toast(`Rescheduled to ${shortDate(date)}${u.time ? " " + u.time : ""}${u.assignedNames ? " · " + (u.assignedNames.join(", ") || "Unallocated") : ""}`);
}
// "Remove from dispatch board": clears date/time (job goes back to Unscheduled; nothing is deleted). The next sync deletes
// this visit's staff bookings in ServiceM8 (sm8_push), not the job. Undo puts the date/time back.
async function unscheduleJob(j) {
  const prev = { date: j.date || "", time: j.time || "" };
  const u = { date: "", time: "", editedInApp: true, unscheduledFrom: prev, unscheduledAt: new Date().toISOString(), unscheduledByName: me.name, updatedAt: serverTimestamp(), updatedBy: me.uid };
  await updateDoc(doc(db, "jobs", j.id), u);
  Object.assign(j, { date: "", time: "" }); if (ui.undated && !ui.undated.some(x => x.id === j.id)) ui.undated.push(j);
  undoToast(`#${jobNo(j)} removed from the dispatch board (now Unscheduled)`, async () => {
    await updateDoc(doc(db, "jobs", j.id), { ...prev, editedInApp: true, unscheduledFrom: null, updatedAt: serverTimestamp(), updatedBy: me.uid });
    Object.assign(j, prev); if (ui.undated) ui.undated = ui.undated.filter(x => x.id !== j.id); toast("Back on " + shortDate(prev.date)); renderAdmin(); });
  renderAdmin();
}
const armBtn = (b, label, armed, ms = 4000) => { if (b.classList.contains("arm")) return true;
  b.classList.add("arm"); const o = b.textContent; b.textContent = armed; clearTimeout(b._t);
  b._t = setTimeout(() => { b.classList.remove("arm"); b.textContent = label || o; }, ms); return false; };
async function moveJob(j, date) {
  await updateDoc(doc(db, "jobs", j.id), { date, editedInApp: true, updatedAt: serverTimestamp(), updatedBy: me.uid });
  if (ui.undated) ui.undated = ui.undated.filter(x => x.id !== j.id);
  toast(`Moved to ${dayLabel(date)}`);
}
// Split: new app job (same client/site/booking) gets the ticked lines; the original keeps the rest. The existing PO stays on
// the job whose type matches the original type. Both get a Find PO request. splitHoldUntil (10 min) keeps sm8_push off
// both so the split can be undone before it reaches ServiceM8; the push then creates the new job (source app, no sm8Uuid).
const SPLIT_COPY = ["client", "address", "contactName", "contactPhone", "date", "time", "durationHrs", "assigned", "assignedNames", "status", "notes", "clientUuid", "companyUuid"];
async function splitJob(j, pick) {
  const lines = taskLines(j.description), mv = lines.filter((_, i) => pick.includes(i)), keep = lines.filter((_, i) => !pick.includes(i));
  const kindOf = ls => { const ks = [...new Set(ls.map(x => x.k).filter(Boolean))]; return ks.length === 1 ? ks[0] : (ks[0] || "other"); };
  const newType = kindOf(mv), keepType = kindOf(keep), origType = j.type || keepType;
  const poToNew = newType === origType && keepType !== origType;
  const hold = new Date(Date.now() + 10 * 60000).toISOString(), at = new Date().toISOString(), lk = { poLookupStatus: "pending", poLookupAt: at, poLookupRequestedBy: me.name + " (split)", poLookupCandidates: [] };
  const base = Object.fromEntries(SPLIT_COPY.filter(k => j[k] !== undefined).map(k => [k, j[k]]));
  const nj = { ...base, type: newType, description: mv.map(x => x.t).join("\n"), po: poToNew ? (j.po || "") : "", source: "app", log: [],
    splitFrom: j.id, splitAt: at, splitBy: me.name, splitHoldUntil: hold, editedInApp: false, ...lk, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: me.uid };
  const ref = await addDoc(collection(db, "jobs"), nj);
  const undo = { description: j.description || "", type: j.type || null, po: j.po || "", poAmount: j.poAmount ?? null, editedInApp: !!j.editedInApp };
  await updateDoc(doc(db, "jobs", j.id), { description: keep.map(x => x.t).join("\n"), type: keepType, ...(poToNew ? { po: "", poAmount: null } : {}),
    splitTo: ref.id, splitAt: at, splitUndo: undo, splitHoldUntil: hold, editedInApp: true, ...lk, updatedAt: serverTimestamp(), updatedBy: me.uid });
  $("#dlg").close();
  undoToast(`Split #${jobNo(j)}: new ${TYPES[newType] || newType} job created (syncs to ServiceM8 in ~10 min)`, () => undoSplit({ ...j, splitTo: ref.id, splitUndo: undo }));
}
async function undoSplit(j) {
  const nd = await getDoc(doc(db, "jobs", j.splitTo));
  if (!nd.exists()) throw new Error("the new job has already synced to ServiceM8 - undo there");
  if (nd.data().sm8Uuid) throw new Error("the new job is already in ServiceM8 - undo there");
  const o = (await getDoc(doc(db, "jobs", j.id))).data() || {}, u = o.splitUndo || j.splitUndo;
  if (!u) throw new Error("no undo data");
  if (nd.exists()) await deleteDoc(doc(db, "jobs", j.splitTo));
  await updateDoc(doc(db, "jobs", j.id), { description: u.description, type: u.type, po: u.po, poAmount: u.poAmount, editedInApp: u.editedInApp,
    splitTo: null, splitUndo: null, splitHoldUntil: null, updatedAt: serverTimestamp(), updatedBy: me.uid });
  if ($("#dlg").open) $("#dlg").close();
  toast("Split undone");
}
function editJob(j) {
  const n = !j; j = j || { date: todayStr(), time: "07:00", durationHrs: 4, status: "Scheduled", type: "spoil", assigned: [], client: CLIENTS[0] };
  const d = $("#dlg");
  const qq = n ? "Work Order" : queueOf(j), hist = [];
  if (j.source === "sm8") hist.push(["ServiceM8", `Imported from ServiceM8 job #${j.sm8JobNo || "?"} (${j.sm8Status || "?"})`]);
  if (j.editedInApp) hist.push(["App", "Edited in the app – ServiceM8 import will no longer overwrite this job"]);
  if (j.completedByName) hist.push([j.completedByName, `Completed${j.loads ? ` · ${j.loads} loads` : ""}`]);
  const SL = { "Scheduled": "Work Order – scheduled", "In progress": "Work Order – in progress", "Done": "Completed", "Cancelled": "Unsuccessful" };
  d.className = "jobcard"; d.onclose = () => renderAdmin();
  d.innerHTML = `<form method="dialog" id="jf" class="jc">
    <div class="jc-top ${QCLS[qq]}"><div><div class="jc-no">${n ? "New Job" : "Job #" + esc(jobNo(j))}</div>${n ? "" : ipTop(j, "onbar")}<div class="jc-q">${qq}${j.sm8Status === "Quote" ? " (quote in ServiceM8)" : ""}</div></div>
      <label class="jc-st">Job Status<select name="status">${STATUSES.map(s => `<option value="${s}" ${j.status === s ? "selected" : ""}>${SL[s]}</option>`).join("")}</select></label>
      <button value="cancel" formnovalidate class="jc-x" title="Close">✕</button></div>
    <div class="jc-body"><div class="jc-col">
      <h4>Client &amp; Site</h4>
      <label>Client<input name="client" list="clients" value="${esc(j.client)}" required><datalist id="clients">${CLIENTS.map(c => `<option value="${esc(c)}">`).join("")}</datalist></label>
      ${n ? "" : `<div class="supcard" data-sup="${esc(j.id)}"></div>`}
      <label>Job (site) address<input name="address" value="${esc(j.address)}" required></label>
      ${j.address ? `<a class="sub" href="${mapsUrl(j.address)}" target="_blank" rel="noopener">📍 Open in Maps</a>` : ""}
      <h4>Job Description</h4>
      <textarea name="description" rows="4">${esc(j.description)}</textarea>
      ${!n && isMixed(j) ? `<div class="splitbox"><b>⚠ Mixed work:</b> ${esc(mixedKinds(j).map(k => TYPES[k] || k).join(" + "))}. Tick the lines to move to a new job:
        ${taskLines(j.description).map((x, i) => `<label class="ck"><input type="checkbox" class="spl" data-i="${i}" ${x.k && x.k !== (j.type || taskLines(j.description)[0].k) ? "checked" : ""}> ${esc(x.t)} <span class="sub">${esc(TYPES[x.k] || "?")}</span></label>`).join("")}
        <button type="button" id="splitbtn" class="btn">✂ Split into new job</button></div>` : ""}
      ${!n && j.splitTo && !j.splitSynced ? `<div class="splitbox">Split into a new job (${esc(j.splitTo)}). <button type="button" id="splitundo" class="btn">↩ Undo split</button></div>` : ""}
      <p class="hint">Spoil removal is always its own job — never add spoil to a backslab job.</p>
      <div class="row"><label>Category<select name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${j.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>Purchase Order #<input name="po" value="${esc(j.po)}"></label>
        <label>Loads<input type="number" min="0" name="loads" value="${esc(j.loads ?? "")}"></label></div>
      ${canSeeMoney() ? `<div class="row"><label>PO value $ (ex GST)<input type="number" step="0.01" min="0" name="poAmount" value="${esc(j.poAmount ?? "")}" placeholder="from the PO"></label></div>
      ${j.poAmount != null ? `<p class="hint">PO value $${esc(Number(j.poAmount).toFixed(2))} ex GST${j.poAmountBasis ? " · " + esc(j.poAmountBasis) : ""}${j.poAmountSource ? " · " + esc(j.poAmountSource) : ""}</p>` : ""}
      ${!n && overBy(j, invAmountDefault(j)) ? `<p class="hint"><span class="overpo">Over PO by ${$$(overBy(j, invAmountDefault(j)))}</span> (charged ${$$(invAmountDefault(j))} ex GST)</p>` : ""}
      ${n ? "" : `<div class="row"><button type="button" id="emailsupj" class="btn" title="Opens your email app (nothing is sent automatically)">✉ Email supervisor (PO exceeded)</button></div>`}` : `<input type="hidden" name="poAmount" value="${esc(j.poAmount ?? "")}">`}
      ${n ? "" : `<div class="row"><button type="button" id="findpo" class="btn">🔎 Find PO</button><span id="polk" class="sub">${poLookupHtml(j)}</span></div>`}
    </div><div class="jc-col">
      <h4>Staff Allocation &amp; Schedule</h4>
      <div class="row"><label>Date<input type="date" name="date" value="${esc(j.date)}"></label>
        <label>Start<input type="time" name="time" value="${esc(j.time)}"></label>
        <label>Hours<input type="number" step="0.5" min="0" name="durationHrs" value="${esc(j.durationHrs)}"></label></div>
      ${!n && j.date && !["Done", "Cancelled"].includes(j.status) ? `<div class="row"><button type="button" id="unschbtn" class="btn">✕ Remove from dispatch board</button><span class="sub">Back to Unscheduled; the ServiceM8 booking is removed at the next sync (the job stays).</span></div>` : ""}
      <fieldset class="staffs">${staff.map(s => `<label class="ck"><input type="checkbox" name="assigned" value="${esc(skey(s))}" ${namesOf(j).map(x => x.toLowerCase()).includes(s.name.toLowerCase()) ? "checked" : ""}> <span class="av">${esc(s.name[0])}</span>${esc(label(s.name))}</label>`).join("")}</fieldset>
      <h4>Notes</h4>
      <textarea name="notes" rows="2" placeholder="Office notes">${esc(j.notes)}</textarea>
      <h4>Diary</h4>
      <div class="diary">${(j.log || []).map(l => `<div class="de"><span class="av">${esc((l.byName || "?")[0])}</span><div><small>${esc(l.byName)} · ${esc(l.at)}</small><div>${esc(l.text)}</div></div></div>`).join("")}
        ${hist.map(([w, t]) => `<div class="de sys"><span class="av">i</span><div><small>${esc(w)}</small><div>${esc(t)}</div></div></div>`).join("")}
        ${!(j.log || []).length && !hist.length ? `<p class="muted sub">No diary entries yet. Site notes from staff appear here.</p>` : ""}</div>
      ${!n ? `<h4>Photos</h4><button type="button" class="sm-btn" id="emailph">📧 Email photos</button> <span data-photoslot="${esc(j.id)}" data-photorole="cloud" data-photovariant="sm"></span> ${emailedPhotosNote(j)} <button type="button" class="sm-btn incbtn" data-inc="${j.id}">⚠ Report incident</button> <button type="button" class="sm-btn" data-swms="${j.id}">📋 View SWMS</button>${jobReceiptsHtml(j)}${cloudRetentionHtml(j)}` : ""}
    </div></div>
    <p id="ferr" class="err"></p>
    <div class="btns jc-foot"><button value="cancel" formnovalidate class="sm-btn">Close</button><button value="save" class="sm-btn primary">Save Job</button></div></form>`;
  d.showModal();
  if (!n) jobTabs(d, j);
  if (!n) { rememberJob(j); $("#emailph").onclick = () => emailPhotos(j); watchJobPhotos(j); paintPhotoSlots(); }
  if (!n && $("#cloudexport")) $("#cloudexport").onclick = () => downloadGalleryCopy(j).catch(e => toast(e.message || "Download failed"));
  if (!n) { wireFindPo(j); supervisors(); wireJobReceipts(j); fillSupCard(j); }
  if (!n && $("#unschbtn")) $("#unschbtn").onclick = ev => { if (!armBtn(ev.currentTarget, "✕ Remove from dispatch board", "Tap again to remove from the board")) return;
    d.close(); unscheduleJob(j).catch(e => toast("Not removed: " + (e.code || e.message))); };
  if (!n) $("#emailsupj").onclick = () => emailSupervisor({ ...j, po: $("#jf").po.value.trim() || j.po, poAmount: $("#jf").poAmount.value === "" ? j.poAmount : +$("#jf").poAmount.value }, invAmountDefault(j)).catch(e => toast(e.message));
  if (!n && $("#splitbtn")) $("#splitbtn").onclick = ev => { const b = ev.currentTarget;
    const lines = taskLines(j.description), pick = [...d.querySelectorAll(".spl")].filter(c => c.checked).map(c => +c.dataset.i);
    if (!pick.length || pick.length === lines.length) return toast("Tick some (not all) lines to move");
    if (!b.classList.contains("arm")) { b.classList.add("arm"); b.textContent = `Tap again: move ${pick.length} line(s) to a new job`; clearTimeout(b._t);
      b._t = setTimeout(() => { b.classList.remove("arm"); b.textContent = "✂ Split into new job"; }, 5000); return; }
    splitJob(j, pick).catch(e => toast("Not split: " + (e.code || e.message))); };
  if (!n && $("#splitundo")) $("#splitundo").onclick = () => undoSplit(j).catch(e => toast("Undo failed: " + (e.code || e.message)));
  const f = $("#jf");
  f.description.oninput = () => { if (n) f.type.value = guessType(f.description.value); };
  f.onsubmit = async ev => {
    if (ev.submitter?.value !== "save") return;
    ev.preventDefault();
    const typ = f.type.value, ds = f.description.value.toLowerCase();
    if (typ === "backslab" && ds.includes("spoil")) { $("#ferr").textContent = "Spoil removal must be a separate job. Remove it from this backslab and create a Spoil removal job."; return; }
    if (typ === "spoil" && /back ?slab|slab clean|back blade/.test(ds)) { $("#ferr").textContent = "Backslab work must be a separate job from spoil removal."; return; }
    const picked = [...f.querySelectorAll("[name=assigned]:checked")].map(x => staff.find(s => skey(s) === x.value)).filter(Boolean);
    const assigned = picked.filter(s => s.uid).map(s => s.uid);
    const data = { client: f.client.value.trim(), address: f.address.value.trim(), type: typ, po: f.po.value.trim().toUpperCase().replace(/\s+/g, ""),
      description: f.description.value.trim(), date: f.date.value, time: f.time.value, durationHrs: f.durationHrs.value ? +f.durationHrs.value : null,
      assigned, assignedNames: picked.map(s => s.name), status: f.status.value, notes: f.notes.value.trim(),
      loads: f.loads.value === "" ? null : +f.loads.value, editedInApp: true,
      ...(String(j.poAmount ?? "") !== f.poAmount.value ? { poAmount: f.poAmount.value === "" ? null : Math.round(+f.poAmount.value * 100) / 100, poAmountBasis: f.poAmount.value === "" ? null : "entered in app (ex GST)", poAmountSource: "app" } : {}), updatedAt: serverTimestamp(), updatedBy: me.uid };
    if (data.status === "Done" && j.status !== "Done") Object.assign(data, { completedAt: serverTimestamp(), completedBy: me.uid });
    try {
      if (n) await addDoc(collection(db, "jobs"), { ...data, source: "app", log: [], createdAt: serverTimestamp() });
      else await updateDoc(doc(db, "jobs", j.id), data);
      d.close(); toast("Saved"); renderAdmin(); if (!data.date) location.reload();
    } catch (e) { $("#ferr").textContent = e.message; }
  };
}

function jobTabs(d, j) {
  const f = d.querySelector("#jf"), top = f.querySelector(".jc-top"), body = f.querySelector(".jc-body");
  const names = namesOf(j), q = queueOf(j);
  const st = j.status === "Done" ? `<span class="qpill q-comp">Work completed</span>` : j.status === "In progress" ? ipPill(j) || `<span class="qpill ip">In progress</span>` : `<span class="qpill ${QCLS[q]}">${esc(q)}</span>`;
  top.insertAdjacentHTML("afterend", `<div class="jc-facts">
    <div class="kf kf-addr"><small>Address</small><b>${j.address ? `<a href="${mapsUrl(j.address)}" target="_blank" rel="noopener">📍 ${esc(j.address)}</a>` : "—"}</b><span class="sub">${esc(j.client || "")}</span></div>
    <div class="kf"><small>When</small><b>${j.date ? esc(shortDate(j.date)) : "Unscheduled"}</b><span class="sub">${esc(j.time || "")}${j.durationHrs ? " · " + esc(j.durationHrs) + "h" : ""}</span></div>
    <div class="kf"><small>Staff</small><b>${names.length ? esc(names.map(label).join(", ")) : `<span class="unal">Unallocated</span>`}</b></div>
    <div class="kf"><small>PO</small><b>${j.po ? esc(j.po) : `<span class="nopo">No PO</span>`}</b></div>
    <div class="kf"><small>Status</small><b class="pstack">${st}</b></div>${canXero() && q === "Completed" ? `<div class="kf kf-xero"><small>Xero</small><b>${xcCell(j)}</b></div>` : ""}</div>
    <div class="jc-tabs" role="tablist">${[["details", "Details"], ["chat", "Chat"], ["photos", "Photos"], ["sup", "Supervisor"], ["safety", "Safety"], ["hist", "History"]].map(([k, l]) => `<button type="button" role="tab" data-jt="${k}">${l}${k === "chat" ? CHAT.badge("job_" + j.id) : ""}</button>`).join("")}</div>`);
  const pane = k => { const x = document.createElement("div"); x.className = "jc-pane"; x.dataset.pane = k; return x; };
  const P = { details: pane("details"), chat: pane("chat"), photos: pane("photos"), sup: pane("sup"), safety: pane("safety"), hist: pane("hist") };
  const cols = [...body.querySelectorAll(".jc-col")];
  const detL = document.createElement("div"), detR = document.createElement("div"); detL.className = detR.className = "jc-col";
  cols.forEach((c, ci) => { let sec = "details";
    [...c.children].forEach(el => { if (el.tagName === "H4") { const t = el.textContent.toLowerCase(); sec = t.startsWith("diary") ? "hist" : (t.startsWith("photos") || t.startsWith("receipts")) ? "photos" : "details"; }
      (sec === "details" ? (ci ? detR : detL) : P[sec]).appendChild(el); }); });
  const det = document.createElement("div"); det.className = "jc-body2"; det.append(detL, detR); P.details.appendChild(det);
  const sup = detL.querySelector(".supcard"); if (sup) P.sup.appendChild(sup);
  const es = det.querySelector("#emailsupj"); if (es) P.sup.appendChild(es.closest(".row"));
  P.sup.insertAdjacentHTML("afterbegin", `<h4>Supervisor</h4>`);
  P.photos.querySelectorAll(".incbtn,[data-swms]").forEach(x => x.remove());
  const incs = (ui.incidents || []).filter(r => r.jobId === j.id || (r.jobNo && String(r.jobNo) === String(jobNo(j))));
  P.safety.innerHTML = `<h4>Safety</h4><div class="safebtns"><button type="button" class="sm-btn" data-swms="${j.id}">📋 View SWMS</button><button type="button" class="sm-btn incbtn" data-inc="${j.id}">⚠ Report incident on this job</button></div>
    <h4>Incidents on this job</h4>${incs.map(r => `<div class="at-j" data-incid="${esc(r.id)}"><b>${esc(r.reportNo || "")}</b> ${esc(r.type || "")} · <span class="qpill ${incCls(r)}">${esc(r.status)}</span></div>`).join("") || `<p class="muted sub">None reported.</p>`}`;
  if (!P.hist.children.length) P.hist.innerHTML = `<p class="muted sub">No history yet.</p>`;
  P.chat.innerHTML = CHAT.jobHtml(j);
  body.innerHTML = ""; body.classList.add("tabbed"); Object.values(P).forEach(x => body.appendChild(x));
  const show = k => { ui.jtab = k; f.querySelectorAll("[data-jt]").forEach(b => b.classList.toggle("on", b.dataset.jt === k)); Object.entries(P).forEach(([kk, x]) => x.hidden = kk !== k); if (k === "photos") queuePhotoThumbs(f); if (k === "chat") CHAT.openJob(P.chat, j); };
  // v47: facts + tabs + panes share ONE scroll area (phones); display:contents elsewhere so iPad/desktop are unchanged
  if (!f.querySelector(".jc-scroll")) { const sc = document.createElement("div"); sc.className = "jc-scroll";
    f.insertBefore(sc, f.querySelector(".jc-facts")); sc.append(f.querySelector(".jc-facts"), f.querySelector(".jc-tabs"), body); }
  f.querySelectorAll("[data-jt]").forEach(b => b.onclick = () => show(b.dataset.jt));
  if (canXero()) bindXc(f, [j]);
  show("details");
}
// ------------------------------------------------------------------ invoicing (admin only)
// Invoice fields live on the job doc: invoiceNo (text), invoiceAmount (ex GST), invoiceDescription, invoiceContact,
// invoiceDate (YYYY-MM-DD = job date, like hwdata.py), numberedAt/By, invoiced (bool), invoicedAt/By.
// Numbers: max(meta/invoicing.lastNo, meta/boxInvoiceMax.max (written by tools/export_completed.py from
// completed.json), every job invoiceNo, 5402) + 1, assigned inside a Firestore transaction.
const INV_FLOOR = 5402;                  // last number used on the planner's Completed sheet / completed.json (10/10/2026)
const XERO_COLS = ["*ContactName", "EmailAddress", "POAddressLine1", "*InvoiceNumber", "Reference", "*InvoiceDate", "*DueDate",
  "InventoryItemCode", "*Description", "*Quantity", "*UnitAmount", "Discount", "*AccountCode", "*TaxType", "Currency"];
const STD_CLIENTS = ["Orbit Homes (Qld) Pty Ltd", "Torsion Built Pty Ltd", "Silkwood Homes", "OJ Pippin Homes", "Envision Homes"];
const INV_TASK = { spoil: "Spoil removal", backslab: "Backslab", clean: "Site clean" };
const ABBR = { street: "St", court: "Crt", circuit: "Cct", crescent: "Cres", avenue: "Ave", road: "Rd", drive: "Dr", place: "Pl", lane: "Lane", parade: "Pde", terrace: "Tce" };
function tidyAddress(a) {          // port of hwdata.tidy_address
  if (!a) return "";
  let s = a.replace(/[\t\r\n"]+/g, " ").replace(/^[ ,]+|[ ,]+$/g, "");
  s = s.replace(/\b(?:QLD|Qld|qld)\s*\d{4}\s*$/, "").replace(/^[ ,]+|[ ,]+$/g, "");
  s = s.replace(/\blot\s*no\.?\s*(\d+\w?)\s*,?\s*st\s*no\.?\s*(\d+\w?)\s*,?/gi, "Lot $1 ($2) ");
  s = s.replace(/\blot\s*(\d)/gi, "Lot $1").replace(/\s+/g, " ").replace(/^[ ,]+|[ ,]+$/g, "");
  s = s.split(" ").map(w => { const core = w.replace(/[^A-Za-z]/g, "");
    if (!core || core === "QLD" || core === "NSW" || !(core === core.toUpperCase() || core === core.toLowerCase())) return w;
    return w.replace(/[A-Za-z]+/, m => m[0].toUpperCase() + m.slice(1).toLowerCase()); }).join(" ");
  s = s.replace(/\b(Street|Court|Circuit|Crescent|Avenue|Road|Drive|Place|Parade|Terrace)\b(?!,)\s+([A-Z][a-z]+)/g, (m, t, sub) => `${ABBR[t.toLowerCase()] || t}, ${sub}`);
  s = s.replace(/\b(Street|STREET)\b,/g, "St,");
  return s.replace(/^[ ,]+|[ ,]+$/g, "");
}
const isRealPo = p => !!p && /\d{4,}/.test(p) && !/REMOVED|M3/i.test(p);
const invContact = j => j.invoiceContact || (/^private( job)?$/i.test(j.client || "") ? tidyAddress(j.address).replace(/,/g, "") + " (private)" : (j.client || ""));
function invDescDefault(j) {        // hwdata.xero_description: "<Task> - <tidy address> (N hrs)"; hours only on spoil (export_completed)
  let t = INV_TASK[j.type] || (j.description || "Job").trim(); t = t[0].toUpperCase() + t.slice(1);
  let s = j.address ? `${t} - ${tidyAddress(j.address)}` : t;
  if (j.type === "spoil" && j.durationHrs) s += ` (${+j.durationHrs} hrs)`;
  return s;
}
// hwdata.py has no per-m³ / per-load rule (spoil has been priced by hours, e.g. 4 hrs = $2000), so no price is guessed.
// PO value (poAmount, ex GST, from the builder's PO) pre-fills the price until one is typed (invoiceAmount wins).
// ---- Find PO: the button flags the job (poLookupStatus 'pending'); the box worker tools/po_lookup.py (cron, 2 min,
// 6am-8pm) searches saved PO PDFs / Gmail hits and writes status + candidates back onto the job doc.
const PO_ST = { "orbit login needed": "🔒 Orbit login needed", pending: "⏳ queued", searching: "🔍 searching", found: "✅ found", choose: "☝️ pick one", "not found": "❌ not found", "needs portal": "🌐 needs Orbit portal" };
function poLookupHtml(j) {
  if (!j.poLookupStatus) return "";
  const cands = (j.poLookupCandidates || []).map((c, i) => `<div class="pocand">${esc(c.po)}${c.kind ? " · " + esc(c.kind) : ""}${canSeeMoney() && c.amount != null ? ` · $${esc(Number(c.amount).toFixed(2))} ex GST` : (c.amount != null ? "" : " · no amount")}${c.confidence ? ` <span class="conf conf-${esc(c.confidence)}">${esc(c.confidence)}</span>` : ""}<div class="sub">Source: ${esc(c.source || "?")}</div>
      ${j.po === c.po && j.poAmount === c.amount ? "" : `<button type="button" class="btn usepo" data-i="${i}">Use this</button>`}</div>`).join("");
  return `<b>${PO_ST[j.poLookupStatus] || esc(j.poLookupStatus)}</b> ${esc(j.poLookupMsg || "")}${j.poLookupAt ? ` <span class="sub">(${esc(String(j.poLookupAt).slice(0, 16).replace("T", " "))})</span>` : ""}${cands}`;
}
function wireFindPo(j) {
  const box = $("#polk");
  const wireUse = (cur) => box.querySelectorAll(".usepo").forEach(b => b.onclick = async () => {
    const c = cur.poLookupCandidates[+b.dataset.i];
    try { await updateDoc(doc(db, "jobs", j.id), { po: c.po, poAmount: c.amount ?? null, poAmountBasis: c.amount != null ? (c.basis || "ex GST") : null,
      poAmountSource: c.amount != null ? "Find PO: " + (c.source || "") : null, poLookupStatus: "found", poLookupMsg: `picked ${c.po} by ${me.name}`,
      editedInApp: true, updatedAt: serverTimestamp(), updatedBy: me.uid }); toast("PO set to " + c.po); $("#dlg").close(); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); } });
  wireUse(j);
  const unsub = onSnapshot(doc(db, "jobs", j.id), s => { if (!s.exists()) return; const cur = { id: s.id, ...s.data() }; box.innerHTML = poLookupHtml(cur); wireUse(cur); });
  $("#dlg").addEventListener("close", unsub, { once: true });
  $("#findpo").onclick = async () => {
    const at = new Date().toISOString();
    let rid = null;
    try { rid = (await addDoc(collection(db, "poLookups"), { jobId: j.id, address: j.address || "", lot: (String(j.address || "").match(/lot\s*(?:no\.?\s*)?(\w+)/i) || [])[1] || "",
      client: j.client || "", type: j.type || "", requestedBy: me.name, requestedByUid: me.uid, status: "pending", createdAt: serverTimestamp() })).id; } catch (e) { /* rules not pasted yet: job flag alone still works */ }
    try { await updateDoc(doc(db, "jobs", j.id), { poLookupStatus: "pending", poLookupMsg: "waiting for the box (checks every 2 min, 6am-8pm)", poLookupAt: at,
      poLookupRequestedBy: me.name, poLookupCandidates: [], ...(rid ? { poLookupId: rid } : {}), updatedAt: serverTimestamp(), updatedBy: me.uid }); toast("Find PO requested"); }
    catch (e) { toast("Not requested: " + (e.code || e.message)); }
  };
}
const invAmountDefault = j => (j.invoiceAmount ?? j.poAmount ?? null);
// Over PO: the price is always free to edit; the PO value is only the pre-fill. This is a note, never a block or a correction.
const overBy = (j, amt = j.invoiceAmount) => (amt == null || amt === "" || j.poAmount == null || !(+amt > +j.poAmount + 0.005)) ? 0 : Math.round((+amt - +j.poAmount) * 100) / 100;
const $$ = v => canSeeMoney() ? ("$" + Number(v).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : "";
const overPoHtml = (j, amt) => { if (!canSeeMoney()) return ""; const o = overBy(j, amt); return o ? `<span class="overpo">Over PO by ${$$(o)}</span> <button type="button" class="sm-btn emailsup" title="Opens your email app with a message to the supervisor (nothing is sent automatically)">✉ Email supervisor</button>` : ""; };
// Supervisor email: job field, then meta/supervisors (Orbit Call Forward / Torsion PO sender, by PO), then Torsion default, then remembered per client.
let SUPS = null;
async function supervisors() { if (!SUPS) { try { SUPS = (await getDoc(doc(db, "meta", "supervisors"))).data() || {}; } catch { SUPS = {}; } } return SUPS; }
async function supervisorFor(j) {
  if (j.supervisorEmail) return { email: j.supervisorEmail, name: j.supervisorName || "" };
  const m = await supervisors(), base = String(j.po || "").split("/")[0].replace(/\D/g, "");
  return (base && m.byPo?.[base]) || m.byClient?.[j.client] || m.remembered?.[(j.client || "").replace(/[.\/]/g, "_")] || null;
}
// ---- Inbox (owner only): inbox/{gmailMessageId} written by tools/sync_inbox.py. Tap opens the Gmail thread; 'read' is app-side.
function inboxSub() {
  if (!isOwner() || ui.inboxSub) return;
  ui.inboxSub = onSnapshot(collection(db, "inbox"), s => { ui.inbox = s.docs.map(d => ({ id: d.id, ...d.data() })); ui.inboxErr = "";
    if (ui.view === "inbox" || ui.view === "home") renderAdmin(); else inboxBadge(); },
    e => { ui.inbox = []; ui.inboxErr = e.code || e.message; if (ui.view === "inbox") renderAdmin(); });
}
const inboxUnread = () => (ui.inbox || []).filter(m => !m.read).length;
function inboxBadge() { document.querySelectorAll('.sm-nav[data-view="inbox"]').forEach(b => { let x = b.querySelector(".nbadge"); const n = inboxUnread();
  if (!n) return x && x.remove(); if (!x) { x = document.createElement("span"); x.className = "nbadge"; b.appendChild(x); } x.textContent = n; }); }
const BLD = ["All", "Orbit", "Torsion", "Silkwood"];
const mailDate = s => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleString("en-AU", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); };
function inboxView(all) {
  if (!isOwner()) return `<div class="sm-head"><h1>Inbox</h1></div><p class="muted pad">Owner only.</p>`;
  const b = ui.ib || "All", w = (ui.iq || "").toLowerCase().split(/\s+/).filter(Boolean), unreadOnly = ui.ibUnread;
  const L = (ui.inbox || []).filter(m => (b === "All" || m.builder === b) && (!unreadOnly || !m.read)
      && w.every(x => [m.subject, m.fromName, m.fromEmail, m.snippet, m.matchKey, m.jobLabel, (m.attachments || []).join(" ")].join(" ").toLowerCase().includes(x)))
    .sort((x, y) => String(y.date).localeCompare(String(x.date)));
  const cnt = k => (ui.inbox || []).filter(m => (k === "All" || m.builder === k) && !m.read).length;
  const jobsById = new Map(all.map(j => [j.id, j]));
  return `<div class="sm-head"><h1>Inbox</h1><span class="sub">Builder emails · last 30 days · ${ui.inbox ? ui.inbox.length : "…"} emails</span></div>
    ${ui.inboxErr ? `<p class="err pad">Inbox not available: ${esc(ui.inboxErr)}</p>` : ""}
    <div class="ibar">${BLD.map(k => `<button class="qtab ${b === k ? "on" : ""}" data-ib="${k}">${k}${cnt(k) ? ` <span class="nbadge">${cnt(k)}</span>` : ""}</button>`).join("")}
      <label class="ck ibun"><input type="checkbox" id="ibun" ${unreadOnly ? "checked" : ""}> Unread only</label></div>
    <div class="sbar"><span class="sbar-ic">🔍</span><input id="iq" type="search" placeholder="Search subject, sender, job, lot, attachment…" value="${esc(ui.iq || "")}"></div>
    <div class="ilist">${L.map(m => { const js = (m.jobIds || []).map(i => jobsById.get(i)).filter(Boolean);
      return `<div class="irow ${m.read ? "" : "unread"}"><a class="imain" href="${esc(m.link)}" target="_blank" rel="noopener" data-imsg="${esc(m.id)}">
        <div class="itop"><span class="ibld b-${esc((m.builder || "").toLowerCase())}">${esc(m.builder)}</span><b class="ifrom">${esc(m.fromName || m.fromEmail)}</b><span class="idate">${esc(mailDate(m.date))}</span></div>
        <div class="isubj">${esc(m.subject)}</div><div class="isnip sub">${esc(m.snippet)}</div>
        ${(m.attachments || []).length ? `<div class="sub iatt">📎 ${esc(m.attachments.join(", "))}</div>` : ""}</a>
        <div class="iside">${js.length ? js.map(j => `<button class="sm-btn ijob" data-ijob="${esc(j.id)}">Job #${esc(jobNo(j))}</button>`).join("") : m.matchKey ? `<span class="sub muted">${esc(m.matchKey)} · no job</span>` : ""}
          <button class="sm-btn iread" data-iread="${esc(m.id)}" title="${m.read ? "Mark unread" : "Mark read"}">${m.read ? "●" : "✓"}</button></div></div>`; }).join("")
      || `<p class="pad muted">${ui.inbox ? "No emails" : "Loading…"}</p>`}</div>`;
}
function bindInbox(A) {
  const all = [...jobs, ...(ui.undated || []), ...(ui.done || [])];
  A.querySelectorAll("[data-ib]").forEach(x => x.onclick = () => { ui.ib = x.dataset.ib; renderAdmin(); });
  const u = A.querySelector("#ibun"); if (u) u.onchange = () => { ui.ibUnread = u.checked; renderAdmin(); };
  const qi = A.querySelector("#iq"); if (qi) qi.oninput = () => { ui.iq = qi.value; const p = qi.selectionStart; renderAdmin(); const n = $("#iq"); n.focus(); n.setSelectionRange(p, p); };
  const setRead = (id, v) => updateDoc(doc(db, "inbox", id), { read: v, readAt: serverTimestamp() }).catch(e => toast("Not saved: " + (e.code || e.message)));
  A.querySelectorAll("[data-imsg]").forEach(x => x.addEventListener("click", () => { const m = (ui.inbox || []).find(y => y.id === x.dataset.imsg); if (m && !m.read) setRead(m.id, true); }));
  A.querySelectorAll("[data-iread]").forEach(x => x.onclick = () => { const m = (ui.inbox || []).find(y => y.id === x.dataset.iread); if (m) setRead(m.id, !m.read); });
  A.querySelectorAll("[data-ijob]").forEach(x => x.onclick = () => { const j = all.find(y => y.id === x.dataset.ijob); j ? editJob(j) : toast("Job not loaded"); });
}
// ---- Clients (clients/{id}: name, office{address,phone}, contacts[{kind,name,role,mobile,phone,email,source,default}]).
// Workers read, admins edit. Contacts come from builders' emails (see data/clients_contacts.json).
let CLI = null, CLI_ERR = "";
async function loadClients(force) {
  if (!CLI || force) { try { CLI = (await getDocs(collection(db, "clients"))).docs.map(d => ({ id: d.id, ...d.data() })); CLI_ERR = ""; } catch (e) { CLI = []; CLI_ERR = e.code || e.message; } }
  return CLI;
}
const normCo = s => String(s || "").toLowerCase().replace(/\(.*?\)|pty|ltd|homes?|built|[^a-z]/g, "");
const clientOf = name => (CLI || []).find(c => normCo(c.name) && normCo(c.name) === normCo(name)) || null;
const telHref = m => "tel:" + String(m || "").replace(/[^\d+]/g, "");
// Job supervisor: job fields / meta (admins) first, then the client's contact list (adds the mobile); a client with
// one supervisor (or one marked default) is used when nothing else matches.
async function jobSupervisor(j) {
  await loadClients();
  const s = await supervisorFor(j).catch(() => null), c = clientOf(j.client), sups = (c?.contacts || []).filter(x => x.kind === "supervisor");
  const hit = s && sups.find(x => (s.email && x.email && x.email.toLowerCase() === s.email.toLowerCase()) || (s.name && x.name.toLowerCase().startsWith(s.name.toLowerCase())));
  if (s) return { ...s, ...(hit || {}), email: s.email || hit?.email, name: hit?.name || s.name };
  const base = String(j.po || "").split("/")[0].replace(/\D/g, ""), byPo = base && sups.find(x => (x.pos || []).includes(base));
  if (byPo) return byPo;
  if (sups.length === 1) return sups[0];
  return sups.find(x => x.default) || null;
}
async function fillSupCard(j) {
  const box = document.querySelector(`.supcard[data-sup="${CSS.escape(j.id)}"]`); if (!box) return;
  const s = await jobSupervisor(j).catch(() => null);
  box.innerHTML = s ? `<div class="sup"><div class="sup-who"><span class="mlbl">Supervisor</span><b>${esc(s.name || s.email)}</b>${s.mobile ? `<span class="sub">${esc(s.mobile)}</span>` : ""}</div>
    <span class="sup-btns">${s.mobile ? `<a class="sm-btn primary" href="${telHref(s.mobile)}">📞 Call</a>` : ""}${s.email ? `<a class="sm-btn" href="mailto:${esc(s.email)}?subject=${encodeURIComponent((j.address || "") + (j.po ? " PO " + j.po : ""))}">✉ Email</a>` : ""}</span></div>`
    : `<div class="sup none"><span class="mlbl">Supervisor</span> <span class="sub muted">Not known for this job${isAdm() ? " - add one in Clients" : ""}</span></div>`;
}
const KIND = { supervisor: "Supervisors", accounts: "Accounts", admin: "Admin / ordering" };
function contactRow(c, x, i) {
  return `<div class="ct"><div class="ct-who"><b>${esc(x.name)}</b> <span class="sub">${esc(x.role || "")}</span>
    <div class="sub">${[x.mobile, x.phone, x.email].filter(Boolean).map(esc).join(" · ")}</div>${x.source ? `<div class="sub muted ct-src">${esc(x.source)}</div>` : ""}</div>
    <span class="ct-btns">${x.mobile || x.phone ? `<a class="sm-btn primary" href="${telHref(x.mobile || x.phone)}" title="Call">📞</a>` : ""}${x.email ? `<a class="sm-btn" href="mailto:${esc(x.email)}" title="Email">✉</a>` : ""}${isAdm() ? `<button class="sm-btn" data-ced="${esc(c.id)}:${i}" title="Edit">✎</button>` : ""}</span></div>`;
}
function clientsView() {
  if (!CLI) { loadClients().then(() => ui.view === "clients" && renderAdmin()); return `<div class="sm-head"><h1>Clients</h1></div><p class="pad muted">Loading…</p>`; }
  const q = (ui.cq2 || "").toLowerCase();
  const list = CLI.filter(c => !q || JSON.stringify(c).toLowerCase().includes(q)).sort((a, b) => (b.contacts || []).length - (a.contacts || []).length || a.name.localeCompare(b.name));
  return `<div class="sm-head"><h1>Clients</h1>${isAdm() ? `<span class="headbtns"><button class="sm-btn primary" data-cnew>＋ Add client</button></span>` : ""}</div>
    ${CLI_ERR ? `<p class="err pad">Clients not available: ${esc(CLI_ERR)}</p>` : ""}
    <div class="sbar"><span class="sbar-ic">🔍</span><input id="cq2" type="search" placeholder="Search client, name, phone…" value="${esc(ui.cq2 || "")}"></div>
    <div class="clgrid">${list.map(c => `<div class="clcard"><div class="cl-h"><h3>${esc(c.name)}</h3>${isAdm() ? `<button class="sm-btn" data-ced="${esc(c.id)}:new">＋ Contact</button>` : ""}</div>
      ${c.office?.phone || c.office?.address ? `<div class="sub cl-off">${c.office.phone ? `<a href="${telHref(c.office.phone)}">☎ ${esc(c.office.phone)}</a> · ` : ""}${esc(c.office.address || "")}</div>` : ""}
      ${Object.entries(KIND).map(([k, t]) => { const xs = (c.contacts || []).map((x, i) => [x, i]).filter(([x]) => (x.kind || "admin") === k);
        return xs.length ? `<div class="cl-k">${t}</div>` + xs.map(([x, i]) => contactRow(c, x, i)).join("") : ""; }).join("") || `<p class="sub muted">No contacts yet</p>`}</div>`).join("") || `<p class="pad muted">No clients yet</p>`}</div>`;
}
function bindClients(A) {
  const qi = A.querySelector("#cq2"); if (qi) qi.oninput = () => { ui.cq2 = qi.value; const p = qi.selectionStart; renderAdmin(); const n = $("#cq2"); n.focus(); n.setSelectionRange(p, p); };
  A.querySelectorAll("[data-ced]").forEach(b => b.onclick = () => { const [id, i] = b.dataset.ced.split(":"); editContact(CLI.find(c => c.id === id), i === "new" ? -1 : +i); });
  const nb = A.querySelector("[data-cnew]"); if (nb) nb.onclick = async () => {
    const name = (prompt("Client (company) name:") || "").trim(); if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "client";
    try { await setDoc(doc(db, "clients", id), { name, office: {}, contacts: [], updatedAt: serverTimestamp() }, { merge: true }); await loadClients(true); renderAdmin(); } catch (e) { toast("Not saved: " + (e.code || e.message)); }
  };
}
function editContact(c, i) {
  const x = i >= 0 ? c.contacts[i] : { kind: "supervisor" }, d = $("#dlg"); d.className = ""; d.onclose = null;
  d.innerHTML = `<form method="dialog" id="cf" class="jf"><h2>${i >= 0 ? "Edit" : "Add"} contact · ${esc(c.name)}</h2>
    <label>Type<select name="kind">${Object.entries(KIND).map(([k, t]) => `<option value="${k}" ${x.kind === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    <label>Name<input name="name" value="${esc(x.name)}" required></label><label>Role<input name="role" value="${esc(x.role)}"></label>
    <label>Mobile<input name="mobile" type="tel" value="${esc(x.mobile)}"></label><label>Email<input name="email" type="email" value="${esc(x.email)}"></label>
    <label>Source / note<input name="source" value="${esc(x.source)}"></label>
    <div class="btns">${i >= 0 ? `<button value="del" formnovalidate class="ghost big" id="cdel">Remove</button>` : ""}<button value="cancel" formnovalidate class="ghost big">Cancel</button><button value="ok" class="primary big">Save</button></div></form>`;
  d.showModal();
  $("#cf").onsubmit = async ev => {
    const v = ev.submitter?.value; if (v === "cancel") return; ev.preventDefault();
    if (v === "del" && !confirm(`Remove ${x.name}?`)) return;
    const f = ev.target, cs = [...(c.contacts || [])];
    const nx = { ...x, kind: f.kind.value, name: f.name.value.trim(), role: f.role.value.trim(), mobile: f.mobile.value.trim(), email: f.email.value.trim(), source: f.source.value.trim() };
    if (v === "del") cs.splice(i, 1); else if (i >= 0) cs[i] = nx; else cs.push(nx);
    try { await updateDoc(doc(db, "clients", c.id), { contacts: cs, updatedAt: serverTimestamp(), updatedBy: me.uid }); d.close(); await loadClients(true); renderAdmin(); toast("Saved"); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); }
  };
}
async function emailSupervisor(j, amt) {
  let s = await supervisorFor(j);
  if (!s) {
    const e = (prompt(`Supervisor email for ${j.client || "this client"} (remembered for next time):`, "") || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return toast(e ? "That doesn't look like an email address" : "No email entered");
    s = { email: e, name: "" };
    const k = (j.client || "unknown").replace(/[.\/]/g, "_");
    setDoc(doc(db, "meta", "supervisors"), { remembered: { [k]: s } }, { merge: true }).then(() => { (SUPS ||= {}).remembered = { ...(SUPS.remembered || {}), [k]: s }; })
      .catch(e2 => toast("Email not remembered: " + (e2.code || e2.message)));
    updateDoc(doc(db, "jobs", j.id), { supervisorEmail: e, updatedAt: serverTimestamp(), updatedBy: me.uid }).catch(() => {});
  }
  const a = amt ?? j.invoiceAmount, po = j.po || "(no PO)", task = (j.invoiceDescription || j.description || TYPES[j.type] || "").split("\n")[0];
  const first = (s.name || "").split(" ")[0];
  const body = `Hi ${first || "there"},

The requested task for the job below has come in over the PO value.

Job / address: ${j.address || ""}${j.sm8JobNo ? " (our job #" + j.sm8JobNo + ")" : ""}
Task: ${task}
PO: ${po}
PO value (ex GST): ${j.poAmount != null ? $$(j.poAmount) : "unknown"}
Amount charged (ex GST): ${a != null && a !== "" ? $$(a) : ""}
Difference (ex GST): ${$$(overBy(j, a))}
Reason: 

Could you please raise a variation or send an amended PO to cover the difference?

Thanks,
Alex Daly
${orgSettings().signoff}
0499 802 812

${POWERED_BY}`;
  const url = "https://mail.google.com/mail/?authuser=" + encodeURIComponent("alex@heartwoodew.com") + "&view=cm&fs=1&to=" + encodeURIComponent(s.email)
    + "&su=" + encodeURIComponent(`PO exceeded - ${j.address || ""} - PO ${po}`) + "&body=" + encodeURIComponent(body);
  window.HW_LAST_MAILTO = url;      // Gmail compose in a new tab; nothing is sent from here
  const a2 = document.createElement("a"); a2.href = url; a2.target = "_blank"; a2.rel = "noopener"; document.body.appendChild(a2); a2.click(); a2.remove();
}
const xd = s => { const [y, m, d] = s.split("-"); return `${+d}/${m}/${y}`; };     // d/mm/yyyy like hwdata.d_fmt
const csvCell = v => { v = String(v ?? ""); return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
// ---- Send to Xero (admin only). The app can't hold Xero keys, so it QUEUES a request in xeroQueue; the box worker
// (tools/xero_queue.py + the Xero connector) creates a DRAFT invoice (never approved or emailed): contact = builder,
// reference = PO, line = invoice description, amount ex GST, account 200, tax OUTPUT (GST on Income), as on invoices 5442/5445.
// The worker then writes xeroInvoiceId / xeroStatus back to the job and marks it invoiced.
function xeroPill(j) { const s = j.xeroStatus; if (!s || !canXero()) return "";
  return `<div class="sub"><span class="qpill ${s === "draft" ? "q-comp" : s === "error" ? "q-alert" : "q-wo"}" title="${esc(j.xeroError || "")}">${s === "draft" ? "Draft in Xero" + (j.xeroInvoiceNo ? " #" + esc(j.xeroInvoiceNo) : "") : s === "error" ? "Xero error" : "Queued for Xero"}</span></div>`; }
async function sendToXero(list, opts = {}) {
  if (!canXero()) return;
  const bad = list.filter(j => !j.invoiceNo || !(+j.invoiceAmount > 0)), ok = list.filter(j => !bad.includes(j) && !["queued", "draft"].includes(j.xeroStatus));
  if (!ok.length) { toast(bad.length ? "Those jobs need an invoice number and a price first." : "Already sent to Xero."); return; }
  if (!opts.skipConfirm && !confirm(`Create ${ok.length} DRAFT invoice${ok.length === 1 ? "" : "s"} in Xero?\n\nThey are not approved or emailed. Check and approve them in Xero.`)) return;
  for (const j of ok) {
    const req = { jobId: j.id, invoiceNo: String(j.invoiceNo), contact: invContact(j), reference: isRealPo(j.po) ? j.po : "", description: j.invoiceDescription || invDescDefault(j),
      amountEx: +j.invoiceAmount, date: j.invoiceDate || j.date || todayStr(), accountCode: "200", taxType: "OUTPUT", status: "queued", by: auth.currentUser.uid, at: serverTimestamp() };
    try { await addDoc(collection(db, "xeroQueue"), req); await updateDoc(doc(db, "jobs", j.id), { xeroStatus: "queued", xeroQueuedAt: serverTimestamp() }); }
    catch (e) { if (e && e.code === "permission-denied") { alert("Send to Xero isn't switched on yet: the Firestore rules for Xero haven't been updated. Nothing was sent. Use Download Xero CSV for now."); return; }
      toast("Couldn't queue #" + j.invoiceNo + ": " + (e.code || e.message)); return; }
  }
  toast(`Queued ${ok.length} for Xero as draft${bad.length ? `; ${bad.length} skipped (no number or price)` : ""}.`); renderAdmin();
}
function xeroCsv(list) {
  const rows = list.map(j => { const d = j.invoiceDate || j.date;
    return [invContact(j), "", "", j.invoiceNo, isRealPo(j.po) ? j.po : "", xd(d), xd(addDays(d, 7)), "",
      j.invoiceDescription || invDescDefault(j), "1", Number(j.invoiceAmount).toFixed(2), "", "200", "GST on Income", "AUD"]; });
  return [XERO_COLS, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
function downloadCsv(list) {
  const ns = list.map(j => +j.invoiceNo).filter(Boolean).sort((a, b) => a - b);
  const name = `${canXero() ? "xero" : "invoice"} import ${ns.length > 1 ? ns[0] + "-" + ns[ns.length - 1] : ns[0]}.csv`;
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([xeroCsv(list)], { type: "text/csv" })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); window.HW_LAST_CSV = { name, text: xeroCsv(list) };
  toast("Downloaded " + name);
}
ui.inv = "ready"; ui.invSel = new Set();
function invoicesView() {
  if (!me || me.role !== "admin") { ui.view = "home"; return `<p class="pad muted">Invoices are admin only.</p>`; }
  const done = (ui.done || []).filter(j => j.status === "Done" && matchQ(j));
  const excl = j => j.invoiceExcluded === true;          // "Remove" on the Invoices screen (job kept, never invoiced)
  const removed = done.filter(j => excl(j) && !j.invoiceNo).sort((a, b) => (b.invoiceExcludedAt || "").localeCompare(a.invoiceExcludedAt || ""));
  const ready = done.filter(j => !j.invoiceNo && !excl(j) && !j.doNotInvoice).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const numbered = done.filter(j => j.invoiceNo && !j.invoiced).sort((a, b) => +a.invoiceNo - +b.invoiceNo);
  const since = addDays(todayStr(), -30);
  const recent = done.filter(j => j.invoiceNo && j.invoiced && (j.invoiceDate || j.date || "") >= since).sort((a, b) => +b.invoiceNo - +a.invoiceNo);
  const list = { ready, numbered, recent, removed }[ui.inv];
  const sel = list.filter(j => ui.invSel.has(j.id));
  const tot = a => a.reduce((t, j) => t + (+j.invoiceAmount || 0), 0);
  const money = v => (!canSeeMoney() || v == null || v === "") ? "" : "$" + Number(v).toLocaleString("en-AU", { minimumFractionDigits: 2 });
  // Monthly totals: all invoiced (numbered) jobs, by invoice month (fallback: job/completed date). Removed / do-not-invoice excluded.
  const monthOf = j => String(j.invoiceDate || j.date || "").slice(0, 7);
  const allInv = done.filter(j => j.invoiceNo && !excl(j) && !j.doNotInvoice);
  const months = {}, seenNo = {};
  for (const j of allInv) { const m = monthOf(j) || "?"; (months[m] ||= { n: 0, ex: 0 }); (seenNo[m] ||= new Set()).add(String(j.invoiceNo)); months[m].ex += +j.invoiceAmount || 0; }
  // read-only box history (meta/invHist_*), already deduped against app invoice numbers when loaded
  if (!ui.invHist) loadInvHist();
  const qw = qWords();
  for (const r of ui.invHist || []) { const [no, d, addr, cl, amt, po, task] = r;
    if (qw.length && !qw.every(w => `${no} ${addr} ${cl} ${po} ${task}`.toLowerCase().includes(w))) continue;
    if (allInv.some(j => String(j.invoiceNo) === no)) continue;
    const m = String(d).slice(0, 7) || "?"; (months[m] ||= { n: 0, ex: 0 }); (seenNo[m] ||= new Set()).add(no); months[m].ex += +amt || 0; }
  for (const m in months) months[m].n = seenNo[m].size;
  const mName = m => { const [y, mo] = m.split("-"); return mo ? new Date(+y, +mo - 1, 1).toLocaleString("en-AU", { month: "short", year: "numeric" }) : "No date"; };
  const mStr = m => `${months[m]?.n || 0} invoice${months[m]?.n === 1 ? "" : "s"} · <b>${$$(months[m]?.ex || 0)}</b> ex GST · ${$$(Math.round((months[m]?.ex || 0) * 110) / 100)} inc GST`;
  const curM = todayStr().slice(0, 7);
  const stripMs = [...new Set([curM, ...Object.keys(months)])].filter(m => /^\d{4}-\d{2}$/.test(m) && m <= curM).sort().reverse().slice(0, 4);
  const strip = ui.inv === "numbered" || ui.inv === "recent" ? `<div class="minvstrip">${stripMs.map(m => `<div class="mcard${m === curM ? " cur" : ""}"><div class="mn">${esc(mName(m))}${m === curM ? " (this month)" : ""}</div><div>${mStr(m)}</div></div>`).join("")}${ui.q ? `<span class="sub">Totals for jobs matching the search</span>` : ""}
    <details class="mall"><summary>All months${ui.invHist ? "" : " (loading history…)"}</summary>${Object.keys(months).sort().reverse().map(m => `<div class="mrow"><b>${esc(mName(m))}</b> · ${mStr(m)}</div>`).join("")}<div class="sub">Includes read-only invoice history from the box records.</div></details></div>` : "";
  if (ui.inv === "numbered" || ui.inv === "recent") list.sort((a, b) => monthOf(b).localeCompare(monthOf(a)) || +b.invoiceNo - +a.invoiceNo);
  const tab = (k, n, a) => `<button data-inv="${k}" class="${ui.inv === k ? "on" : ""}">${n} <span>${a.length}</span></button>`;
  const head = ui.inv === "removed" ? `<th></th><th>Date</th><th>Client / Site</th><th>PO</th><th>Removed</th><th></th>` : ui.inv === "ready" ? `<th></th><th>Date</th><th>Client / Site</th><th>PO</th><th>Invoice description</th><th>Amount (ex GST)</th><th></th>`
    : `<th></th><th>Invoice #</th><th>Date</th><th>Contact</th><th>Reference</th><th>Description</th><th>Amount (ex GST)</th>${ui.inv === "recent" ? "<th>Marked</th>" : ""}`;
  const row = j => ui.inv === "removed"
    ? `<tr class="jr" data-id="${j.id}"><td></td><td>${esc(shortDate(j.date))}<div class="sub">#${esc(jobNo(j))}</div></td>
        <td><b>${esc(invContact(j))}</b><div class="sub">${esc(j.address || "")}</div><div class="sub">${esc(j.description || "")}</div></td>
        <td>${esc(j.po || "no PO")}</td><td class="sub">${esc(j.invoiceExcludedByName || "")} ${esc(String(j.invoiceExcludedAt || "").slice(0, 16).replace("T", " "))}</td>
        <td><button type="button" class="sm-btn irestore">↩ Restore</button></td></tr>`
    : ui.inv === "ready"
    ? `<tr class="jr" data-id="${j.id}"><td><input type="checkbox" class="isel" ${ui.invSel.has(j.id) ? "checked" : ""}></td>
        <td>${esc(shortDate(j.date))}<div class="sub">#${esc(jobNo(j))}</div></td>
        <td><b>${esc(invContact(j))}</b>${STD_CLIENTS.includes(invContact(j)) || / \(private\)$/.test(invContact(j)) ? "" : ` <span class="warnt" title="Not one of the standard ${canXero() ? "Xero " : ""}contact names">⚠</span>`}<div class="sub">${esc(j.address || "")}</div>
          <div class="sub">${esc(j.description || "")}${mixedBadge(j)}${j.loads ? ` · <b>${esc(j.loads)} loads</b>` : ""}${j.completedByName ? " · " + esc(j.completedByName) : ""}</div></td>
        <td>${isRealPo(j.po) ? esc(j.po) : `<span class="unal">${j.po ? esc(j.po) + " (not a PO)" : "no PO"}</span>`}${canSeeMoney() && j.poAmount != null ? `<div class="sub" title="${esc(j.poAmountBasis || "")}">PO value $${esc(Number(j.poAmount).toFixed(2))} ex GST</div>` : ""}</td>
        <td><input class="idesc" value="${esc(j.invoiceDescription || invDescDefault(j))}"></td>
        <td>${canSeeMoney() ? `<input class="iamt" type="number" step="0.01" min="0" placeholder="price" value="${esc(invAmountDefault(j) ?? "")}"><div class="opo">${overPoHtml(j, invAmountDefault(j))}</div>` : ""}</td>
        <td><button type="button" class="sm-btn iremove" title="Take off the to-invoice list (job is kept)">✕ Remove</button></td></tr>`
    : `<tr class="jr" data-id="${j.id}"><td>${ui.inv === "numbered" ? `<input type="checkbox" class="isel" ${ui.invSel.has(j.id) ? "checked" : ""}>` : `<input type="checkbox" class="isel" ${ui.invSel.has(j.id) ? "checked" : ""}>`}</td>
        <td class="jn">${esc(j.invoiceNo)}</td><td>${esc(xd(j.invoiceDate || j.date))}</td><td>${esc(invContact(j))}</td><td>${esc(isRealPo(j.po) ? j.po : "")}</td>
        <td>${esc(j.invoiceDescription || invDescDefault(j))}</td><td>${money(j.invoiceAmount)}<div class="opo">${overPoHtml(j)}</div>${xeroPill(j)}</td>${ui.inv === "recent" ? `<td><span class="qpill q-comp">Invoiced</span></td>` : ""}</tr>`;
  const acts = ui.inv === "removed" ? `<span class="sub">Removed jobs are kept but never invoiced or exported. Restore puts a job back on Ready to invoice.</span>` : ui.inv === "ready"
    ? `<button id="inum" class="sm-btn primary${canXero() ? " xero" : ""}" ${sel.length ? "" : "disabled"}">${canXero() ? `Send to Xero (${sel.length})` : `Assign invoice numbers &amp; download invoice CSV (${sel.length})`}</button>`
    : `<button id="icsv" class="sm-btn" ${sel.length ? "" : "disabled"}>Download ${canXero() ? "Xero" : "invoice"} CSV (${sel.length})</button>
       ${ui.inv === "numbered" ? `<button id="imark" class="sm-btn primary" ${sel.length ? "" : "disabled"}>Mark invoiced (${sel.length})</button>${canXero() ? ` <button id="ixero" class="sm-btn xero" title="Creates DRAFT invoices in Xero (not approved, not emailed). The box sends them within a few minutes." ${sel.length ? "" : "disabled"}>Send to Xero as draft (${sel.length})</button>` : ""}` : ""}`;
  return `<div class="sm-head"><h1>Invoices</h1><button id="findall" class="sm-btn" title="Run Find PO on every open and not-yet-invoiced job">🔎 Find all POs</button><span class="sub">Next invoice number: <b id="inext">${nextInvoiceGuess()}</b></span></div>
    ${searchBar()}${strip}
    <div class="qtabs">${tab("ready", "Ready to invoice", ready)}${tab("numbered", canXero() ? "Invoiced (numbered, import into Xero)" : "Invoiced (numbered)", numbered)}${tab("recent", "Recent (last 30 days)", recent)}${tab("removed", "Removed", removed)}</div>
    <div class="filters">${acts}<label class="ck sub"><input type="checkbox" id="iall"> select all</label>
      <span class="sub">${canSeeMoney() ? `Selected total ${money(tot(sel)) || "$0.00"} ex GST` : ""}</span>
      <span class="sub muted" style="margin-left:auto">${ui.inv === "ready" ? (canXero() ? "Completed jobs with no invoice number. Price and description save as you type. Send to Xero assigns numbers and queues DRAFT invoices (not approved or emailed). Invoice date = job date, due +7 days." : "Completed jobs with no invoice number. Price and description save as you type. Invoice date = job date, due +7 days.") : ui.inv === "numbered" ? (canXero() ? "Import the CSV into Xero, then Mark invoiced." : "Import the CSV, then Mark invoiced.") : ""}</span></div>
    <table class="jt inv"><thead><tr>${head}</tr></thead><tbody>${(ui.inv === "numbered" || ui.inv === "recent" ? list.map((j, i) => (i === 0 || monthOf(list[i - 1]) !== monthOf(j) ? `<tr class="mhead"><td colspan="8"><b>${esc(mName(monthOf(j) || "?"))}</b> · ${mStr(monthOf(j) || "?")}${ui.inv === "recent" ? " (whole month)" : ""}</td></tr>` : "") + row(j)) : list.map(row)).join("") || `<tr><td colspan="8" class="muted pad">Nothing here.</td></tr>`}</tbody></table>`;
}
function nextInvoiceGuess() {
  const m = Math.max(INV_FLOOR, ui.invMeta?.lastNo || 0, ui.invMeta?.boxMax || 0, ...(ui.done || []).map(j => parseInt(j.invoiceNo) || 0));
  return m + 1;
}
async function loadInvHist() {
  if (loadInvHist.busy) return; loadInvHist.busy = true;
  try { const ix = (await getDoc(doc(db, "meta", "invHistIndex"))).data();
    const parts = await Promise.all((ix?.years || []).map(y => getDoc(doc(db, "meta", "invHist_" + y))));
    ui.invHist = parts.flatMap(p => { try { return JSON.parse(p.data()?.rows || "[]"); } catch { return []; } });
  } catch (e) { ui.invHist = []; toast("Invoice history not loaded: " + (e.code || e.message)); }
  if (ui.view === "invoices") renderAdmin();
}
async function loadInvMeta() {
  const [a, b] = await Promise.all([getDoc(doc(db, "meta", "invoicing")), getDoc(doc(db, "meta", "boxInvoiceMax"))]).catch(e => { toast("Invoicing rules not live: " + (e.code || e.message)); return []; });
  ui.invMeta = { lastNo: a?.data()?.lastNo || 0, boxMax: b?.data()?.max || 0 };
  const el = $("#inext"); if (el) el.textContent = nextInvoiceGuess();
}
function bindInvoices(A) {
  supervisors();
  if (!ui.invMeta) loadInvMeta();
  const all = ui.done || [], byId = id => all.find(j => j.id === id);
  A.querySelectorAll("[data-inv]").forEach(b => b.onclick = () => { ui.inv = b.dataset.inv; ui.invSel.clear(); renderAdmin(); });
  A.querySelectorAll(".isel").forEach(c => c.onchange = () => { const id = c.closest("[data-id]").dataset.id; c.checked ? ui.invSel.add(id) : ui.invSel.delete(id); renderAdmin(); });
  const ia = $("#iall"); if (ia) ia.onchange = () => { A.querySelectorAll(".isel").forEach(c => { const id = c.closest("[data-id]").dataset.id; ia.checked ? ui.invSel.add(id) : ui.invSel.delete(id); }); renderAdmin(); };
  const save = (el, field, conv) => el.onchange = async () => { const id = el.closest("[data-id]").dataset.id;
    try { await updateDoc(doc(db, "jobs", id), { [field]: conv(el.value), updatedAt: serverTimestamp(), updatedBy: me.uid }); toast("Saved"); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); } };
  A.querySelectorAll(".iamt").forEach(el => save(el, "invoiceAmount", v => v === "" ? null : Math.round(+v * 100) / 100));
  A.querySelectorAll(".iamt").forEach(el => el.oninput = () => { const j = byId(el.closest("[data-id]").dataset.id); const o = el.parentNode.querySelector(".opo");
    if (j && o) { o.innerHTML = overPoHtml(j, el.value); bindSup(o); } });
  const bindSup = root => root.querySelectorAll(".emailsup").forEach(b => b.onclick = ev => { ev.stopPropagation();
    const tr = b.closest("[data-id]"), j = byId(tr.dataset.id), inp = tr.querySelector(".iamt");
    if (j) emailSupervisor(j, inp ? (inp.value === "" ? null : +inp.value) : j.invoiceAmount).catch(e => toast(e.message)); });
  bindSup(A);
  A.querySelectorAll(".idesc").forEach(el => save(el, "invoiceDescription", v => v.trim() || null));
  const setExcl = async (j, on) => {
    const u = on ? { invoiceExcluded: true, invoiceExcludedAt: new Date().toISOString(), invoiceExcludedBy: me.uid, invoiceExcludedByName: me.name }
                 : { invoiceExcluded: false, invoiceRestoredAt: new Date().toISOString(), invoiceRestoredByName: me.name };
    const w = updateDoc(doc(db, "jobs", j.id), { ...u, updatedAt: serverTimestamp(), updatedBy: me.uid });   // Firestore only; nothing goes to ServiceM8
    w.catch(e => toast("Not saved: " + (e.code || e.message)));
    Object.assign(j, u); ui.invSel.delete(j.id); renderAdmin();
  };
  A.querySelectorAll(".iremove").forEach(b => b.onclick = async ev => { ev.stopPropagation();
    const j = byId(b.closest("[data-id]").dataset.id); if (!j) return;
    if (!b.classList.contains("arm")) {          // quick confirmation: second tap within 4 s
      b.classList.add("arm"); b.textContent = "Tap again to remove"; clearTimeout(b._t);
      b._t = setTimeout(() => { b.classList.remove("arm"); b.textContent = "✕ Remove"; }, 4000); return; }
    try { await setExcl(j, true); undoToast(`Removed #${jobNo(j)} from invoicing`, () => setExcl(j, false).then(() => toast("Restored"))); }
    catch (e) { toast("Not removed: " + (e.code || e.message)); } });
  A.querySelectorAll(".irestore").forEach(b => b.onclick = async ev => { ev.stopPropagation();
    const j = byId(b.closest("[data-id]").dataset.id); if (!j) return;
    try { await setExcl(j, false); undoToast(`Restored #${jobNo(j)} to Ready to invoice`, () => setExcl(j, true)); }
    catch (e) { toast("Not restored: " + (e.code || e.message)); } });
  if ($("#inum")) $("#inum").onclick = () => assignNumbers([...ui.invSel].map(byId).filter(Boolean));
  if ($("#icsv")) $("#icsv").onclick = () => downloadCsv([...ui.invSel].map(byId).filter(Boolean));
  if ($("#imark")) $("#imark").onclick = () => markInvoiced([...ui.invSel].map(byId).filter(Boolean));
  if (canXero() && $("#ixero")) $("#ixero").onclick = () => sendToXero([...ui.invSel].map(byId).filter(Boolean));
}
async function assignNumbers(list) {
  // read the current inputs (in case onchange hasn't fired yet)
  for (const j of list) { const tr = document.querySelector(`tr[data-id="${j.id}"]`); if (!tr) continue;
    const v = tr.querySelector(".iamt").value; j.invoiceAmount = v === "" ? null : Math.round(+v * 100) / 100;
    j.invoiceDescription = tr.querySelector(".idesc").value.trim() || invDescDefault(j); }
  const bad = list.filter(j => j.invoiceAmount == null || !(j.invoiceAmount >= 0) || !j.date || !invContact(j));
  if (bad.length) return alert("Set a price first for:\n" + bad.map(j => `• ${shortDate(j.date)} ${j.address}`).join("\n"));
  const nopo = list.filter(j => STD_CLIENTS.includes(invContact(j)) && !isRealPo(j.po));
  if (nopo.length && !confirm(`${nopo.length} job(s) have no PO (Reference will be blank):\n` + nopo.map(j => "• " + j.address).join("\n") + "\n\nContinue?")) return;
  const over = list.filter(j => overBy(j));      // review note only; the price is used exactly as typed
  if (over.length && !confirm(`Over PO (note only, prices are kept as entered):\n` + over.map(j => `• ${j.address} PO ${j.po}: ${$$(j.invoiceAmount)} vs PO ${$$(j.poAmount)} - Over PO by ${$$(overBy(j))}`).join("\n") + "\n\nContinue?")) return;
  // Xero users: one click assigns numbers then queues drafts (no CSV). Same confirm wording as #ixero, plus assign.
  if (canXero() && !confirm(`Assign invoice numbers and create ${list.length} DRAFT invoice${list.length === 1 ? "" : "s"} in Xero?\n\nThey are not approved or emailed. Check and approve them in Xero.`)) return;
  list.sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id.localeCompare(b.id));   // date order, like hwdata
  let out;
  try {
    out = await runTransaction(db, async tx => {
      const mRef = doc(db, "meta", "invoicing"), bRef = doc(db, "meta", "boxInvoiceMax");
      const [m, b] = [await tx.get(mRef), await tx.get(bRef)];
      const snaps = []; for (const j of list) snaps.push(await tx.get(doc(db, "jobs", j.id)));
      const taken = snaps.filter(s => s.data()?.invoiceNo); if (taken.length) throw new Error(`already numbered: ${taken.map(s => s.data().invoiceNo).join(", ")}`);
      let n = Math.max(INV_FLOOR, m.data()?.lastNo || 0, b.data()?.max || 0, ...(ui.done || []).map(j => parseInt(j.invoiceNo) || 0));
      const res = [];
      for (const j of list) { n++;
        const f = { invoiceNo: String(n), invoiceAmount: j.invoiceAmount, invoiceDescription: j.invoiceDescription, invoiceContact: invContact(j),
          invoiceDate: j.date, invoiced: false, numberedAt: serverTimestamp(), numberedBy: me.uid, updatedAt: serverTimestamp(), updatedBy: me.uid };
        tx.update(doc(db, "jobs", j.id), f); res.push({ ...j, ...f }); }
      tx.set(mRef, { lastNo: n, updatedAt: serverTimestamp(), updatedBy: me.uid }, { merge: true });
      return res;
    });
  } catch (e) { return alert("Numbers NOT assigned: " + (e.code || e.message)); }
  ui.invMeta = null; ui.invSel.clear();
  if (canXero()) { ui.inv = "numbered"; await sendToXero(out, { skipConfirm: true }); }  // queues xeroQueue + xeroStatus queued; no CSV
  else { downloadCsv(out); ui.inv = "numbered"; renderAdmin(); }
}
async function markInvoiced(list) {
  if (!confirm(`Mark ${list.length} invoice(s) as invoiced${canXero() ? " (imported into Xero)" : ""}?`)) return;
  try { await Promise.all(list.map(j => updateDoc(doc(db, "jobs", j.id), { invoiced: true, invoicedAt: serverTimestamp(), invoicedBy: me.uid, updatedAt: serverTimestamp(), updatedBy: me.uid }))); }
  catch (e) { return toast("Not saved: " + (e.code || e.message)); }
  ui.invSel.clear(); toast(`Marked ${list.length} invoiced`); ui.inv = "recent"; renderAdmin();
}

// ------------------------------------------------------------------ operator
// Phone shell: cream page, coffee header, bottom tabs. Ids and data-act values stay wired to the same handlers.
const ICO = {
  today: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  jobs: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="3.5" width="15" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 8h8M8 12h8M8 16h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  photos: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3.2l1.4-2h6.8l1.4 2H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`,
  more: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5h14a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H9l-3.5 3v-3H5a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="10" r="2.1" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`
};
const phoneTime = t => {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(String(t || "").trim());
  if (!m) return t || "—";
  if (m[3]) return `${+m[1]}:${m[2]} ${m[3].toUpperCase()}`;
  let h = +m[1]; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
};
const phonePlace = addr => {
  const raw = String(addr || "").trim();
  if (!raw) return { head: "Job", street: "", line: "", place: "", locality: "", full: "" };
  const bits = raw.split(",").map(s => s.trim()).filter(Boolean);
  const first = bits[0] || raw;
  const dot = first.split("·").map(s => s.trim()).filter(Boolean);
  const place = bits.slice(1).join(", ");
  const locality = place.replace(/\b(QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\b.*$/i, "").replace(/[,\s]+$/, "").trim();
  return { head: dot[0] || first, street: dot.slice(1).join(" · "), line: first, place, locality: locality || place, full: raw };
};
const longDate = s => {
  if (!s) return "";
  const d = new Date(s + "T00:00:00Z");
  const w = d.toLocaleDateString("en-AU", { weekday: "long", timeZone: "UTC" });
  const day = d.toLocaleDateString("en-AU", { day: "numeric", timeZone: "UTC" });
  const month = d.toLocaleDateString("en-AU", { month: "long", timeZone: "UTC" });
  return `${w}, ${day} ${month}`;
};
const opTabKey = t => t === "week" ? "week" : t === "photos" ? "photos" : t === "chat" ? "chat" : t === "today" ? "today" : "more";
const opTabs = on => {
  const key = opTabKey(on);
  const tabs = [["today", "Today", ICO.today], ["week", "Jobs", ICO.jobs], ["chat", "Chat", ICO.chat], ["photos", "Photos", ICO.photos], ["more", "More", ICO.more]];
  return `<nav class="mob-tabs" aria-label="Sections">${tabs.map(([k, n, ic]) => `<button type="button" data-tab="${k}" class="${key === k ? "on" : ""}"${key === k ? ` aria-current="page"` : ""}><span class="mic">${ic}</span><span>${n}</span>${k === "chat" ? CHAT.badge("staff") : ""}</button>`).join("")}</nav>`;
};
const adminBack = () => me.role === "admin" ? `<button class="mback adminback" id="toadmin" type="button">Admin view</button>` : "";
const opSeg = on => `<div class="seg mob-seg" role="group" aria-label="When">${[["today", "Today"], ["week", "Upcoming"]].map(([k, n]) => `<button type="button" data-tab="${k}" class="${on === k ? "on" : ""}">${n}</button>`).join("")}</div>`;
function opCard(j) {
  const p = phonePlace(j.address);
  const crew = namesOf(j);
  const type = TYPES[j.type] || j.client || "Job";
  const st = j.status === "In progress" ? "inprog" : j.status === "Done" ? "done" : "";
  const stop = ui.runStops && ui.runStops[j.id];
  return `<div class="mrow opj t-${esc(j.type || "other")}" data-id="${esc(j.id)}" role="button" tabindex="0" aria-label="${esc(type + " " + (p.line || p.full) + " " + phoneTime(j.time))}">
    ${stop ? `<div class="run-stop">Stop ${stop}</div>` : ""}
    <div class="mtime"><b>${esc(phoneTime(j.time))}</b>${j.durationHrs ? `<small>${esc(j.durationHrs)}h</small>` : ""}</div>
    <div class="mbody">${ipTop(j, "sm")}<div class="mcl"><span class="qdot ${QCLS[queueOf(j)]}"></span>${esc(type)}${jobPhotosIcon(j)}</div>
      <div class="maddr">${esc(p.line || p.full || "-")}</div>
      <div class="mdesc">${esc(p.locality || j.client || "")}</div>
      <div class="mst ${st}">${esc(crew.length ? crew.join(", ") : "Unallocated")}<span class="sub"> · #${esc(jobNo(j))}</span></div></div>
    <div class="chev" aria-hidden="true"></div></div>`;
}
function bindOp(mine) {
  if ($("#toadmin")) $("#toadmin").onclick = () => { ui.myJobs = false; ui.opSel = null; renderAdmin(); };
  $("#app").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { ui.opTab = b.dataset.tab; renderOperator(); window.scrollTo(0, 0); });
  $("#app").querySelectorAll("[data-go]").forEach(b => b.onclick = () => { if (b.dataset.go === "swms") return swmsOverlay(); ui.opTab = b.dataset.go; renderOperator(); window.scrollTo(0, 0); });
  const openJob = id => { if (ui.opSel !== id) ui.jobPane = "job"; ui.opSel = id; renderOperator(); window.scrollTo(0, 0); };
  $("#app").querySelectorAll(".mrow").forEach(r => {
    r.onclick = e => { if (e.target.closest("a, button")) return; openJob(r.dataset.id); };
    r.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openJob(r.dataset.id); } };
  });
  $("#app").querySelectorAll(".hrow[data-id]").forEach(r => r.onclick = () => openJob(r.dataset.id));
  $("#app").querySelectorAll("[data-photo]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    const j = (mine || []).find(x => x.id === b.dataset.photo);
    if (j) emailPhotos(j);
  });
}
function snapExists(snap) {
  if (!snap) return false;
  return typeof snap.exists === "function" ? !!snap.exists() : !!snap.exists;
}
function readRunSheet(uid, date) {
  const id = runSheetId(uid, date);
  if (!id) return null;
  ui.runSheets = ui.runSheets || {};
  if (ui.runSheets[id] === undefined) {
    ui.runSheets[id] = null;
    getDoc(doc(db, "runSheets", id)).then(snap => {
      ui.runSheets[id] = snapExists(snap) ? { id, ...snap.data() } : false;
      const sheet = ui.runSheets[id];
      if (sheet && sheet.status === "approved" && !ui.opSel && me && (me.role !== "admin" || ui.myJobs)) renderOperator();
    }).catch(() => { ui.runSheets[id] = false; });
  }
  const sheet = ui.runSheets[id];
  return sheet && sheet.status === "approved" ? sheet : null;
}
function withRunOrder(list) {
  const dates = [...new Set(list.map(j => j.date))].sort();
  const out = [];
  for (const date of dates) {
    const sheet = readRunSheet(me.uid, date);
    const rows = orderJobsForRun(list.filter(j => j.date === date), sheet);
    rows.forEach((j, i) => {
      if (sheet && Array.isArray(sheet.jobIds) && sheet.jobIds.includes(j.id)) ui.runStops[j.id] = i + 1;
      out.push(j);
    });
  }
  return out;
}
function renderOperator() {
  paintBrand();
  if (!ui.forceRender && document.querySelector("#compform, #prestartform")) return;
  ui.forceRender = false;
  document.body.className = "operator";
  ui.runStops = {};
  CHAT.watch(jobs);
  const t0 = todayStr(), t1 = addDays(t0, 1), wkEnd = addDays(t0, 7);
  const mine = jobs.filter(j => j.status !== "Cancelled" && (me.role !== "admin" || (j.assigned || []).includes(me.uid))).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const sel = ui.opSel && mine.find(j => j.id === ui.opSel);
  if (sel) return renderOpDetail(sel);
  if (ui.opTab === "chat" && document.activeElement?.closest?.(".chat-compose")) return;
  if (!ui.opTab || ui.opTab === "home") ui.opTab = "today";
  if (ui.opTab === "quotes" && !(canQuote() && me.role !== "admin")) ui.opTab = "more";
  if (ui.opTab === "quotes") {
    const qhtml = adminViewRouter("quotes", ui, { esc, $$, staff, jobs: mine, todayStr, rerender: () => renderOperator(), canEditQuoteRates });
    $("#app").innerHTML = `<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Quotes</div><div class="mob-sub">Guided pricing · ex GST</div></div>
      <div class="pad">${qhtml || ""}</div>${opTabs("quotes")}</div>`;
    bindOp(mine);
    QG.bindAdmin({ ui: { ...ui, view: "quotes" }, A: $("#app") });
    return;
  }
  if (!ui.tsForce && ui.opTab === "hours" && (ui.tsBusy || ui.tsAsk || (ui.tsMachineShift && document.getElementById("tsmachine"))) && !ui.opSel) return;
  if (!ui.tsForce && ui.opTab === "hours" && (ui.tsDirty || ui.tsEdit) && ($("#tsman") || $("#tsf")) && !ui.opSel) return;
  if (ui.opTab === "hours" && !ui.opSel) {
    $("#app").innerHTML = `<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">My hours</div><div class="mob-sub">Clock on, or enter hours manually</div></div>
      <div class="pad">${tsEditor()}</div>${opTabs("hours")}</div>`;
    bindOp(mine); bindTs($("#app"), renderOperator); return;
  }
  if (ui.opTab === "prestart" && COMP.canPrestart()) {
    $("#app").innerHTML = `<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Prestart</div><div class="mob-sub">Any machine · before you use it</div></div>
      ${COMP.staffHtml()}${opTabs("prestart")}</div>`;
    bindOp(mine);
    COMP.bind($("#app"));
    return;
  }
  if (ui.opTab === "prestart") ui.opTab = "more";
  if (ui.opTab === "fleet" && COMP.canSee()) {
    $("#app").innerHTML = `<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Compliance</div><div class="mob-sub">${COMP.canEditService() ? "Fleet and servicing" : "Fleet and servicing · read only"}</div></div>
      ${COMP.staffHtml()}${opTabs("fleet")}</div>`;
    bindOp(mine);
    COMP.bind($("#app"));
    return;
  }
  if (ui.opTab === "fleet") ui.opTab = "more";
  if (ui.opTab === "staff" && document.activeElement?.closest?.("#invitef")) return;
  if (ui.opTab === "staff" && canInvite()) {
    $("#app").innerHTML = `<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Staff</div><div class="mob-sub">Invite operators and supervisors</div></div>
      <div class="pad">${staffViewHtml(ui.invites || [], { now: inviteDisplayNow(), error: ui.invitesErr || "" })}</div>${opTabs("more")}</div>`;
    bindOp(mine); bindStaff($("#app")); return;
  }
  if (ui.opTab === "staff") ui.opTab = "more";
  if (ui.opTab === "more") {
    const quoteBtn = canQuote() && me.role !== "admin" ? `<button type="button" class="mob-more" data-go="quotes"><b>Quotes</b><small>Guided pricing for supervisors</small></button>` : "";
    const fleetBtn = COMP.canSee() ? `<button type="button" class="mob-more" data-go="fleet"><b>Compliance</b><small>Registration and COI status</small></button>` : "";
    const staffBtn = canInvite() ? `<button type="button" class="mob-more" data-go="staff"><b>Staff</b><small>Invite operators and supervisors</small></button>` : "";
    $("#app").innerHTML = `<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">More</div><div class="mob-sub">${esc(me.name || "")} · ${esc(orgSettings().name)}</div></div>
      <div class="mob-menu">
        <button type="button" class="mob-more" data-go="hours"><b>Hours</b><small>Clock on, or add hours manually</small></button>
        <button type="button" class="mob-more" data-go="done"><b>Completed</b><small>Finished in the last 30 days</small></button>
        <div class="mob-sec">Safety</div>
        <button type="button" class="mob-more" data-go="swms"><b>SWMS</b><small>Read and sign</small></button>
        ${COMP.canPrestart() ? `<button type="button" class="mob-more" data-go="prestart"><b>Prestart</b><small>Any machine, before you use it</small></button>` : ""}
        ${fleetBtn}
        <button type="button" class="mob-more incbtn" data-inc=""><b>Report incident</b><small>Safety report</small></button>
        ${quoteBtn}
        ${staffBtn}
        <p class="powered pad">${esc(orgSettings().name)} · ${esc(POWERED_BY)}</p>
      </div>
      ${myIncidentsHtml()}
      ${opTabs("more")}</div>`;
    bindOp(mine); return;
  }
  if (ui.opTab === "chat") {
    $("#app").innerHTML = `<div class="mob">${adminBack()}
      ${CHAT.teamHtml()}
      ${opTabs("chat")}</div>`;
    bindOp(mine);
    CHAT.mount($("#app"));
    return;
  }
  if (ui.opTab === "photos") {
    const list = mine.filter(j => j.status !== "Cancelled");
    $("#app").innerHTML = `<div class="mob">${adminBack()}<div class="mob-bar"><div class="mob-title">Photos</div><div class="mob-sub">Email site photos to the office</div></div>
      <p class="muted pad">Choose a job to add photos. They are emailed to the office, and a private cloud copy is saved when storage accepts them.</p>
      <div class="mob-list">${list.map(j => `${opCard(j)}<button type="button" class="mnote op-photo" data-photo="${esc(j.id)}">${ICO.photos}<span>Add photos</span></button><div data-photoslot="${esc(j.id)}" data-photorole="cloud"></div>${emailedPhotosNote(j) ? `<div class="pad">${emailedPhotosNote(j)}</div>` : ""}`).join("") || `<p class="muted pad">No jobs to photograph.</p>`}</div>
      ${opTabs("photos")}</div>`;
    list.forEach(j => { rememberJob(j); watchJobPhotos(j); }); paintPhotoSlots(); bindOp(mine); return;
  }
  const isDone = j => queueOf(j) === "Completed" || queueOf(j) === "Unsuccessful";
  const open = mine.filter(j => !isDone(j));
  const doneL = mine.filter(j => queueOf(j) === "Completed" && j.date >= addDays(t0, -30) && j.date <= t0).reverse();
  const first = esc(String(me.name || "").split(" ")[0]);
  if (ui.opTab === "today") {
    const todayJobs = withRunOrder(open.filter(j => j.date === t0 || (j.date < t0 && j.status === "In progress")));
    const todaySheet = readRunSheet(me.uid, t0);
    const n = todayJobs.length;
    $("#app").innerHTML = `<div class="mob">${adminBack()}
      <div class="mob-intro"><div class="mob-kicker">Today · ${esc(orgSettings().name)}</div><div class="mob-date">${esc(longDate(t0))}</div>
        <h1 class="mob-hello">${esc(greet())}, ${first}</h1><p class="mob-count">${n} job${n === 1 ? "" : "s"} today</p>${todaySheet ? `<p class="run-note">Approved driving order${todaySheet.returnToDepot ? " · back to the depot" : ""}</p>` : ""}${opSeg("today")}</div>
      ${COMP.staffBannerHtml()}
      ${swmsReminderHtml()}
      <div class="mob-list">${todayJobs.map(opCard).join("") || `<p class="muted pad">Nothing booked for ${esc(orgSettings().name)}.</p>`}</div>
      ${opTabs("today")}</div>`;
    bindOp(mine); return;
  }
  const groups = ui.opTab === "done" ? groupByDate(doneL).map(([d, js]) => [d === t0 ? "Today · " + dayLabel(d) : dayLabel(d), js])
    : groupByDate(withRunOrder(open.filter(j => j.date >= t1 && j.date <= wkEnd))).map(([d, js]) => [(d === t1 ? "Tomorrow · " : "") + dayLabel(d), js]);
  const upcomingN = groups.reduce((n, [, js]) => n + js.length, 0);
  const head = ui.opTab === "done"
    ? `<div class="mob-bar"><div class="mob-title">Completed</div><div class="mob-sub">Last 30 days</div></div>`
    : `<div class="mob-intro"><div class="mob-kicker">Jobs</div><div class="mob-date">Upcoming</div>
        <h1 class="mob-hello">This week</h1><p class="mob-count">${upcomingN} job${upcomingN === 1 ? "" : "s"}</p>${opSeg("week")}</div>`;
  $("#app").innerHTML = `<div class="mob">${adminBack()}${head}
    ${groups.map(([g, js]) => `<div class="mob-sec mday">${esc(g)} <span>${js.length}</span></div>
      ${js.map(opCard).join("") || `<p class="muted pad">Nothing booked for ${esc(orgSettings().name)}.</p>`}`).join("") || `<p class="muted pad">${ui.opTab === "done" ? "No completed jobs in the last 30 days." : "Nothing booked for " + orgSettings().name + " this week."}</p>`}
    ${opTabs(ui.opTab)}</div>`;
  bindOp(mine);
}
function renderOpDetail(j) {
  const q = queueOf(j), done = j.status === "Done", started = j.status === "In progress";
  const p = phonePlace(j.address);
  const crew = namesOf(j);
  const type = TYPES[j.type] || "Job";
  const addrLine = [p.street, p.place].filter(Boolean).join(", ") || p.full || j.address || "";
  const onChat = ui.jobPane === "chat";
  $("#app").innerHTML = `<div class="mob"><div class="mob-bar det ${QCLS[q]}"><button class="mback" id="back" type="button">${ICO.back}<span class="sr">Jobs</span></button>
      <div class="mob-bar-txt"><div class="mob-title">Job details</div>${started ? ipTop(j, "onbar") : ""}<div class="mob-sub">${done ? "Completed" : started ? "In progress" : "Scheduled"} · #${esc(jobNo(j))}</div>
        <div class="mob-brandline"><span class="wordmark" aria-label="${esc(PRODUCT_NAME)}">Call<span>Up</span></span><span class="orgbit">${esc(orgSettings().name)}</span></div></div></div>
    <div class="job-switch" role="tablist" aria-label="Job sections">
      <button type="button" data-jtab="job" class="${onChat ? "" : "on"}">Job</button>
      <button type="button" data-jtab="chat" class="${onChat ? "on" : ""}">Chat ${CHAT.badge("job_" + j.id)}</button>
    </div>
    <div class="job-chat"${onChat ? "" : " hidden"}></div>
    <div class="det-body"${onChat ? " hidden" : ""}>
      <div class="typepill">${esc(type)}</div>
      <h1 class="det-lot">${esc(p.head || "Job")}</h1>
      <p class="det-addr">${esc(addrLine || "-")}</p>
      <div class="mcard"><div class="mlbl">Client</div><div class="mval">${esc(j.client || "—")}</div><div class="supcard" data-sup="${esc(j.id)}"></div></div>
      <dl class="det-facts">
        <div><dt>Scheduled</dt><dd>${esc(j.date ? longDate(j.date) : "Unscheduled")}${j.time ? " · " + esc(phoneTime(j.time)) : ""}${j.durationHrs ? " · " + esc(j.durationHrs) + "h" : ""}</dd></div>
        <div><dt>Crew</dt><dd>${esc(crew.length ? crew.join(", ") : "—")}</dd></div>
        <div><dt>Purchase order</dt><dd><b>${esc(j.po || "—")}</b></dd></div>
        <div class="scope"><dt>Scope</dt><dd>${esc(j.description || "—")}</dd></div>
      </dl>
      <div class="mcard"><div class="mlbl">Diary</div>${(j.log || []).map(l => `<div class="de"><span class="av">${esc((l.byName || "?")[0])}</span><div><small>${esc(l.byName)} · ${esc(l.at)}</small><div>${esc(l.text)}</div></div></div>`).join("") || `<div class="muted sub">No notes yet</div>`}
        <button class="mnote" type="button" data-act="note">Add note</button></div>
      <div class="mcard"><div class="mlbl">Photos</div><div data-photoslot="${esc(j.id)}" data-photorole="cloud"></div>${emailedPhotosNote(j)}<div class="muted sub">Cloud photos are the private copies stored for this job.</div></div>
      <div class="mcard safecard"><div class="mlbl">Safety</div><button type="button" class="mnote" data-swms="${j.id}">View SWMS</button><button type="button" class="mnote incbtn" data-inc="${j.id}">Report incident</button></div>
      <div class="mcard">${jobReceiptsHtml(j)}</div>
    </div>
    <div class="mactions"${onChat ? " hidden" : ""}>${done ? `<div class="donebar">Completed${j.loads ? ` · ${esc(j.loads)} loads` : ""}</div>` :
      `<button class="mbtn start" type="button" data-act="start" ${started ? "disabled" : ""}>${ICO.play}<span>${started ? "Started" : "Start job"}</span></button>
       <button class="mbtn complete" type="button" data-act="done">Complete job</button>`}
      <button type="button" class="mbtn mnote op-photo" id="emailph">${ICO.photos}<span>Add photos</span></button>
      <a class="mcard link mbtn outline" href="${mapsUrl(j.address || "")}" target="_blank" rel="noopener">${ICO.pin}<span>Get directions</span></a>
    </div></div>`;
  rememberJob(j); $("#emailph").onclick = () => emailPhotos(j); wireJobReceipts(j); fillSupCard(j); watchJobPhotos(j); paintPhotoSlots();
  const showJobPane = which => {
    ui.jobPane = which === "chat" ? "chat" : "job";
    $("#app").querySelectorAll("[data-jtab]").forEach(b => { b.classList.toggle("on", b.dataset.jtab === ui.jobPane); b.setAttribute("aria-selected", b.dataset.jtab === ui.jobPane ? "true" : "false"); });
    const chatOn = ui.jobPane === "chat";
    document.querySelector(".det-body")?.toggleAttribute("hidden", chatOn);
    document.querySelector(".mactions")?.toggleAttribute("hidden", chatOn);
    const pane = document.querySelector(".job-chat");
    pane?.toggleAttribute("hidden", !chatOn);
    if (chatOn) CHAT.openJob(pane, j);
  };
  $("#app").querySelectorAll("[data-jtab]").forEach(b => b.onclick = () => showJobPane(b.dataset.jtab));
  if (onChat) CHAT.openJob(document.querySelector(".job-chat"), j);
  $("#back").onclick = () => { ui.opSel = null; ui.jobPane = "job"; renderOperator(); };
  $("#app").querySelectorAll("[data-act]").forEach(b => b.onclick = () => opAction(j, b.dataset.act));
}
const logEntry = text => ({ text, by: me.uid, byName: me.name, at: new Date().toLocaleString("en-AU", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }) });
async function opAction(j, act) {
  const ref = doc(db, "jobs", j.id), base = { updatedAt: serverTimestamp(), updatedBy: me.uid };
  if (act === "start") { await updateDoc(ref, { ...base, status: "In progress", startedAt: serverTimestamp() }); return toast("Started"); }
  const d = $("#dlg"); d.className = ""; d.onclose = null;
  d.innerHTML = `<form method="dialog" id="of" class="jf"><h2>${act === "done" ? "Complete job" : "Add note"}</h2>
    <p class="muted">${esc(j.address)}</p>
    ${act === "done" ? `<label>Loads (optional)<input name="loads" type="number" inputmode="numeric" min="0" value="${esc(j.loads ?? "")}"></label>` : ""}
    <label>Note${act === "done" ? " (optional)" : ""}<textarea name="note" rows="3" ${act === "note" ? "required" : ""}></textarea></label>
    <div class="btns"><button value="cancel" formnovalidate class="ghost big">Cancel</button><button value="ok" class="primary big">${act === "done" ? "Complete ✔" : "Save note"}</button></div></form>`;
  d.showModal();
  $("#of").onsubmit = async ev => {
    if (ev.submitter?.value !== "ok") return;
    ev.preventDefault(); const f = ev.target, note = f.note.value.trim();
    const u = { ...base };
    if (note) u.log = arrayUnion(logEntry(note));
    if (act === "done") Object.assign(u, { status: "Done", completedAt: serverTimestamp(), completedBy: me.uid, completedByName: me.name,
      loads: f.loads.value === "" ? null : +f.loads.value });
    d.close();
    updateDoc(ref, u).then(() => toast(act === "done" ? "Marked done" : "Note saved")).catch(e => toast("Not saved: " + e.code));
    if (!navigator.onLine) toast("Offline — will sync when back in signal");
  };
}

// ------------------------------------------------------------------ email photos
// Pick photos -> (downscale) -> share sheet (Mail / Gmail) with subject + body, or a mailto: fallback. Then a diary entry.
// Accepted files are also mirrored to private Storage. The gallery reads those objects back and does not rewrite the job.
// The share must be started by a fresh tap (browsers require a user gesture), so the picked photos are shown in a
// small dialog with a "Send" button.
const OFFICE_EMAIL = "alex@heartwoodew.com";
const emailSubject = j => `[Job Photos] Job #${jobNo(j)} – ${j.address || "(no address)"}`;
const emailBody = (j, infos, attached) => [`Job #${jobNo(j)}`, `Address: ${j.address || "-"}`, `Client: ${j.client || "-"}`, `PO: ${j.po || "-"}`,
  `Job date: ${j.date ? dayLabel(j.date) : "-"}`, "",
  attached ? `${infos.length} photo${infos.length > 1 ? "s" : ""} attached:` : `Please attach ${infos.length > 1 ? `these ${infos.length} photos` : "this photo"} to this email:`,
  ...infos.map((x, i) => `${i + 1}. ${x.time} (Brisbane) · ${fmtLL(x.gps)}${x.gps ? ` (${x.gps.src === "photo" ? "photo GPS" : "phone location"}) ${mapLink(x.gps)}` : ""}`),
  "", `From ${me.name}`, orgSettings().signoff, POWERED_BY].join("\n");
// Minimal EXIF reader (JPEG APP1): DateTimeOriginal + GPS. Returns {}, never throws.
async function readExif(f) {
  try {
    const v = new DataView(await f.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return {};
    let o = 2;
    while (o + 4 < v.byteLength) {
      const m = v.getUint16(o), len = v.getUint16(o + 2);
      if (m === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return parseTiff(v, o + 10);
      if ((m & 0xFF00) !== 0xFF00) break; o += 2 + len;
    }
  } catch {}
  return {};
}
function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949, u16 = o => v.getUint16(o, le), u32 = o => v.getUint32(o, le);
  const ifd = off => { const out = {}, n = u16(t + off); for (let i = 0; i < n; i++) { const e = t + off + 2 + i * 12; out[u16(e)] = { type: u16(e + 2), cnt: u32(e + 4), at: e + 8 }; } return out; };
  const str = e => { const p = e.cnt > 4 ? t + u32(e.at) : e.at; let r = ""; for (let i = 0; i < e.cnt - 1; i++) r += String.fromCharCode(v.getUint8(p + i)); return r; };
  const rats = e => { const p = t + u32(e.at); return [...Array(e.cnt)].map((_, i) => u32(p + i * 8) / (u32(p + i * 8 + 4) || 1)); };
  const out = {}, i0 = ifd(u32(t + 4));
  if (i0[0x8769]) { const ex = ifd(u32(i0[0x8769].at)); const d = ex[0x9003] || ex[0x9004]; if (d) out.taken = str(d); }
  if (!out.taken && i0[0x0132]) out.taken = str(i0[0x0132]);
  if (i0[0x8825]) {
    const g = ifd(u32(i0[0x8825].at));
    if (g[2] && g[4]) {
      const dms = a => a[0] + a[1] / 60 + a[2] / 3600, ref = k => g[k] ? String.fromCharCode(v.getUint8(g[k].at)) : "";
      out.lat = dms(rats(g[2])) * (ref(1) === "S" ? -1 : 1); out.lng = dms(rats(g[4])) * (ref(3) === "W" ? -1 : 1);
    }
  }
  return out;
}
// EXIF "YYYY:MM:DD HH:MM:SS" is camera-local (phones here = Brisbane); lastModified is an instant.
function takenAt(f, ex) {
  const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d)/.exec(ex.taken || "");
  if (m) return { label: `${+m[3]}/${+m[2]}/${m[1]} ${m[4]}:${m[5]}`, src: "camera" };
  const d = new Date(f.lastModified || Date.now());
  return { label: d.toLocaleString("en-AU", { timeZone: TZ, day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", ""), src: "file" };
}
let geoAsked = null;
function hereNow() {     // asked once per session; resolves null if denied / unavailable
  if (!navigator.geolocation) return Promise.resolve(null);
  if (geoAsked) return geoAsked;
  geoAsked = new Promise(r => navigator.geolocation.getCurrentPosition(p => r({ lat: p.coords.latitude, lng: p.coords.longitude }), () => r(null),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 }));
  geoAsked.then(x => { if (!x) setTimeout(() => { geoAsked = null; }, 60000); });
  return geoAsked;
}
const fmtLL = g => g ? `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}` : "location unavailable";
const mapLink = g => g ? `https://maps.google.com/?q=${g.lat.toFixed(5)},${g.lng.toFixed(5)}` : "";
// Stamp (always) + downscale (unless keeping full size): black bar at the bottom, job number big, then time, GPS, address.
async function stampPhoto(f, j, info, max) {
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
    const k = max ? Math.min(1, max / Math.max(bmp.width, bmp.height)) : 1;
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext("2d"); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    const u = Math.max(14, Math.round(Math.min(c.width, c.height) / 40)), pad = Math.round(u * 0.7);
    const lines = [[`${info.time}   ·   ${fmtLL(info.gps)}`, u], [j.address || "", u]];
    const barH = pad * 2 + Math.round(u * 2.2) + lines.length * Math.round(u * 1.35);
    g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(0, c.height - barH, c.width, barH);
    g.fillStyle = "#fff"; g.textBaseline = "top";
    let y = c.height - barH + pad;
    g.font = `bold ${Math.round(u * 1.9)}px system-ui, sans-serif`; g.fillText(`JOB #${jobNo(j)}`, pad, y); y += Math.round(u * 2.2);
    for (const [t, sz] of lines) { g.font = `${sz}px system-ui, sans-serif`; g.fillText(t, pad, y, c.width - pad * 2); y += Math.round(sz * 1.35); }
    const b = await new Promise(r => c.toBlob(r, "image/jpeg", max ? 0.85 : 0.92));
    return b ? new File([b], `job${jobNo(j)}_${f.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" }) : f;
  } catch { return f; }       // a format the browser can't decode: send the original unstamped
}
function emailPhotos(j, o = {}) {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
  inp.style.cssText = "position:fixed;left:-9999px;opacity:0"; document.body.appendChild(inp);
  inp.onchange = async () => {
    const picked = [...inp.files].filter(f => /^image\//.test(f.type || "image/jpeg")); inp.remove();
    if (!picked.length) return;
    toast("Preparing photos…");
    const exifs = await Promise.all(picked.map(readExif));
    const here = exifs.every(e => e.lat != null) ? null : await hereNow();
    const keep = picked.length <= 3 && picked.reduce((a, f) => a + f.size, 0) <= 20e6;
    const infos = picked.map((f, i) => ({ name: f.name, time: takenAt(f, exifs[i]).label,
      gps: exifs[i].lat != null ? { lat: exifs[i].lat, lng: exifs[i].lng, src: "photo" } : here && { ...here, src: "phone" } }));
    const files = await Promise.all(picked.map((f, i) => stampPhoto(f, j, infos[i], keep ? 0 : 2560)));
    emailDialog(j, files, infos, o);
  };
  inp.click();
}
function emailDialog(j, files, infos, o = {}) {
  const subj = o.subject || emailSubject(j), body = o.body || emailBody;
  if (!o.coll || o.coll === "jobs") mirrorJobPhotos(j, files).catch(e => console.warn("cloud photo mirror", e && (e.code || e.message) || e));
  // Record on the job (or incident) that photos were emailed, so it shows a "Photos" link to the Gmail search. Best effort.
  updateDoc(doc(db, o.coll || "jobs", j.id), { photosEmailedAt: new Date().toISOString(), photosEmailedCount: (j.photosEmailedCount || 0) + files.length, updatedAt: serverTimestamp(), updatedBy: me.uid })
    .catch(e => console.warn("photosEmailed flag not saved", e.code || e.message));
  const mb = files.reduce((a, f) => a + f.size, 0) / 1e6, n = files.length;
  const canShare = !!(navigator.canShare && navigator.canShare({ files }));
  const mailto = `mailto:${OFFICE_EMAIL}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body(j, infos, false))}`;
  const v = document.createElement("div"); v.className = "emdlg";
  v.innerHTML = `<div class="embox"><h3>📧 Email ${n} photo${n > 1 ? "s" : ""}</h3>
    <div class="emthumbs">${files.map(f => `<img src="${URL.createObjectURL(f)}" alt="">`).join("")}</div>
    <p class="sub muted">${o.coll ? esc(j.reportNo) : "Job #" + esc(jobNo(j))} · ${esc(j.address || "")} · ${mb.toFixed(1)} MB${mb > 24 ? " — may be too big for one email, send fewer at a time" : ""}</p>
    ${canShare ? `<button type="button" class="mbtn complete" data-a="share">Send via email app</button>
      <p class="sub muted">Choose Mail or Gmail, then put <b>${OFFICE_EMAIL}</b> in the To box (the subject and job details are filled in).</p>`
    : `<p class="sub">This browser can't attach photos automatically. Tap below to open an email to ${OFFICE_EMAIL}, then attach the photos yourself.</p>
      <a class="mbtn complete" data-a="mail" href="${mailto}">Open email to Alex</a>
      <button type="button" class="mbtn" data-a="sent">I've sent it</button>`}
    <button type="button" class="mbtn ghost" data-a="x">Cancel</button></div>`;
  (document.querySelector("dialog[open]") || document.body).appendChild(v);
  const close = () => v.remove();
  v.querySelector('[data-a="x"]').onclick = close;
  const logIt = o.log ? () => o.log(n) : async () => {
    const ref = doc(db, "jobs", j.id);
    try { await updateDoc(ref, { log: arrayUnion(logEntry(`Photos emailed (${n}) by ${me.name}: ` + infos.map(x => `${x.time} @ ${fmtLL(x.gps)}`).join("; "))), updatedAt: serverTimestamp(), updatedBy: me.uid }); toast("Noted in the diary"); }
    catch (e) { toast("Diary not updated: " + (e.code || e.message)); }
  };
  const sh = v.querySelector('[data-a="share"]');
  if (sh) sh.onclick = async () => {
    try {
      await navigator.share({ files, title: subj, text: `To: ${OFFICE_EMAIL}\nSubject: ${subj}\n\n${body(j, infos, true)}` });
      close(); logIt();
    } catch (e) { if (e.name !== "AbortError") toast("Share failed: " + e.message); }
  };
  const sent = v.querySelector('[data-a="sent"]');
  if (sent) sent.onclick = () => { close(); logIt(); };
}

// ------------------------------------------------------------------ Dispatch Board on a phone (<= 760px): one-day agenda
// Sticky day header (‹ Today ›, swipe left/right), 7-day strip with counts, jobs grouped by staff in bold bands,
// big cards; "Move" opens a bottom sheet (date / time / staff) that saves exactly like the desktop drag
// (editedInApp -> pushed to ServiceM8 by the box sync).
function mobileDispatch(all) {
  const t0 = todayStr(); ui.mday = ui.mday || t0; const d = ui.mday;
  const sched = all.filter(j => j.date && queueOf(j) !== "Unsuccessful");
  const wk0 = addDays(d, -dowMon(d)), strip = [...Array(7)].map((_, i) => addDays(wk0, i));
  const dayJobs = sched.filter(j => j.date === d).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const card = j => `<div class="mdc ${QCLS[queueOf(j)]}" data-id="${j.id}">
      <div class="mdc-top"><b class="mdc-time">${esc(j.time || "--:--")}</b><span class="mdc-no">#${esc(jobNo(j))}</span><span class="pstack">${ipPill(j, "sm")}<span class="qpill ${QCLS[queueOf(j)]}">${esc(queueOf(j))}</span></span></div>
      <div class="mdc-cl">${esc(j.client || "")}</div>
      <a class="mdc-addr" href="${mapsUrl(j.address || "")}" target="_blank" rel="noopener">📍 ${esc(j.address || "-")}</a>
      <div class="mdc-desc">${esc(firstLine(j.description))}</div>
      <div class="mdc-foot"><span class="sub">${j.po ? "PO " + esc(j.po) : "No PO"}${j.durationHrs ? " · " + esc(j.durationHrs) + "h" : ""}</span>
        <span><button type="button" class="sm-btn mdc-unsch" data-unsch="${j.id}" title="Remove from dispatch board (back to Unscheduled)">✕ Off board</button> <button type="button" class="sm-btn mdc-move" data-move="${j.id}">⇄ Move</button></span></div></div>`;
  const groups = rowsFor(all).map(r => [r, dayJobs.filter(r.has)]);
  return `<div class="mdisp" id="mdisp"><div class="mdh">
      <div class="mdh-row"><button class="sm-btn" data-md="-1" aria-label="Previous day">‹</button>
        <div class="mdh-date"><b>${esc(dayLabel(d))}</b>${d === t0 ? '<span class="sub">Today</span>' : ""}</div>
        <button class="sm-btn" data-md="1" aria-label="Next day">›</button><button class="sm-btn" data-md="0">Today</button></div>
      <div class="mstrip">${strip.map(x => { const n = sched.filter(j => j.date === x).length;
        return `<button class="${x === d ? "on" : ""} ${x === t0 ? "today" : ""}" data-mday="${x}"><small>${new Date(x + "T00:00:00Z").toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" })}</small><b>${+x.slice(8)}</b><span class="${n ? "" : "zero"}">${n}</span></button>`; }).join("")}</div></div>
    <button type="button" class="route-open" id="optorder">Optimise order</button>
    ${groups.map(([r, js]) => `<div class="mgrp">${esc(r.name)} <span class="cnt">${js.length}</span></div>${js.map(card).join("") || `<p class="muted sub pad">Nothing booked for ${esc(orgSettings().name)}.</p>`}`).join("")}
    <p class="sub muted pad">Swipe left / right to change day. Tap a card to open the job.</p></div>`;
}
function bindMobileDispatch(A, pool) {
  const go = d => { ui.mday = d; renderAdmin(); window.scrollTo(0, 0); };
  A.querySelectorAll("[data-md]").forEach(b => b.onclick = () => go(+b.dataset.md === 0 ? todayStr() : addDays(ui.mday, +b.dataset.md)));
  A.querySelectorAll("[data-mday]").forEach(b => b.onclick = () => go(b.dataset.mday));
  A.querySelectorAll(".mdc").forEach(c => { c.draggable = false; c.ondragstart = null; });
  A.querySelectorAll(".mdc-addr").forEach(a => a.addEventListener("click", ev => ev.stopPropagation()));
  A.querySelectorAll("[data-move]").forEach(b => b.onclick = ev => { ev.stopPropagation(); const j = pool.find(x => x.id === b.dataset.move); if (j) moveSheet(j); });
  A.querySelectorAll("[data-unsch]").forEach(b => b.onclick = ev => { ev.stopPropagation(); const j = pool.find(x => x.id === b.dataset.unsch); if (!j) return;
    if (!armBtn(b, "✕ Off board", "Tap again to remove")) return; unscheduleJob(j).catch(e => toast("Not removed: " + (e.code || e.message))); });
  const el = $("#mdisp"); let x0 = null, y0 = null;
  if (el) {
    el.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener("touchend", e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(addDays(ui.mday, dx < 0 ? 1 : -1)); }, { passive: true });
  }
}
function moveSheet(j) {
  const v = document.createElement("div"); v.className = "emdlg"; const cur = namesOf(j).map(n => n.toLowerCase());
  v.innerHTML = `<form class="embox msheet"><h3>Move #${esc(jobNo(j))}</h3><p class="sub muted">${esc(j.address || "")}</p>
    <div class="row"><label>Date<input type="date" name="date" value="${esc(j.date || todayStr())}" required></label><label>Time<input type="time" name="time" value="${esc(j.time || "07:00")}"></label></div>
    <fieldset class="staffs">${staff.map(s => `<label class="ck"><input type="checkbox" name="st" value="${esc(skey(s))}" ${cur.includes(s.name.toLowerCase()) ? "checked" : ""}> ${esc(s.name)}</label>`).join("")}</fieldset>
    <p class="sub muted">No one ticked = Unallocated. Saved to the app, then sent to ServiceM8 by the next sync.</p>
    <button class="mbtn complete">Save</button><button type="button" class="mbtn" data-x>Cancel</button></form>`;
  document.body.appendChild(v);
  v.querySelector("[data-x]").onclick = () => v.remove();
  v.onclick = e => { if (e.target === v) v.remove(); };
  v.querySelector("form").onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const picked = [...f.querySelectorAll("[name=st]:checked")].map(x => staff.find(s => skey(s) === x.value)).filter(Boolean);
    const u = { date: f.date.value, time: f.time.value, assignedNames: picked.map(s => s.name), assigned: picked.filter(s => s.uid).map(s => s.uid),
      editedInApp: true, updatedAt: serverTimestamp(), updatedBy: me.uid };
    try { await updateDoc(doc(db, "jobs", j.id), u); } catch (err) { return toast("Not saved: " + (err.code || err.message)); }
    v.remove(); ui.mday = u.date; toast(`Moved to ${shortDate(u.date)} ${u.time} · ${u.assignedNames.join(", ") || "Unallocated"}`); renderAdmin();
  };
}

// ------------------------------------------------------------------ Safety / incident reports (ISO 45001-friendly records)
// incidents/{INC-0001}: sequential report no from incidentCounter/main (transaction). Reporter can't edit after submit;
// admins add root cause + corrective actions and close. Every change is appended to `history` (audit trail). No deletes.
const INC_TYPES = ["Incident", "Near miss", "Hazard", "Injury", "Property damage"];
const incPad = n => "INC-" + String(n).padStart(4, "0");
const nowLocal = () => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(" ", "T");
const stamp = () => new Date().toLocaleString("en-AU", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
const fmtDT = s => s ? new Date(s + ":00Z").toLocaleString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "-";
const incPhotosUrl = r => GM + "#search/" + encodeURIComponent(`subject:"[Incident Photos] ${r.reportNo}"`);
const incCls = r => r.status === "Closed" ? "q-comp" : "q-alert";
const isAdm = () => me && me.role === "admin";
document.addEventListener("click", e => {
  const b = e.target.closest("[data-inc]"); if (!b) return; e.preventDefault(); e.stopPropagation();
  const j = b.dataset.inc && [...jobs, ...(ui.undated || []), ...(ui.done || [])].find(x => x.id === b.dataset.inc);
  incidentForm(j || null);
}, true);
document.addEventListener("click", e => {
  const r = e.target.closest("[data-incid]"); if (!r || e.target.closest("a")) return;
  const inc = (ui.incidents || []).find(x => x.id === r.dataset.incid); if (inc) incidentDetail(inc);
});
function incOverlay(html, keep) {
  if (!keep) document.querySelectorAll(".incdlg").forEach(x => x.remove());
  const v = document.createElement("div"); v.className = "emdlg incdlg"; v.innerHTML = `<div class="embox incbox">${html}</div>`;
  (document.querySelector("dialog[open]") || document.body).appendChild(v); return v;
}
function incidentForm(j) {
  const v = incOverlay(`<h3>⚠ Report incident</h3>
    <form id="incf" class="incform">
      <label>Type<select name="type" required>${INC_TYPES.map(t => `<option>${t}</option>`).join("")}</select></label>
      <label>Date / time<input type="datetime-local" name="occurredAt" value="${nowLocal()}" required></label>
      <label>Job (optional)<input name="jobNo" value="${j ? esc(jobNo(j)) : ""}" placeholder="Job #"></label>
      <label>Location / address<input name="location" value="${esc(j ? j.address || "" : "")}" required></label>
      <label>People involved<input name="people" placeholder="Names, incl. visitors / subbies"></label>
      <label>What happened<textarea name="what" rows="4" required></textarea></label>
      <label class="injf hidden">Injury details (body part, nature, treatment)<textarea name="injury" rows="3"></textarea></label>
      <label>Immediate action taken<textarea name="action" rows="3" required></textarea></label>
      <p class="sub muted">Reported by <b>${esc(me.name)}</b> · saved as a numbered record (can't be edited after submit). Add photos on the next screen.</p>
      <div class="btns"><button type="button" class="mbtn ghost" data-x>Cancel</button><button class="mbtn complete">Submit report</button></div>
    </form>`);
  const f = v.querySelector("#incf"), inj = v.querySelector(".injf");
  f.type.onchange = () => { inj.classList.toggle("hidden", f.type.value !== "Injury"); f.injury.required = f.type.value === "Injury"; };
  v.querySelector("[data-x]").onclick = () => v.remove();
  f.onsubmit = async ev => {
    ev.preventDefault(); const btn = f.querySelector(".complete"); btn.disabled = true;
    const data = { type: f.type.value, occurredAt: f.occurredAt.value, jobId: j ? j.id : "", jobNo: f.jobNo.value.trim(), location: f.location.value.trim(),
      people: f.people.value.trim(), what: f.what.value.trim(), injury: f.type.value === "Injury" ? f.injury.value.trim() : "", action: f.action.value.trim(),
      reportedBy: me.uid, reportedByName: me.name, reportedAt: new Date().toISOString(), createdAt: serverTimestamp(), status: "Open",
      rootCause: "", actions: [], history: [{ at: stamp(), by: me.name, text: "Reported" }] };
    try {
      const no = await runTransaction(db, async tx => {
        const cref = doc(db, "incidentCounter", "main"), c = await tx.get(cref);
        const n = (c.exists() ? c.data().n : 0) + 1, reportNo = incPad(n);
        tx.set(cref, { n }); tx.set(doc(db, "incidents", reportNo), { ...data, seq: n, reportNo }); return reportNo;
      });
      toast(`${no} saved`); v.remove();
      incidentDetail({ id: no, reportNo: no, seq: 0, ...data });
    } catch (e) { btn.disabled = false; toast("Not saved: " + (e.code || e.message)); }
  };
}
function incRefresh() {   // keep an open detail view in sync with Firestore
  const d = document.querySelector(".incdlg[data-open]"); if (!d) return;
  const r = (ui.incidents || []).find(x => x.id === d.dataset.open); if (r && !d.querySelector(".dirty")) incidentDetail(r);
}
function incidentDetail(r) {
  const adm = isAdm(), open = r.status !== "Closed", acts = r.actions || [];
  const row = (k, v) => v ? `<div class="incrow"><div class="mlbl">${k}</div><div>${esc(v).replace(/\n/g, "<br>")}</div></div>` : "";
  const v = incOverlay(`<div class="inchead"><h3>${esc(r.reportNo)} · ${esc(r.type)}</h3><span class="qpill ${incCls(r)}">${esc(r.status)}</span></div>
    ${row("Date / time", fmtDT(r.occurredAt))}${row("Job", r.jobNo ? "#" + r.jobNo : "")}${row("Location", r.location)}${row("People involved", r.people)}
    ${row("What happened", r.what)}${row("Injury details", r.injury)}${row("Immediate action taken", r.action)}
    ${row("Reported by", `${r.reportedByName || "?"} · ${r.reportedAt ? new Date(r.reportedAt).toLocaleString("en-AU", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }) : ""}`)}
    <div class="incrow"><div class="mlbl">Photos</div><button type="button" class="sm-btn" id="incph">📧 Email photos</button>
      ${r.photosEmailedCount ? ` <a class="phlink" href="${incPhotosUrl(r)}" target="_blank" rel="noopener">📷 Photos (${r.photosEmailedCount} sent)</a>` : ""}</div>
    <h4>Investigation</h4>
    ${adm && open ? `<label>Root cause<textarea id="incrc" rows="3">${esc(r.rootCause || "")}</textarea></label>` : row("Root cause", r.rootCause || (open ? "Not yet investigated" : "-"))}
    <div class="mlbl">Corrective actions</div>
    <table class="jt incacts"><thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Done</th></tr></thead><tbody>
      ${acts.map((a, i) => `<tr><td>${esc(a.text)}</td><td>${esc(a.owner)}</td><td>${esc(a.due ? dmy(a.due) : "")}</td>
        <td>${adm && open ? `<input type="checkbox" data-ad="${i}" ${a.done ? "checked" : ""}>` : a.done ? "✔ " + esc(a.doneAt || "") : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">None yet</td></tr>`}</tbody></table>
    ${adm && open ? `<div class="incadd"><input id="iat" placeholder="New corrective action"><select id="iao">${staff.map(s => `<option>${esc(s.name)}</option>`).join("")}</select><input id="iad" type="date"><button type="button" class="sm-btn" id="iaadd">+ Add</button></div>` : ""}
    ${!open ? row("Closed", `${r.closedByName || "?"} · ${r.closedAt || ""}`) : ""}
    <details class="inchist"><summary>History (${(r.history || []).length})</summary>${(r.history || []).map(h => `<div class="sub">${esc(h.at)} · ${esc(h.by)} · ${esc(h.text)}</div>`).join("")}</details>
    <div class="btns">${adm && open ? `<button type="button" class="mbtn" id="incsave">Save</button><button type="button" class="mbtn complete" id="incclose">Close report</button>` : ""}<button type="button" class="mbtn ghost" data-x>Back</button></div>`);
  v.dataset.open = r.id;
  v.querySelector("[data-x]").onclick = () => v.remove();
  v.querySelector("#incph").onclick = () => emailPhotos({ id: r.id, reportNo: r.reportNo, sm8JobNo: r.reportNo, address: r.location, photosEmailedCount: r.photosEmailedCount }, {
    coll: "incidents", subject: `[Incident Photos] ${r.reportNo}`,
    body: (x, infos, att) => [`Incident report ${r.reportNo} (${r.type})`, `When: ${fmtDT(r.occurredAt)}`, `Location: ${r.location || "-"}`, r.jobNo ? `Job #${r.jobNo}` : "", "",
      att ? `${infos.length} photo(s) attached:` : `Please attach ${infos.length} photo(s) to this email:`, ...infos.map((y, i) => `${i + 1}. ${y.time} (Brisbane) · ${fmtLL(y.gps)}`), "", `From ${me.name}`].filter(x => x !== null).join("\n"),
    log: () => toast("Photos noted on " + r.reportNo) });
  if (!(adm && open)) return;
  v.querySelectorAll("textarea,input").forEach(x => x.oninput = () => x.classList.add("dirty"));
  const ref = doc(db, "incidents", r.id);
  const save = async (extra = {}, note) => {
    const rc = v.querySelector("#incrc").value.trim(), hist = [...(r.history || [])];
    if (rc !== (r.rootCause || "")) hist.push({ at: stamp(), by: me.name, text: "Root cause updated" });
    if (note) hist.push({ at: stamp(), by: me.name, text: note });
    const u = { rootCause: rc, history: hist, updatedAt: serverTimestamp(), updatedBy: me.uid, ...extra };
    try { await updateDoc(ref, u); Object.assign(r, u); toast("Saved"); incidentDetail(r); } catch (e) { toast("Not saved: " + (e.code || e.message)); }
  };
  v.querySelector("#iaadd").onclick = () => { const t = v.querySelector("#iat").value.trim(); if (!t) return toast("Type the action first");
    const a = { text: t, owner: v.querySelector("#iao").value, due: v.querySelector("#iad").value, done: false };
    save({ actions: [...acts, a] }, `Action added: ${t} (${a.owner}${a.due ? ", due " + dmy(a.due) : ""})`); };
  v.querySelectorAll("[data-ad]").forEach(cb => cb.onchange = () => { const i = +cb.dataset.ad, na = acts.map((a, k) => k === i ? { ...a, done: cb.checked, doneAt: cb.checked ? stamp() : "" } : a);
    save({ actions: na }, `Action ${cb.checked ? "done" : "re-opened"}: ${acts[i].text}`); });
  v.querySelector("#incsave").onclick = () => save();
  v.querySelector("#incclose").onclick = () => {
    if (!v.querySelector("#incrc").value.trim()) return toast("Add the root cause before closing");
    if (acts.some(a => !a.done) && !confirm("Some corrective actions aren't done. Close anyway?")) return;
    save({ status: "Closed", closedBy: me.uid, closedByName: me.name, closedAt: stamp() }, "Closed");
  };
}
function safetyView() {
  ui.incS = ui.incS || "Open"; ui.incT = ui.incT || "";
  const all = (ui.incidents || []).slice().sort((a, b) => (b.seq || 0) - (a.seq || 0));
  const list = all.filter(r => (ui.incS === "All" || r.status === ui.incS) && (!ui.incT || r.type === ui.incT));
  const cnt = st => all.filter(r => st === "All" || r.status === st).length;
  setTimeout(() => {
    document.querySelectorAll("[data-incs]").forEach(b => b.onclick = () => { ui.incS = b.dataset.incs; renderAdmin(); });
    const t = $("#inct"); if (t) t.onchange = () => { ui.incT = t.value; renderAdmin(); };
  });
  return `<div class="sm-head"><h1>Safety</h1><span class="headbtns"><button class="sm-btn" data-view="swms">📋 SWMS</button><button class="sm-btn primary" data-inc="">⚠ Report incident</button></span></div>
    <div class="qtabs">${["Open", "Closed", "All"].map(k => `<button data-incs="${k}" class="${ui.incS === k ? "on" : ""}">${k} <span>${cnt(k)}</span></button>`).join("")}</div>
    <div class="filters"><select id="inct"><option value="">All types</option>${INC_TYPES.map(t => `<option ${ui.incT === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
    <table class="jt"><thead><tr><th>Report</th><th>Type</th><th>When</th><th>Location / job</th><th>What happened</th><th>Reported by</th><th>Actions</th><th>Status</th></tr></thead><tbody>
    ${list.map(r => `<tr class="jr" data-incid="${esc(r.id)}"><td class="jn">${esc(r.reportNo)}${r.photosEmailedCount ? ` <a class="phicon" href="${incPhotosUrl(r)}" target="_blank" rel="noopener">📷</a>` : ""}</td><td>${esc(r.type)}</td><td>${esc(fmtDT(r.occurredAt))}</td>
      <td>${esc(r.location || "-")}<div class="sub">${r.jobNo ? "Job #" + esc(r.jobNo) : ""}</div></td><td>${esc(firstLine(r.what))}</td><td>${esc(r.reportedByName || "")}</td>
      <td>${(r.actions || []).filter(a => a.done).length}/${(r.actions || []).length}</td><td><span class="qpill ${incCls(r)}">${esc(r.status)}</span></td></tr>`).join("") || `<tr><td colspan="8" class="muted pad">No reports.</td></tr>`}</tbody></table>`;
}
function myIncidentsHtml() {
  const L = (ui.incidents || []).filter(r => r.reportedBy === me.uid).sort((a, b) => (b.seq || 0) - (a.seq || 0));
  if (!L.length) return "";
  return `<div class="hsec"><div class="hsec-h">My safety reports <span class="cnt">${L.length}</span></div>${L.map(r => `<div class="hrow" data-incid="${esc(r.id)}"><div class="htime"><b>${esc(r.reportNo.slice(4))}</b><small>INC</small></div>
    <div class="hbody"><div class="hcl">${esc(r.type)}</div><div class="sub">${esc(fmtDT(r.occurredAt))} · ${esc(r.location || "")}</div></div><span class="qpill ${incCls(r)}">${esc(r.status)}</span></div>`).join("")}</div>`;
}

// ------------------------------------------------------------------ SWMS (Safe Work Method Statements, Jul 2026)
// Official PDFs are not in this repository. When swmsChunks has the file, that PDF is used.
// When it does not, the app opens a placeholder page that is explicitly not a SWMS.
const swmsCache = {}, swmsBin = {}, swmsPlaceholder = {};
const swNow = () => (window.HW_NOW || Date.now());
const swmsStatus = sig => {
  const st = statusOf(sig, swNow());
  if (st.k === "exp") return { ...st, label: "Expired " + swD(st.exp) };
  if (st.k === "due") return { ...st, label: `Due soon · expires ${swD(st.exp)}` };
  if (st.k === "ok") return { ...st, label: "Signed · valid to " + swD(st.exp) };
  return st;
};
const swD = ms => new Date(ms).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
const swDT = ms => new Date(ms).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });
const mySwms = () => SWMS.map(([id, t, d]) => ({ id, t, d, st: swmsStatus(latestSig(ui.mySigs, me && me.uid, id)) }));
function swmsReminderHtml() {
  if (!me || !ui.mySigs) return "";
  const bad = mySwms().filter(x => x.st.k !== "ok"); if (!bad.length) return "";
  const exp = bad.filter(x => x.st.k !== "due").length, due = bad.length - exp;
  return `<button type="button" class="swremind ${exp ? "sw-exp" : "sw-due"}" data-swms=""><span class="ic">✍</span><span><b>${exp ? `${exp} SWMS need${exp === 1 ? "s" : ""} signing${due ? ` · ${due} due soon` : ""}` : `${due} SWMS due for re-signing`}</b>
    <small>${bad.map(x => esc(x.t)).join(" · ")}</small></span><span class="chev">›</span></button>`;
}
function swmsSub() {          // my signatures (everyone); all signatures (admins)
  if (ui.swmsUnsub || !me) return;
  const u1 = onSnapshot(query(collection(db, "swmsSignatures"), where("uid", "==", me.uid)), s => { ui.mySigs = s.docs.map(d => ({ id: d.id, ...d.data() })); swmsRefresh(); }, e => console.warn("swms", e.code));
  let u2 = () => {};
  if (me.role === "admin") u2 = onSnapshot(collection(db, "swmsSignatures"), s => { ui.allSigs = s.docs.map(d => ({ id: d.id, ...d.data() })); swmsRefresh(); }, e => console.warn("swms all", e.code));
  ui.swmsUnsub = () => { u1(); u2(); ui.swmsUnsub = null; };
}
function swmsRefresh() {
  const ov = document.querySelector(".incdlg.swov"); if (ov) { const hold = ov.querySelector(".swlistwrap"); if (hold) hold.outerHTML = swmsList(ov.dataset.job || ""); return; }
  if (document.querySelector(".incdlg")) return;
  if (me.role === "admin" && !ui.myJobs) { if (ui.view === "swms" || ui.view === "home") renderAdmin(); } else if (!ui.opSel && (ui.opTab || "today") === "today") renderOperator();
}
const swFlag = s => s.k === "ok" ? "✔ " + swD(s.exp) : s.k === "due" ? "⏳ Due " + swD(s.exp) : s.k === "none" ? "✖ Not signed" : "✖ " + (s.k === "old" ? "Old version" : "Expired " + swD(s.exp));
const swmsList = (jobId = "") => `<div class="swlistwrap"><div class="swlist">${mySwms().map(({ id, t, d, st }) => `<div class="switem swsign">
    <button type="button" class="swopen" data-swmsf="${id}"><span class="swic">📄</span><span><b>${t}</b><small>${d}</small></span></button>
    <div class="swst"><span class="swpill ${st.cls}" data-swstatus="${st.k}">${st.k === "ok" ? "✔ " : st.k === "due" ? "⏳ " : "✖ "}${esc(st.label)}</span>
      <button type="button" class="swbtn ${st.k === "ok" ? "" : "primary"}" data-swsign="${id}" data-job="${esc(jobId)}">${st.k === "none" ? "Read & sign" : st.k === "ok" ? "Sign again" : "Re-sign"}</button></div></div>`).join("")}</div>
  <p class="sub muted">${esc(orgSettings().name)} SWMS · version July 2026 · tap a title to read the PDF. Signatures last 12 months. A signature due within 30 days asks you to sign again. ${esc(POWERED_BY)}.</p></div>`;
function swmsView() {
  return `<div class="sm-head"><h1>SWMS</h1></div>${swmsReminderHtml()}<h3 class="swh">My signatures</h3>${swmsList()}${me.role === "admin" ? swmsAdminHtml() : ""}`;
}
function swmsOverlay(jobId = "") {
  const v = incOverlay(`<h3>📋 SWMS</h3>${swmsList(jobId)}<div class="btns"><button type="button" class="mbtn ghost" data-x>Back</button></div>`);
  v.classList.add("swov"); v.dataset.job = jobId; v.querySelector("[data-x]").onclick = () => v.remove();
}
// ---- Admin: who signed what, expiry, who is overdue
function swmsAdminHtml() {
  const all = ui.allSigs || [];
  const people = [...new Map([...staff.filter(s => s.uid).map(s => [useEmulator && s.uid === ALEX_UID ? "ALEX_UID" : s.uid, s.name]), ...all.map(s => [s.uid, s.name])]).entries()];
  const cells = people.map(([uid, name]) => ({ uid, name, sts: SWMS.map(([id]) => swmsStatus(latestSig(all, uid, id))) }));
  const over = cells.filter(c => c.sts.some(s => s.k !== "ok" && s.k !== "due")).length, dueN = cells.filter(c => c.sts.some(s => s.k === "due")).length;
  const short = { "working-near-roads": "Roads", "mobile-plant": "Plant", "working-with-silica": "Silica", "hazardous-substances": "Haz subs", "electrical": "Electrical" };
  const rows = [...all].sort((a, b) => sigMs(b) - sigMs(a));
  const cards = `<div class="swpeople">${cells.map(c => `<article class="swperson"><b>${esc(c.name)}</b>${c.sts.map((s, i) => `<div class="swprow"><span>${short[SWMS[i][0]]}</span><span class="swpill ${s.cls}" data-swstatus="${s.k}" ${s.sig ? `data-swsig="${esc(s.sig.id)}"` : ""}>${esc(swFlag(s))}</span></div>`).join("")}</article>`).join("")}</div>`;
  return `<h3 class="swh">Team status <span class="swpill sw-exp">${over} overdue or missing</span> <span class="swpill sw-due">${dueN} due soon</span></h3>
  ${cards}
  <div class="swtablewrap team"><table class="swtable"><thead><tr><th>Worker</th>${SWMS.map(([id]) => `<th>${short[id]}</th>`).join("")}</tr></thead><tbody>
  ${cells.map(c => `<tr><td><b>${esc(c.name)}</b></td>${c.sts.map(s => `<td><span class="swpill ${s.cls}" data-swstatus="${s.k}" ${s.sig ? `data-swsig="${esc(s.sig.id)}"` : ""}>${esc(swFlag(s))}</span></td>`).join("")}</tr>`).join("")}
  </tbody></table></div>
  ${swmsDownloadHtml()}
  <h3 class="swh">All signatures <small class="muted">${rows.length}</small></h3>
  <div class="swtablewrap"><table class="swtable swlog"><thead><tr><th>Signed</th><th>Worker</th><th>SWMS</th><th>Job</th><th>Expires</th><th></th></tr></thead><tbody>
  ${rows.map(s => { const st = swmsStatus(s), cur = latestSig(all, s.uid, s.swmsId) === s;
    return `<tr class="${cur ? "" : "superseded"}"><td>${esc(swDT(sigMs(s)))}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.swmsTitle || s.swmsId)}<br><small class="muted">v${esc(s.version)}</small></td>
    <td>${s.jobLabel ? esc(s.jobLabel) : `<span class="muted">—</span>`}</td><td><span class="swpill ${cur ? st.cls : ""}">${esc(swD(sigExp(s)))}${cur ? "" : " (replaced)"}</span></td>
    <td class="swacts"><button type="button" class="swbtn" data-swsig="${esc(s.id)}">View signature</button><button type="button" class="swbtn" data-swdlsig="${esc(s.id)}" title="Signed PDF for this signer only">⬇ Download</button></td></tr>`; }).join("") || `<tr><td colspan="6" class="muted">No signatures yet.</td></tr>`}
  </tbody></table></div>`;
}
function sigDetail(id) {
  const s = (ui.allSigs || ui.mySigs || []).find(x => x.id === id) || (ui.mySigs || []).find(x => x.id === id); if (!s) return;
  const v = incOverlay(`<h3>✍ ${esc(s.swmsTitle || s.swmsId)}</h3>
    <div class="sigimg"><img src="${s.sig}" alt="Signature of ${esc(s.name)}"></div>
    <dl class="sigdl"><dt>Printed name</dt><dd>${esc(s.name)}</dd><dt>Signed</dt><dd>${esc(swDT(sigMs(s)))}</dd><dt>Expires</dt><dd>${esc(swD(sigExp(s)))}</dd>
    <dt>SWMS version</dt><dd>${esc(s.version)}</dd><dt>Job</dt><dd>${esc(s.jobLabel || "—")}</dd><dt>User ID</dt><dd><small>${esc(s.uid)}</small></dd></dl>
    <div class="btns"><button type="button" class="mbtn ghost" data-x>Close</button></div>`);
  v.querySelector("[data-x]").onclick = () => v.remove();
}
// ---- Sign flow: read (open PDF) -> tick -> optional job -> finger signature + printed name -> Sign
function signSwms(id, jobId) {
  const [, title, desc] = SWMS.find(x => x[0] === id);
  const opts = jobs.filter(j => j.status !== "Cancelled" && (j.assigned || []).includes(me.uid) && j.date >= addDays(todayStr(), -7) && j.date <= addDays(todayStr(), 14))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (jobId && !opts.some(j => j.id === jobId)) { const j = jobs.find(x => x.id === jobId); if (j) opts.unshift(j); }
  const jl = j => `#${jobNo(j)} · ${j.address || ""}`;
  const v = incOverlay(`<h3>✍ Sign SWMS</h3><div class="swsh"><b>${esc(title)}</b><small>${esc(desc)} · version July 2026</small></div>
    <div class="swstep"><span class="n">1</span><div><b>Read the SWMS</b><button type="button" class="swbtn wide" id="swread">📄 Open ${esc(title)} SWMS</button><iframe id="swframe" class="swframe" hidden title="SWMS document"></iframe><p class="swph" id="swph" hidden></p></div></div>
    <label class="swck"><input type="checkbox" id="swok"> <span>I have read and understood this SWMS and will follow it.</span></label>
    <div class="swstep"><span class="n">2</span><div><b>Job</b> <small class="muted">(optional)</small>
      <select id="swjob" class="swsel"><option value="">General – not for a particular job</option>${opts.map(j => `<option value="${j.id}" ${j.id === jobId ? "selected" : ""}>${esc(shortDate(j.date))} · ${esc(jl(j))}</option>`).join("")}</select></div></div>
    <div class="swstep"><span class="n">3</span><div><b>Sign with your finger</b>
      <div class="sigpad"><canvas id="swpad" aria-label="Signature"></canvas><span class="sigline">✕ Sign here</span><button type="button" class="sigclr" id="swclr">Clear</button></div>
      <label class="swname">Printed name<input id="swnm" autocomplete="name" value="${esc(me.name === "Alex" && me.uid === ALEX_UID ? "Alex Daly" : me.name || "")}"></label></div></div>
    <p class="err" id="swerr"></p>
    <div class="btns swfoot"><button type="button" class="mbtn ghost" data-x>Cancel</button><button type="button" class="mbtn complete" id="swgo" disabled>Sign SWMS</button></div>`, true);
  v.classList.add("swsignov");
  const c = v.querySelector("#swpad"), ctx = c.getContext("2d"), go = v.querySelector("#swgo");
  const fit = () => { const r = c.getBoundingClientRect(), k = window.devicePixelRatio || 1;
    if (r.width < 20) { if (!inked) requestAnimationFrame(fit); return; }
    if (inked) return;
    c.width = r.width * k; c.height = r.height * k; ctx.scale(k, k);
    ctx.lineWidth = 2.6; ctx.lineCap = ctx.lineJoin = "round"; ctx.strokeStyle = "#0b1f3a"; inked = 0; check(); };
  let inked = 0, last = null, opened = false;
  const check = () => { go.disabled = !(opened && v.querySelector("#swok").checked && inked > 8 && v.querySelector("#swnm").value.trim().length >= 2); };
  const pt = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.onpointerdown = e => { e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events and some phones */ } last = pt(e); ctx.beginPath(); ctx.arc(last[0], last[1], 1.2, 0, 7); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); inked++; };
  c.onpointermove = e => { if (!last) return; e.preventDefault(); const p = pt(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; inked++; v.classList.add("inked"); check(); };
  c.onpointerup = c.onpointercancel = () => { last = null; check(); };
  c.style.touchAction = "none";
  v.querySelector("#swclr").onclick = () => { ctx.clearRect(0, 0, c.width, c.height); inked = 0; v.classList.remove("inked"); check(); };
  v.querySelector("#swok").onchange = check; v.querySelector("#swnm").oninput = check;
  v.querySelector("#swread").onclick = async () => {
    const btn = v.querySelector("#swread");
    btn.disabled = true;
    try {
      await swmsBytes(id);
      const frame = v.querySelector("#swframe");
      frame.hidden = false;
      frame.src = swmsCache[id];
      opened = true;
      const note = v.querySelector("#swph");
      if (swmsPlaceholder[id] && note) { note.hidden = false; note.textContent = "The official PDF is not in the app. The page above is a placeholder, not the SWMS text."; }
      else toast("SWMS opened. Tick the box, then sign.");
      check();
    } catch (e) { v.querySelector("#swerr").textContent = "SWMS not available: " + (e.code || e.message); }
    finally { btn.disabled = false; }
  };
  v.querySelector("[data-x]").onclick = () => v.remove();
  requestAnimationFrame(fit);
  go.onclick = async () => {
    go.disabled = true; go.textContent = "Saving…";
    // small PNG: crop to ink, scale to max 360x120, 1-bit-ish dark ink on transparent -> usually 3-10 KB
    const out = document.createElement("canvas"), sc = Math.min(1, 360 / c.width, 120 / c.height);
    out.width = Math.round(c.width * sc); out.height = Math.round(c.height * sc);
    out.getContext("2d").drawImage(c, 0, 0, out.width, out.height);
    const sig = out.toDataURL("image/png");
    if (sig.length > 90000) { v.querySelector("#swerr").textContent = "Signature too large, please clear and sign again."; go.disabled = false; go.textContent = "Sign SWMS"; return; }
    const jid = v.querySelector("#swjob").value, j = jid && jobs.find(x => x.id === jid), now = swNow();
    const rec = { ...swmsSignatureData({ uid: me.uid, name: v.querySelector("#swnm").value, swmsId: id, swmsTitle: title, jobId: jid, jobLabel: j ? jl(j) : "", sig, now, device: navigator.userAgent }), signedAt: serverTimestamp() };
    try {
      const r = await addDoc(collection(db, "swmsSignatures"), rec);
      ui.mySigs = [...(ui.mySigs || []).filter(x => x.id !== r.id), { id: r.id, ...rec }];
      v.remove(); toast(`✔ Signed ${title} · valid to ${swD(rec.expiresAtMs)}`); swmsRefresh();
    } catch (e) { v.querySelector("#swerr").textContent = "Could not save: " + (e.code || e.message); go.disabled = false; go.textContent = "Sign SWMS"; }
  };
}
async function swmsChunkBytes(id) {
  try {
    const s = await getDocs(query(collection(db, "swmsChunks"), where("file", "==", id)));
    const parts = s.docs.map(d => d.data()).sort((a, b) => a.k - b.k);
    if (!parts.length || parts.some(p => typeof p.data !== "string" || !p.data)) return null;
    const bin = atob(parts.map(p => p.data).join("")), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    if (u8.length < 5 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4]) !== "%PDF-") return null;
    return u8;
  } catch { return null; }
}
async function swmsBytes(id) {          // official SWMS PDF, or a labelled placeholder when the PDF is not in swmsChunks
  if (!swmsBin[id]) {
    const got = await swmsChunkBytes(id);
    if (got) { swmsPlaceholder[id] = false; swmsBin[id] = got; }
    else {
      const known = SWMS.find(x => x[0] === id);
      swmsPlaceholder[id] = true;
      swmsBin[id] = await buildPlaceholderPdf(await loadPdfLib(), known ? known[1] : id, orgSettings());
    }
    swmsCache[id] = URL.createObjectURL(new Blob([swmsBin[id]], { type: "application/pdf" }));
  }
  return swmsBin[id];
}
async function openSwms(id) {
  const w = window.open("", "_blank");            // open now (inside the tap) so phones don't block the popup
  if (!w) { toast("Pop-up blocked. Allow pop-ups to read the SWMS, then sign."); return false; }
  try { w.document.write("<p style='font:16px sans-serif;padding:20px'>Loading SWMS…</p>"); } catch { /* already navigating */ }
  try {
    await swmsBytes(id);
    w.location.href = swmsCache[id];
    if (swmsPlaceholder[id]) toast("Official SWMS PDF is not in the app. That page is a placeholder, not the SWMS.");
    return true;
  } catch (e) { try { w.close(); } catch { /* */ } toast("SWMS not available: " + (e.code || e.message)); return false; }
}
// ---- Signed download (admins): original SWMS pages + a sign-off sheet, built in the browser with pdf-lib
// (vendor/pdf-lib.min.js, MIT, loaded on first use only — no CDN).
// Organisation legal name and ABN come from org settings. CallUp is the product line.
let pdfLibP = null;
const loadPdfLib = () => pdfLibP || (pdfLibP = new Promise((ok, no) => {
  if (window.PDFLib) return ok(window.PDFLib);
  const sc = document.createElement("script"); sc.src = new URL("vendor/pdf-lib.min.js", import.meta.url).href;
  sc.onload = () => ok(window.PDFLib); sc.onerror = () => { pdfLibP = null; no(new Error("PDF library failed to load")); }; document.head.appendChild(sc);
}));
const sigJobKey = s => s.jobId || s.jobLabel || "";
// current valid signature per worker for one SWMS (newest, right version, not expired); optional job filter
function validSigners(id, job = "") {
  const all = ui.allSigs || [], uids = [...new Set(all.filter(s => s.swmsId === id).map(s => s.uid))];
  return uids.map(u => latestSig(all, u, id)).filter(s => s && ["ok", "due"].includes(swmsStatus(s).k) && (!job || sigJobKey(s) === job))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
async function buildSignedSwmsPdf(id, sigs, jobLabel = "", single = false) {
  const L = await loadPdfLib(), { PDFDocument, StandardFonts, rgb } = L;
  const [, title, desc] = SWMS.find(x => x[0] === id);
  const out = await PDFDocument.create(), src = await PDFDocument.load(await swmsBytes(id), { ignoreEncryption: true });
  (await out.copyPages(src, src.getPageIndices())).forEach(pg => out.addPage(pg));
  const F = await out.embedFont(StandardFonts.Helvetica), B = await out.embedFont(StandardFonts.HelveticaBold);
  const T = x => String(x ?? "").replace(/[\u00a0\u202f\u2009]/g, " ").replace(/[^\x20-\x7e\u00a1-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022]/g, "?");
  const fit = (t, f, sz, w) => { t = T(t); while (t.length > 1 && f.widthOfTextAtSize(t, sz) > w) t = t.slice(0, -2) + "…"; return t; };
  const org = orgSettings();
  const W = 595.28, H = 841.89, M = 32, navy = rgb(0.043, 0.122, 0.227), grey = rgb(0.4, 0.42, 0.45), line = rgb(0.75, 0.77, 0.8), red = rgb(0.55, 0.08, 0.08);
  const cols = [[M, 100, "Name"], [M + 100, 118, "Signature"], [M + 218, 108, "Signed"], [M + 326, 128, "Job"], [M + 454, W - M - (M + 454), "Expires"]];
  const RH = 58, gen = swDT(swNow()), ph = !!swmsPlaceholder[id];
  let pg, y, n = 0;
  const head = () => {
    pg = out.addPage([W, H]); y = H - M; n++;
    pg.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: navy });
    pg.drawText(fit(org.legalName, B, 16, W * 0.62), { x: M, y: y - 14, size: 16, font: B, color: navy });
    pg.drawText("ABN " + org.abn, { x: M, y: y - 30, size: 9.5, font: F, color: grey });
    const r = "SWMS SIGN-OFF SHEET"; pg.drawText(r, { x: W - M - B.widthOfTextAtSize(r, 11), y: y - 14, size: 11, font: B, color: navy });
    const powered = POWERED_BY; pg.drawText(powered, { x: W - M - F.widthOfTextAtSize(powered, 8), y: y - 30, size: 8, font: F, color: grey });
    y -= 44; pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: navy }); y -= 22;
    pg.drawText(fit(title, B, 14, W - 2 * M), { x: M, y, size: 14, font: B }); y -= 16;
    pg.drawText(fit(`Safe Work Method Statement · ${desc} · Version ${SWMS_VERSION}`, F, 9.5, W - 2 * M), { x: M, y, size: 9.5, font: F, color: grey }); y -= 14;
    pg.drawText(fit((single ? "Individual sign-off: " + (sigs[0] && sigs[0].name) + (jobLabel ? " · " : "") : "") + (jobLabel ? "Job: " + jobLabel : single ? "" : "All current valid signatures (all jobs)"), F, 9.5, W - 2 * M), { x: M, y, size: 9.5, font: B }); y -= 14;
    pg.drawText(fit("Each person below has read and understood this SWMS and agreed to follow it. Signatures are valid 12 months from signing.", F, 8.5, W - 2 * M), { x: M, y, size: 8.5, font: F, color: grey }); y -= 14;
    if (ph) { pg.drawText(fit("PLACEHOLDER COVER: the official SWMS PDF is not in the app. Do not send this file to a client as the SWMS.", B, 8, W - 2 * M), { x: M, y, size: 8, font: B, color: red }); y -= 14; }
    y -= 4;
    pg.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: rgb(0.93, 0.94, 0.96) });
    cols.forEach(([x, , h]) => pg.drawText(h, { x: x + 5, y, size: 9, font: B, color: navy })); y -= 6;
  };
  head();
  if (!sigs.length) { y -= 24; pg.drawText("No current valid signatures.", { x: M + 5, y, size: 10, font: F, color: grey }); }
  for (const s of sigs) {
    if (y - RH < M + 30) head();
    const top = y; y -= RH;
    pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: line });
    const mid = y + RH / 2 - 4;
    pg.drawText(fit(s.name, B, 10, cols[0][1] - 10), { x: cols[0][0] + 5, y: mid, size: 10, font: B });
    try {
      const img = await out.embedPng(s.sig), sc = Math.min((cols[1][1] - 10) / img.width, (RH - 8) / img.height);
      pg.drawImage(img, { x: cols[1][0] + 5, y: y + (RH - img.height * sc) / 2, width: img.width * sc, height: img.height * sc });
    } catch (e) { pg.drawText("(signature image unavailable)", { x: cols[1][0] + 5, y: mid, size: 8, font: F, color: grey }); }
    pg.drawText(fit(swDT(sigMs(s)), F, 8, cols[2][1] - 8), { x: cols[2][0] + 4, y: mid, size: 8, font: F });
    pg.drawText(fit(s.jobLabel || "General", F, 8, cols[3][1] - 8), { x: cols[3][0] + 4, y: mid, size: 8, font: F });
    pg.drawText(fit(swD(sigExp(s)), F, 8, cols[4][1] - 8), { x: cols[4][0] + 4, y: mid, size: 8, font: F });
    void top;
  }
  const pages = out.getPages().slice(-n);
  pages.forEach((p, i) => { p.drawText(T(fit(`Generated ${gen} (Brisbane time) · ${POWERED_BY} · Sign-off page ${i + 1} of ${n}`, F, 8, W - 2 * M)), { x: M, y: M - 14, size: 8, font: F, color: grey }); });
  out.setTitle(`${title} SWMS – signed`); out.setAuthor(org.legalName); out.setCreator(PRODUCT_NAME);
  return out.save();
}
function signedFileName(id, job, one) {
  const t = SWMS.find(x => x[0] === id)[1], slug = x => String(x).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  return `SWMS_${slug(t)}_v${SWMS_VERSION}_signed${one ? "_" + slug(one) : job ? "_" + slug(job) : ""}_${ymd(new Date(swNow()))}.pdf`;
}
// Ready sheet: a fresh tap for Share (iPhone/iPad share sheet: Mail, Messages, Files…) / Download / Open.
function deliverPdf(bytes, name, placeholder = false) {
  const blob = new Blob([bytes], { type: "application/pdf" }), url = URL.createObjectURL(blob);
  const file = typeof File === "function" ? new File([blob], name, { type: "application/pdf" }) : null;
  const canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  const v = incOverlay(`<h3>📄 Signed SWMS ready</h3><p class="sub">${esc(name)}<br><small class="muted">${Math.round(bytes.length / 1024)} KB</small></p>
    ${placeholder ? `<p class="swph">Placeholder cover only. The official SWMS PDF is not in the app, so do not send this file to a client as the SWMS.</p>` : ""}
    <div class="btns swdlbtns">${canShare ? `<button type="button" class="mbtn complete" id="swshare">Share / Save…</button>` : ""}
    <a class="mbtn ${canShare ? "" : "complete"}" id="swdl" href="${url}" download="${esc(name)}">⬇ Download</a>
    <a class="mbtn ghost" href="${url}" target="_blank" rel="noopener">Open</a><button type="button" class="mbtn ghost" data-x>Close</button></div>`);
  v.classList.add("swdlov"); window.HW_LAST_PDF = { url, name, size: bytes.length, placeholder };
  v.querySelector("[data-x]").onclick = () => { v.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); };
  const sh = v.querySelector("#swshare");
  if (sh) sh.onclick = () => navigator.share({ files: [file], title: name }).catch(e => { if (e.name !== "AbortError") toast("Share failed: " + e.message); });
}
async function downloadSigned(id, job = "", sigId = "") {
  if (!me || me.role !== "admin") return;
  const all = ui.allSigs || [];
  const one = sigId && all.find(x => x.id === sigId);
  const sigs = one ? [one] : validSigners(id || "", job), sid = one ? one.swmsId : id;
  const jobLabel = one ? (one.jobLabel || "") : job ? ((all.find(s => sigJobKey(s) === job) || {}).jobLabel || job) : "";
  if (!one && !sigs.length) return toast("No current valid signatures" + (job ? " for that job" : "") + ".");
  toast("Building signed PDF…");
  try { const bytes = await buildSignedSwmsPdf(sid, sigs, jobLabel, !!one); deliverPdf(bytes, signedFileName(sid, jobLabel, one && one.name), !!swmsPlaceholder[sid]); }
  catch (e) { console.warn(e); toast("Could not build PDF: " + (e.code || e.message)); }
}
function swmsDownloadHtml() {
  return `<h3 class="swh">Signed downloads <small class="muted">for clients · SWMS + sign-off sheet</small></h3><div class="swdl">
  ${SWMS.map(([id, t]) => { const v = validSigners(id), jobsM = new Map(v.filter(s => sigJobKey(s)).map(s => [sigJobKey(s), s.jobLabel || sigJobKey(s)]));
    return `<div class="swdlrow"><div class="swdlt"><b>${esc(t)}</b><small class="muted">${v.length} current valid signer${v.length === 1 ? "" : "s"}</small></div>
    <select class="swdljob" data-for="${id}" aria-label="Job filter for ${esc(t)}"><option value="">All current valid signatures</option>${[...jobsM].map(([k, l]) => `<option value="${esc(k)}">Job: ${esc(l)}</option>`).join("")}</select>
    <button type="button" class="swbtn primary" data-swdl="${id}" ${v.length ? "" : "disabled"}>⬇ Download signed PDF</button></div>`; }).join("")}</div>`;
}
document.addEventListener("click", e => {
  const a = e.target.closest("[data-swms]"); if (a) { e.preventDefault(); e.stopPropagation(); return swmsOverlay(a.dataset.swms || ""); }
  const sg = e.target.closest("[data-swsign]"); if (sg) { e.preventDefault(); e.stopPropagation(); return signSwms(sg.dataset.swsign, sg.dataset.job || ""); }
  const sv = e.target.closest("[data-swsig]"); if (sv) { e.preventDefault(); e.stopPropagation(); return sigDetail(sv.dataset.swsig); }
  const dl = e.target.closest("[data-swdl]"); if (dl) { e.preventDefault(); e.stopPropagation(); const sel = document.querySelector(`.swdljob[data-for="${dl.dataset.swdl}"]`); return downloadSigned(dl.dataset.swdl, sel ? sel.value : ""); }
  const d1 = e.target.closest("[data-swdlsig]"); if (d1) { e.preventDefault(); e.stopPropagation(); return downloadSigned("", "", d1.dataset.swdlsig); }
  const f = e.target.closest("[data-swmsf]"); if (f) { e.preventDefault(); openSwms(f.dataset.swmsf); }
}, true);

// ---- Global job search (header): lot, street, PO, job number, client. Admin searches every job; staff only their own.
(function gsearch() {
  const box = $("#gsw"), q = $("#gq"), res = $("#gres"); if (!box) return;
  const norm = x => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const pool = () => { const seen = new Set(), adm = me && me.role === "admin";
    return [...jobs, ...(ui.undated || []), ...(ui.done || [])].filter(j => !seen.has(j.id) && seen.add(j.id) && (adm || (j.assigned || []).includes(me?.uid))); };
  const run = () => { const t = norm(q.value); if (!t) { res.classList.add("hidden"); return; }
    const toks = t.split(" ");
    const hits = pool().map(j => { const hay = " " + norm([jobNo(j), j.sm8JobNo, j.po, j.address, j.client].join(" ")) + " ";
      const ok = toks.every(k => hay.includes(k)); if (!ok) return null;
      const exact = norm(jobNo(j)) === t || norm(j.po) === t; return [exact ? 0 : 1, j]; }).filter(Boolean)
      .sort((a, b) => a[0] - b[0] || String(b[1].date || "").localeCompare(String(a[1].date || ""))).slice(0, 12).map(x => x[1]);
    res.innerHTML = hits.map(j => `<button type="button" class="gr" data-gid="${j.id}"><span class="gr-a">${esc(j.address || "-")}</span>
      <span class="gr-m">#${esc(jobNo(j))} · ${esc(j.client || "")}${j.po ? " · PO " + esc(j.po) : ""} · ${esc(j.date ? shortDate(j.date) : "Unscheduled")}${j.status === "In progress" ? " · in progress" : ""}</span>${j.status === "Done" ? `<span class="gr-done">✔ Completed</span>` : ""}</button>`).join("")
      || `<div class="gr none">No jobs match “${esc(q.value)}”</div>`;
    res.classList.remove("hidden"); };
  q.addEventListener("input", run); q.addEventListener("focus", run);
  q.addEventListener("keydown", e => { if (e.key === "Escape") { q.value = ""; run(); q.blur(); } if (e.key === "Enter") res.querySelector(".gr[data-gid]")?.click(); });
  document.addEventListener("click", e => { if (!box.contains(e.target)) res.classList.add("hidden"); });
  res.addEventListener("click", e => { const b = e.target.closest("[data-gid]"); if (!b) return; const j = pool().find(x => x.id === b.dataset.gid); if (!j) return;
    res.classList.add("hidden"); q.blur();
    if (me.role === "admin" && !ui.myJobs) editJob(j); else { ui.opSel = j.id; renderOperator(); window.scrollTo(0, 0); } });
  setInterval(() => box.classList.toggle("hidden", !me), 1000);
})();

CHAT = installChatApp({ db, storage, getMe: () => me, toast });
COMP = installCompliance({
  db, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp,
  getJobs: () => [...(jobs || []), ...(ui.undated || []), ...(ui.done || [])],
  getMe: () => me, getUi: () => ui, today: todayStr, toast,
  canSeeMoney,
  rerenderAdmin: () => { if (me && me.role === "admin") { ui.forceRender = true; renderAdmin(); } },
  rerenderOperator: () => { ui.forceRender = true; renderOperator(); },
});
// ---- Guided Quotes (CallUp, Nov 2026). Rates in meta/quoteRates — never invented. No GPS in this build.
async function loadRunSheets(date) {
  ui.runSheets = ui.runSheets || {};
  await Promise.all(staff.filter(s => s && s.uid).map(async s => {
    const id = runSheetId(s.uid, date);
    if (!id) return;
    try {
      const snap = await getDoc(doc(db, "runSheets", id));
      ui.runSheets[id] = snapExists(snap) ? { id, ...snap.data() } : false;
    } catch { ui.runSheets[id] = false; }
  }));
}
ROUTE = installRouteOrder({
  db, doc, setDoc, updateDoc, serverTimestamp,
  todayStr, toast,
  getMe: () => me,
  getStaff: () => staff,
  getJobs: () => [...jobs, ...(ui.undated || [])],
  peekSheet: (uid, date) => {
    const id = runSheetId(uid, date);
    const sheet = (ui.runSheets || {})[id];
    return sheet && sheet.status === "approved" ? sheet : null;
  },
  loadSheets: loadRunSheets,
  rememberSheet: (id, data) => {
    ui.runSheets = ui.runSheets || {};
    ui.runSheets[id] = { id, ...data, status: "approved" };
  },
  cacheGeo: (job, hit) => updateDoc(doc(db, "jobs", job.id), geoPatch(job.address, hit)),
});
QG = installQuotes({
  db, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot, serverTimestamp, arrayUnion,
  $, esc, toast, $$, CLIENTS, TYPES, canSeeMoney, canQuote, canEditQuoteRates, todayStr, jobNo,
  getMe: () => me, getUi: () => ui,
  isAdmin: () => !!(me && me.role === "admin"),
  renderAdmin: () => (me && me.role === "admin" ? renderAdmin() : renderOperator()),
  get staff() { return staff; }
});
window.HW_QUOTES = QG; // preview / tests
