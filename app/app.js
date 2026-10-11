// Heartwood Jobs — Phase 1. Plain ES modules + Firebase modular SDK from the CDN. No build step.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, connectAuthEmulator }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, getDoc, getDocs, query, where, orderBy, onSnapshot, addDoc, updateDoc, serverTimestamp, arrayUnion, runTransaction }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, useEmulator } from "./firebase-config.js";

const cfg = useEmulator ? { ...firebaseConfig, apiKey: "demo-key", projectId: "demo-heartwood" } : firebaseConfig;
const fb = initializeApp(cfg);
const auth = getAuth(fb);
// Offline cache: jobs already loaded stay readable and writes queue until the phone is back online.
const db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
if (useEmulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
if ("serviceWorker" in navigator && !useEmulator) navigator.serviceWorker.register("sw.js", { scope: "./" });

// ------------------------------------------------------------------ constants / helpers
export const CLIENTS = ["Orbit Homes (Qld) Pty Ltd", "Torsion Built Pty Ltd", "Silkwood Homes", "OJ Pippin Homes", "Envision Homes", "Private"];
const TYPES = { spoil: "Spoil removal", backslab: "Backslab", clean: "Site clean", other: "Other" };
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
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add("hidden"), 2500); }
function guessType(text) {
  const t = (text || "").toLowerCase();
  const keys = [["slab back blade", "backslab"], ["slab clean", "backslab"], ["back slab", "backslab"], ["backslab", "backslab"], ["spoil", "spoil"], ["clean", "clean"]];
  const hits = keys.filter(([k]) => t.includes(k)).map(([k, v]) => [t.indexOf(k), -k.length, v]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return hits.length ? hits[0][2] : "other";
}

let me = null, staff = [], jobs = [], unsub = null;
const ui = { view: "list", staffF: "", typeF: "" };

// ------------------------------------------------------------------ auth
$("#logout").onclick = () => signOut(auth);
onAuthStateChanged(auth, async user => {
  if (unsub) { unsub(); unsub = null; }
  if (!user) { me = null; $("#who").textContent = ""; $("#logout").classList.add("hidden"); return renderLogin(); }
  // Admin = UID listed in firestore.rules (no role doc needed): detected by being allowed to list users.
  // Operator = users/{uid} doc with role "operator".
  const snap = await getDoc(doc(db, "users", user.uid)).catch(() => null);
  const prof = snap && snap.exists() ? snap.data() : null;
  let users = null;
  if (!prof || prof.role !== "operator") users = await getDocs(collection(db, "users")).catch(() => null);
  if (!prof && !users) { $("#app").innerHTML = `<p class="pad">No access for ${esc(user.email)}. Ask Alex to add you.</p>`; return; }
  me = users ? { uid: user.uid, name: (prof && prof.name) || "Alex", role: "admin" } : { uid: user.uid, ...prof };
  $("#who").textContent = `${me.name} · ${me.role}`; $("#logout").classList.remove("hidden");
  if (me.role === "admin") {
    const logins = users.docs.map(d => ({ uid: d.id, ...d.data() })).filter(u => u.role === "operator");
    staff = [{ uid: me.uid, name: me.name }, ...logins];
    // two weeks back (catch overdue work) to 4 weeks ahead, plus anything undated
    const q = query(collection(db, "jobs"), where("date", ">=", addDays(todayStr(), -14)), where("date", "<=", addDays(todayStr(), 28)), orderBy("date"));
    const u1 = onSnapshot(q, s => { jobs = s.docs.map(d => ({ id: d.id, ...d.data() })); addNameOnlyStaff(jobs); renderAdmin(); });
    // Invoicing: every Done job (any date), admin only.
    const u2 = onSnapshot(query(collection(db, "jobs"), where("status", "==", "Done")), s => { ui.done = s.docs.map(d => ({ id: d.id, ...d.data() })); if (ui.view === "invoices" || ui.view === "completed") renderAdmin(); });
    unsub = () => { u1(); u2(); };
    getDocs(query(collection(db, "jobs"), where("date", "==", ""))).then(s => { ui.undated = s.docs.map(d => ({ id: d.id, ...d.data() })); addNameOnlyStaff(ui.undated); renderAdmin(); });
  } else {
    // Operators may only list jobs assigned to them (enforced by firestore.rules).
    const q = query(collection(db, "jobs"), where("assigned", "array-contains", user.uid));
    unsub = onSnapshot(q, s => { jobs = s.docs.map(d => ({ id: d.id, ...d.data() })); renderOperator(); });
  }
});

function renderLogin() {
  $("#app").innerHTML = `<form id="login" class="card login">
    <h2>Sign in</h2>
    <label>Email<input name="e" type="email" autocomplete="username" required></label>
    <label>Password<input name="p" type="password" autocomplete="current-password" required></label>
    <button class="big primary">Sign in</button><p id="lerr" class="err"></p></form>`;
  $("#login").onsubmit = async ev => {
    ev.preventDefault(); const f = ev.target;
    try { await signInWithEmailAndPassword(auth, f.e.value.trim(), f.p.value); }
    catch (e) { $("#lerr").textContent = "Sign-in failed: " + (e.code || e.message); }
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
  if (j.sm8Status === "Quote") return "Quote";
  return "Work Order";
}
const jobNo = j => j.sm8JobNo ? j.sm8JobNo : "HW-" + String(j.id || "").slice(-4).toUpperCase();
const firstLine = s => String(s || "").split(/\n|\. /)[0];
const shortDate = s => s ? new Date(s + "T00:00:00Z").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "Unscheduled";
const NAV = [["dispatch", "▦", "Dispatch Board"], ["jobs", "☰", "Jobs"], ["unscheduled", "◷", "Unscheduled"], ["completed", "✔", "Completed"], ["clients", "👤", "Clients", 1], ["inbox", "✉", "Inbox", 1],
  ["invoices", "$", "Invoices"], ["reports", "📈", "Reports", 1], ["settings", "⚙", "Settings", 1]];
ui.view = "jobs"; ui.queue = "All"; ui.dview = "week"; ui.wk = 0; ui.q = "";
const PHONE = matchMedia("(max-width:760px)");
PHONE.addEventListener?.("change", () => { if (me && me.role === "admin") renderAdmin(); });
function shell(inner) {
  const cur = NAV.find(n => n[0] === ui.view);
  return `<div class="sm-layout ${ui.navOpen ? "navopen" : ""}"><div class="sm-burgerbar"><button class="sm-burger" id="burger" aria-label="Menu">☰</button><b>${esc(cur ? cur[2] : "")}</b></div>
    <nav class="sm-side">${NAV.map(([k, ic, n, soon]) =>
    `<button class="sm-nav ${ui.view === k ? "on" : ""} ${soon ? "soon" : ""}" ${soon ? "disabled title=\"Not built yet\"" : `data-view="${k}"`}><span class="ic">${ic}</span><span>${n}</span></button>`).join("")}</nav>
    <section class="sm-main">${inner}</section></div>`;
}
function jobRow(j) {
  const q = queueOf(j), names = namesOf(j).map(label).join(", ");
  return `<tr class="jr" data-id="${j.id}" draggable="true"><td><span class="qdot ${QCLS[q]}" title="${q}"></span></td>
    <td class="jn">#${esc(jobNo(j))}</td><td><b>${esc(j.client || "")}</b><div class="sub">${esc(j.address || "-")}</div></td>
    <td>${esc(firstLine(j.description))}<div class="sub">${esc(TYPES[j.type] || "")}${j.po ? " · PO " + esc(j.po) : ""}</div></td>
    <td>${esc(shortDate(j.date))}<div class="sub">${esc(j.time || "")}${j.durationHrs ? " · " + esc(j.durationHrs) + "h" : ""}</div></td>
    <td>${names ? esc(names) : `<span class="unal">Unallocated</span>`}</td>
    <td><span class="qpill ${QCLS[q]}">${q}</span>${j.status === "In progress" ? `<div class="sub inprog">In progress</div>` : ""}</td></tr>`;
}
function groupByDate(list) {
  const m = new Map(); for (const j of list) { const k = j.date || ""; if (!m.has(k)) m.set(k, []); m.get(k).push(j); }
  return [...m.entries()];
}
function jobsView(all) {
  const t = ui.q.toLowerCase();
  const fs = all.filter(j => (!t || [jobNo(j), j.client, j.address, j.description, j.po, namesOf(j).join(" ")].join(" ").toLowerCase().includes(t)));
  const open = fs.filter(j => j.date && QUEUES.includes(queueOf(j)));      // unscheduled jobs have their own screen
  if (!QUEUES.includes(ui.queue)) ui.queue = "All";
  const cnt = q => open.filter(j => queueOf(j) === q).length;
  const list = open.filter(j => ui.queue === "All" || queueOf(j) === ui.queue)
    .sort((a, b) => ((a.date || "9") + (a.time || "")).localeCompare((b.date || "9") + (b.time || "")));
  return `<div class="sm-head"><h1>Jobs</h1><button id="new" class="sm-btn primary">+ New Job</button></div>
    <div class="qtabs"><button data-q="All" class="${ui.queue === "All" ? "on" : ""}">All open <span>${open.length}</span></button>
      ${QUEUES.map(q => `<button data-q="${q}" class="${QCLS[q]} ${ui.queue === q ? "on" : ""}"><span class="qdot ${QCLS[q]}"></span>${q} <span>${cnt(q)}</span></button>`).join("")}</div>
    <div class="filters"><select id="fs"><option value="">All staff</option>${staff.map(s => `<option value="${esc(skey(s))}" ${ui.staffF === skey(s) ? "selected" : ""}>${esc(label(s.name))}</option>`).join("")}<option value="_none" ${ui.staffF === "_none" ? "selected" : ""}>Unallocated</option></select>
      <select id="ft"><option value="">All categories</option>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${ui.typeF === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <span class="muted sub">Showing 2 weeks back to 4 weeks ahead (unscheduled jobs: see Unscheduled)</span></div>
    <table class="jt"><thead><tr><th></th><th>Job #</th><th>Client / Site</th><th>Description</th><th>Scheduled</th><th>Staff</th><th>Status</th></tr></thead>
    <tbody>${groupByDate(list).map(([d, js]) => `<tr class="dayhdr"><td colspan="7">${esc(d ? dayLabel(d) : "Unscheduled")} <span class="cnt">${js.length}</span></td></tr>${js.map(jobRow).join("")}`).join("") || `<tr><td colspan="7" class="muted pad">No jobs in this queue</td></tr>`}</tbody></table>`;
}
// Unscheduled screen: open jobs with no booking date, newest first. "Schedule" opens the job card on the date field.
// (Jobs created in ServiceM8 more than 90 days ago are not imported at all, see tools/sm8_import.py.)
const createdOf = j => j.sm8Created || (j.createdAt && j.createdAt.toDate ? ymd(j.createdAt.toDate()) : "");
function unscheduledView(all) {
  const t = ui.q.toLowerCase();
  const list = all.filter(j => !j.date && QUEUES.includes(queueOf(j)) && (!ui.typeF || j.type === ui.typeF)
      && (!t || [jobNo(j), j.client, j.address, j.description, j.po].join(" ").toLowerCase().includes(t)))
    .sort((a, b) => createdOf(b).localeCompare(createdOf(a)) || String(b.sm8JobNo || "").localeCompare(String(a.sm8JobNo || ""), undefined, { numeric: true }));
  return `<div class="sm-head"><h1>Unscheduled jobs <span class="cnt">${list.length}</span></h1><button id="new" class="sm-btn primary">+ New Job</button></div>
    <p class="sub muted">Open jobs with no booking date, newest first. Jobs created in ServiceM8 more than 3 months ago are not shown.</p>
    <table class="jt"><thead><tr><th></th><th>Job #</th><th>Client / Site</th><th>Description</th><th>PO</th><th>Created</th><th></th></tr></thead>
    <tbody>${list.map(j => `<tr class="jr" data-id="${j.id}"><td><span class="qdot ${QCLS[queueOf(j)]}"></span></td><td class="jn">#${esc(jobNo(j))}</td>
      <td><b>${esc(j.client || "")}</b><div class="sub">${esc(j.address || "-")}</div></td><td>${esc(firstLine(j.description))}<div class="sub">${esc(TYPES[j.type] || "")}</div></td>
      <td>${esc(j.po || "—")}</td><td>${createdOf(j) ? esc(shortDate(createdOf(j))) : "—"}</td>
      <td><button type="button" class="sm-btn primary" data-sched="${j.id}">Schedule</button></td></tr>`).join("") || `<tr><td colspan="7" class="muted pad">Nothing unscheduled – nice.</td></tr>`}</tbody></table>`;
}
// Completed screen: Completed (default) or Unsuccessful, newest first, grouped by day. Uses the 6-week window plus
// every Done job (ui.done, any date) so older completions are still listed.
function completedView(all) {
  const kind = ui.cq === "Unsuccessful" ? "Unsuccessful" : "Completed", t = ui.q.toLowerCase();
  const m = new Map(); for (const j of [...all, ...(ui.done || [])]) if (!m.has(j.id)) m.set(j.id, j);
  const pool = [...m.values()].filter(j => (!ui.typeF || j.type === ui.typeF) && (!t || [jobNo(j), j.client, j.address, j.description, j.po].join(" ").toLowerCase().includes(t)));
  const cnt = k => pool.filter(j => queueOf(j) === k).length;
  const list = pool.filter(j => queueOf(j) === kind).sort((a, b) => ((b.date || "") + (b.time || "")).localeCompare((a.date || "") + (a.time || "")));
  return `<div class="sm-head"><h1>${kind} jobs</h1></div>
    <div class="qtabs">${["Completed", "Unsuccessful"].map(k => `<button data-cq="${k}" class="${QCLS[k]} ${kind === k ? "on" : ""}"><span class="qdot ${QCLS[k]}"></span>${k} <span>${cnt(k)}</span></button>`).join("")}</div>
    <table class="jt"><thead><tr><th></th><th>Job #</th><th>Client / Site</th><th>Description</th><th>Scheduled</th><th>Staff</th><th>Status</th></tr></thead>
    <tbody>${groupByDate(list).map(([d, js]) => `<tr class="dayhdr"><td colspan="7">${esc(d ? dayLabel(d) : "No date")} <span class="cnt">${js.length}</span></td></tr>${js.map(jobRow).join("")}`).join("") || `<tr><td colspan="7" class="muted pad">No ${kind.toLowerCase()} jobs</td></tr>`}</tbody></table>`;
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
  const chip = j => `<div class="dchip ${QCLS[queueOf(j)]} t-${j.type} ${j.status === "In progress" ? "inprog" : ""}" draggable="true" data-id="${j.id}" title="${esc(j.client)} – ${esc(j.description)}">
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
      <button id="new" class="sm-btn primary">+ New Job</button></div>
    <div class="dwrap"><div class="dboard">${grid}<p class="sub muted">Drag a job to another day or staff member to reschedule (saved in the app, sent to ServiceM8 by the next sync).</p></div>
      </div>`;
}
function renderAdmin() {
  if (!me || me.role !== "admin") return;
  if ($("#dlg").open) return;          // don't redraw under an open job card
  document.body.className = "admin";
  const fj = filtered(), und = (ui.undated || []).filter(j => (!ui.typeF || j.type === ui.typeF));
  const all = [...fj, ...und.filter(u => !fj.some(j => j.id === u.id))];
  $("#app").innerHTML = shell(ui.view === "dispatch" ? dispatchView(all) : ui.view === "invoices" ? invoicesView() : ui.view === "completed" ? completedView(all) : ui.view === "unscheduled" ? unscheduledView(all) : jobsView(all));
  const A = $("#app");
  if (ui.view === "invoices") bindInvoices(A);
  A.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { ui.view = b.dataset.view; ui.navOpen = false; renderAdmin(); });
  if ($("#burger")) $("#burger").onclick = () => { ui.navOpen = !ui.navOpen; renderAdmin(); };
  if (ui.view === "dispatch" && PHONE.matches) bindMobileDispatch(A, [...jobs, ...(ui.undated || [])]);
  A.querySelectorAll("[data-cq]").forEach(b => b.onclick = () => { ui.cq = b.dataset.cq; renderAdmin(); });
  A.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { ui.queue = b.dataset.q; renderAdmin(); });
  A.querySelectorAll("[data-dv]").forEach(b => b.onclick = () => { ui.dview = b.dataset.dv; ui.wk = 0; renderAdmin(); });
  A.querySelectorAll("[data-wk]").forEach(b => b.onclick = () => { ui.wk = +b.dataset.wk === 0 ? 0 : ui.wk + +b.dataset.wk; renderAdmin(); });
  if ($("#fs")) $("#fs").onchange = e => { ui.staffF = e.target.value; renderAdmin(); };
  if ($("#ft")) $("#ft").onchange = e => { ui.typeF = e.target.value; renderAdmin(); };
  if ($("#new")) $("#new").onclick = () => editJob(null);
  A.querySelectorAll("[data-sched]").forEach(b => b.onclick = ev => { ev.stopPropagation();
    const j = [...jobs, ...(ui.undated || [])].find(x => x.id === b.dataset.sched); if (!j) return;
    editJob(j); const f = $("#jf"); if (f) { f.date.value = todayStr(); f.date.focus(); f.date.showPicker?.(); } });
  const pool = [...jobs, ...(ui.undated || [])];
  A.querySelectorAll("[data-id]").forEach(el => {
    el.onclick = ev => { if (ev.target.closest("input,button,label,textarea")) return; editJob(pool.find(j => j.id === el.dataset.id) || (ui.done || []).find(j => j.id === el.dataset.id)); };
    el.ondragstart = ev => { ev.dataTransfer.setData("text/plain", el.dataset.id + "|" + (el.closest("[data-staff]")?.dataset.staff || "")); el.classList.add("dragging"); };
    el.ondragend = () => el.classList.remove("dragging");
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
async function moveJob(j, date) {
  await updateDoc(doc(db, "jobs", j.id), { date, editedInApp: true, updatedAt: serverTimestamp(), updatedBy: me.uid });
  if (ui.undated) ui.undated = ui.undated.filter(x => x.id !== j.id);
  toast(`Moved to ${dayLabel(date)}`);
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
    <div class="jc-top ${QCLS[qq]}"><div><div class="jc-no">${n ? "New Job" : "Job #" + esc(jobNo(j))}</div><div class="jc-q">${qq}${j.sm8Status === "Quote" ? " (quote in ServiceM8)" : ""}</div></div>
      <label class="jc-st">Job Status<select name="status">${STATUSES.map(s => `<option value="${s}" ${j.status === s ? "selected" : ""}>${SL[s]}</option>`).join("")}</select></label>
      <button value="cancel" formnovalidate class="jc-x" title="Close">✕</button></div>
    <div class="jc-body"><div class="jc-col">
      <h4>Client &amp; Site</h4>
      <label>Client<input name="client" list="clients" value="${esc(j.client)}" required><datalist id="clients">${CLIENTS.map(c => `<option value="${esc(c)}">`).join("")}</datalist></label>
      <label>Job (site) address<input name="address" value="${esc(j.address)}" required></label>
      ${j.address ? `<a class="sub" href="${mapsUrl(j.address)}" target="_blank" rel="noopener">📍 Open in Maps</a>` : ""}
      <h4>Job Description</h4>
      <textarea name="description" rows="4">${esc(j.description)}</textarea>
      <p class="hint">Spoil removal is always its own job — never add spoil to a backslab job.</p>
      <div class="row"><label>Category<select name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${j.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>Purchase Order #<input name="po" value="${esc(j.po)}"></label>
        <label>Loads<input type="number" min="0" name="loads" value="${esc(j.loads ?? "")}"></label></div>
    </div><div class="jc-col">
      <h4>Staff Allocation &amp; Schedule</h4>
      <div class="row"><label>Date<input type="date" name="date" value="${esc(j.date)}"></label>
        <label>Start<input type="time" name="time" value="${esc(j.time)}"></label>
        <label>Hours<input type="number" step="0.5" min="0" name="durationHrs" value="${esc(j.durationHrs)}"></label></div>
      <fieldset class="staffs">${staff.map(s => `<label class="ck"><input type="checkbox" name="assigned" value="${esc(skey(s))}" ${namesOf(j).map(x => x.toLowerCase()).includes(s.name.toLowerCase()) ? "checked" : ""}> <span class="av">${esc(s.name[0])}</span>${esc(label(s.name))}</label>`).join("")}</fieldset>
      <h4>Notes</h4>
      <textarea name="notes" rows="2" placeholder="Office notes">${esc(j.notes)}</textarea>
      <h4>Diary</h4>
      <div class="diary">${(j.log || []).map(l => `<div class="de"><span class="av">${esc((l.byName || "?")[0])}</span><div><small>${esc(l.byName)} · ${esc(l.at)}</small><div>${esc(l.text)}</div></div></div>`).join("")}
        ${hist.map(([w, t]) => `<div class="de sys"><span class="av">i</span><div><small>${esc(w)}</small><div>${esc(t)}</div></div></div>`).join("")}
        ${!(j.log || []).length && !hist.length ? `<p class="muted sub">No diary entries yet. Site notes from staff appear here.</p>` : ""}</div>
      ${!n ? `<h4>Photos</h4><button type="button" class="sm-btn" id="emailph">📧 Email photos</button> <span class="sub muted">Photos go to ${OFFICE_EMAIL} by email</span>` : ""}
    </div></div>
    <p id="ferr" class="err"></p>
    <div class="btns jc-foot"><button value="cancel" formnovalidate class="sm-btn">Close</button><button value="save" class="sm-btn primary">Save Job</button></div></form>`;
  d.showModal();
  if (!n) $("#emailph").onclick = () => emailPhotos(j);
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
      loads: f.loads.value === "" ? null : +f.loads.value, editedInApp: true, updatedAt: serverTimestamp(), updatedBy: me.uid };
    if (data.status === "Done" && j.status !== "Done") Object.assign(data, { completedAt: serverTimestamp(), completedBy: me.uid });
    try {
      if (n) await addDoc(collection(db, "jobs"), { ...data, source: "app", log: [], createdAt: serverTimestamp() });
      else await updateDoc(doc(db, "jobs", j.id), data);
      d.close(); toast("Saved"); renderAdmin(); if (!data.date) location.reload();
    } catch (e) { $("#ferr").textContent = e.message; }
  };
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
const invAmountDefault = j => (j.invoiceAmount ?? null);
const xd = s => { const [y, m, d] = s.split("-"); return `${+d}/${m}/${y}`; };     // d/mm/yyyy like hwdata.d_fmt
const csvCell = v => { v = String(v ?? ""); return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
function xeroCsv(list) {
  const rows = list.map(j => { const d = j.invoiceDate || j.date;
    return [invContact(j), "", "", j.invoiceNo, isRealPo(j.po) ? j.po : "", xd(d), xd(addDays(d, 7)), "",
      j.invoiceDescription || invDescDefault(j), "1", Number(j.invoiceAmount).toFixed(2), "", "200", "GST on Income", "AUD"]; });
  return [XERO_COLS, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
function downloadCsv(list) {
  const ns = list.map(j => +j.invoiceNo).filter(Boolean).sort((a, b) => a - b);
  const name = `xero import ${ns.length > 1 ? ns[0] + "-" + ns[ns.length - 1] : ns[0]}.csv`;
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([xeroCsv(list)], { type: "text/csv" })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); window.HW_LAST_CSV = { name, text: xeroCsv(list) };
  toast("Downloaded " + name);
}
ui.inv = "ready"; ui.invSel = new Set();
function invoicesView() {
  const done = (ui.done || []).filter(j => j.status === "Done");
  const ready = done.filter(j => !j.invoiceNo).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const numbered = done.filter(j => j.invoiceNo && !j.invoiced).sort((a, b) => +a.invoiceNo - +b.invoiceNo);
  const since = addDays(todayStr(), -30);
  const recent = done.filter(j => j.invoiceNo && j.invoiced && (j.invoiceDate || j.date || "") >= since).sort((a, b) => +b.invoiceNo - +a.invoiceNo);
  const list = { ready, numbered, recent }[ui.inv];
  const sel = list.filter(j => ui.invSel.has(j.id));
  const tot = a => a.reduce((t, j) => t + (+j.invoiceAmount || 0), 0);
  const money = v => v == null || v === "" ? "" : "$" + Number(v).toLocaleString("en-AU", { minimumFractionDigits: 2 });
  const tab = (k, n, a) => `<button data-inv="${k}" class="${ui.inv === k ? "on" : ""}">${n} <span>${a.length}</span></button>`;
  const head = ui.inv === "ready" ? `<th></th><th>Date</th><th>Client / Site</th><th>PO</th><th>Invoice description</th><th>Amount (ex GST)</th>`
    : `<th></th><th>Invoice #</th><th>Date</th><th>Contact</th><th>Reference</th><th>Description</th><th>Amount (ex GST)</th>${ui.inv === "recent" ? "<th>Marked</th>" : ""}`;
  const row = j => ui.inv === "ready"
    ? `<tr class="jr" data-id="${j.id}"><td><input type="checkbox" class="isel" ${ui.invSel.has(j.id) ? "checked" : ""}></td>
        <td>${esc(shortDate(j.date))}<div class="sub">#${esc(jobNo(j))}</div></td>
        <td><b>${esc(invContact(j))}</b>${STD_CLIENTS.includes(invContact(j)) || / \(private\)$/.test(invContact(j)) ? "" : ` <span class="warnt" title="Not one of the standard Xero contact names">⚠</span>`}<div class="sub">${esc(j.address || "")}</div>
          <div class="sub">${esc(j.description || "")}${j.loads ? ` · <b>${esc(j.loads)} loads</b>` : ""}${j.completedByName ? " · " + esc(j.completedByName) : ""}</div></td>
        <td>${isRealPo(j.po) ? esc(j.po) : `<span class="unal">${j.po ? esc(j.po) + " (not a PO)" : "no PO"}</span>`}</td>
        <td><input class="idesc" value="${esc(j.invoiceDescription || invDescDefault(j))}"></td>
        <td><input class="iamt" type="number" step="0.01" min="0" placeholder="price" value="${esc(invAmountDefault(j) ?? "")}"></td></tr>`
    : `<tr class="jr" data-id="${j.id}"><td>${ui.inv === "numbered" ? `<input type="checkbox" class="isel" ${ui.invSel.has(j.id) ? "checked" : ""}>` : `<input type="checkbox" class="isel" ${ui.invSel.has(j.id) ? "checked" : ""}>`}</td>
        <td class="jn">${esc(j.invoiceNo)}</td><td>${esc(xd(j.invoiceDate || j.date))}</td><td>${esc(invContact(j))}</td><td>${esc(isRealPo(j.po) ? j.po : "")}</td>
        <td>${esc(j.invoiceDescription || invDescDefault(j))}</td><td>${money(j.invoiceAmount)}</td>${ui.inv === "recent" ? `<td><span class="qpill q-comp">Invoiced</span></td>` : ""}</tr>`;
  const acts = ui.inv === "ready"
    ? `<button id="inum" class="sm-btn primary" ${sel.length ? "" : "disabled"}>Assign invoice numbers &amp; download Xero CSV (${sel.length})</button>`
    : `<button id="icsv" class="sm-btn" ${sel.length ? "" : "disabled"}>Download Xero CSV (${sel.length})</button>
       ${ui.inv === "numbered" ? `<button id="imark" class="sm-btn primary" ${sel.length ? "" : "disabled"}>Mark invoiced (${sel.length})</button>` : ""}`;
  return `<div class="sm-head"><h1>Invoices</h1><span class="sub">Next invoice number: <b id="inext">${nextInvoiceGuess()}</b></span></div>
    <div class="qtabs">${tab("ready", "Ready to invoice", ready)}${tab("numbered", "Invoiced (numbered, import into Xero)", numbered)}${tab("recent", "Recent (last 30 days)", recent)}</div>
    <div class="filters">${acts}<label class="ck sub"><input type="checkbox" id="iall"> select all</label>
      <span class="sub">Selected total ${money(tot(sel)) || "$0.00"} ex GST</span>
      <span class="sub muted" style="margin-left:auto">${ui.inv === "ready" ? "Completed jobs with no invoice number. Price and description save as you type. Invoice date = job date, due +7 days." : ui.inv === "numbered" ? "Import the CSV into Xero, then Mark invoiced." : ""}</span></div>
    <table class="jt inv"><thead><tr>${head}</tr></thead><tbody>${list.map(row).join("") || `<tr><td colspan="8" class="muted pad">Nothing here.</td></tr>`}</tbody></table>`;
}
function nextInvoiceGuess() {
  const m = Math.max(INV_FLOOR, ui.invMeta?.lastNo || 0, ui.invMeta?.boxMax || 0, ...(ui.done || []).map(j => parseInt(j.invoiceNo) || 0));
  return m + 1;
}
async function loadInvMeta() {
  const [a, b] = await Promise.all([getDoc(doc(db, "meta", "invoicing")), getDoc(doc(db, "meta", "boxInvoiceMax"))]).catch(e => { toast("Invoicing rules not live: " + (e.code || e.message)); return []; });
  ui.invMeta = { lastNo: a?.data()?.lastNo || 0, boxMax: b?.data()?.max || 0 };
  const el = $("#inext"); if (el) el.textContent = nextInvoiceGuess();
}
function bindInvoices(A) {
  if (!ui.invMeta) loadInvMeta();
  const all = ui.done || [], byId = id => all.find(j => j.id === id);
  A.querySelectorAll("[data-inv]").forEach(b => b.onclick = () => { ui.inv = b.dataset.inv; ui.invSel.clear(); renderAdmin(); });
  A.querySelectorAll(".isel").forEach(c => c.onchange = () => { const id = c.closest("[data-id]").dataset.id; c.checked ? ui.invSel.add(id) : ui.invSel.delete(id); renderAdmin(); });
  const ia = $("#iall"); if (ia) ia.onchange = () => { A.querySelectorAll(".isel").forEach(c => { const id = c.closest("[data-id]").dataset.id; ia.checked ? ui.invSel.add(id) : ui.invSel.delete(id); }); renderAdmin(); };
  const save = (el, field, conv) => el.onchange = async () => { const id = el.closest("[data-id]").dataset.id;
    try { await updateDoc(doc(db, "jobs", id), { [field]: conv(el.value), updatedAt: serverTimestamp(), updatedBy: me.uid }); toast("Saved"); }
    catch (e) { toast("Not saved: " + (e.code || e.message)); } };
  A.querySelectorAll(".iamt").forEach(el => save(el, "invoiceAmount", v => v === "" ? null : Math.round(+v * 100) / 100));
  A.querySelectorAll(".idesc").forEach(el => save(el, "invoiceDescription", v => v.trim() || null));
  if ($("#inum")) $("#inum").onclick = () => assignNumbers([...ui.invSel].map(byId).filter(Boolean));
  if ($("#icsv")) $("#icsv").onclick = () => downloadCsv([...ui.invSel].map(byId).filter(Boolean));
  if ($("#imark")) $("#imark").onclick = () => markInvoiced([...ui.invSel].map(byId).filter(Boolean));
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
  ui.invMeta = null; ui.invSel.clear(); downloadCsv(out); ui.inv = "numbered"; renderAdmin();
}
async function markInvoiced(list) {
  if (!confirm(`Mark ${list.length} invoice(s) as invoiced (imported into Xero)?`)) return;
  try { await Promise.all(list.map(j => updateDoc(doc(db, "jobs", j.id), { invoiced: true, invoicedAt: serverTimestamp(), invoicedBy: me.uid, updatedAt: serverTimestamp(), updatedBy: me.uid }))); }
  catch (e) { return toast("Not saved: " + (e.code || e.message)); }
  ui.invSel.clear(); toast(`Marked ${list.length} invoiced`); ui.inv = "recent"; renderAdmin();
}

// ------------------------------------------------------------------ operator
// ServiceM8 mobile-app style: blue header, today's list -> job detail -> Start / Complete.
function renderOperator() {
  document.body.className = "operator";
  const t0 = todayStr(), t1 = addDays(t0, 1), wkEnd = addDays(t0, 7);
  const mine = jobs.filter(j => j.status !== "Cancelled").sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const sel = ui.opSel && mine.find(j => j.id === ui.opSel);
  if (sel) return renderOpDetail(sel);
  ui.opTab = ui.opTab || "today";
  const isDone = j => queueOf(j) === "Completed" || queueOf(j) === "Unsuccessful";
  const open = mine.filter(j => !isDone(j)), doneL = mine.filter(j => queueOf(j) === "Completed" && j.date >= addDays(t0, -30) && j.date <= t0).reverse();
  const groups = ui.opTab === "today" ? [["Today", open.filter(j => j.date === t0 || (j.date < t0 && j.status === "In progress"))]]
    : ui.opTab === "done" ? groupByDate(doneL).map(([d, js]) => [d === t0 ? "Today · " + dayLabel(d) : dayLabel(d), js])
    : groupByDate(open.filter(j => j.date >= t1 && j.date <= wkEnd)).map(([d, js]) => [(d === t1 ? "Tomorrow · " : "") + dayLabel(d), js]);
  $("#app").innerHTML = `<div class="mob"><div class="mob-bar"><div class="mob-title">${ui.opTab === "today" ? "Today" : ui.opTab === "done" ? "Completed" : "My Schedule"}</div><div class="mob-sub">${dayLabel(t0)}</div></div>
    <div class="mob-tabs"><button data-tab="today" class="${ui.opTab === "today" ? "on" : ""}">Today</button><button data-tab="week" class="${ui.opTab === "week" ? "on" : ""}">Schedule</button><button data-tab="done" class="${ui.opTab === "done" ? "on" : ""}">Completed</button></div>
    ${groups.map(([g, js]) => `<div class="mob-sec mday">${g} <span>${js.length}</span></div>
    ${js.map(j => `<div class="mrow" data-id="${j.id}"><div class="mtime">${g === "Today" ? "" : `<small>${esc(dayLabel(j.date).split(" ")[0].slice(0, 3))}</small>`}<b>${esc(j.time || "--")}</b><small>${j.durationHrs ? esc(j.durationHrs) + "h" : ""}</small></div>
      <div class="mbody"><div class="mcl"><span class="qdot ${QCLS[queueOf(j)]}"></span>${esc(j.client || "")}</div><div class="maddr">${esc(j.address || "-")}</div>
        <div class="mdesc">${esc(firstLine(j.description))}</div>
        <div class="mst ${j.status === "In progress" ? "inprog" : j.status === "Done" ? "done" : ""}">${j.status === "Done" ? "✔ Completed" : j.status === "In progress" ? "● In progress" : "Scheduled"} · #${esc(jobNo(j))}</div></div>
      <div class="chev">›</div></div>`).join("") || `<p class="muted pad">Nothing booked.</p>`}`).join("") || `<p class="muted pad">${ui.opTab === "done" ? "No completed jobs in the last 30 days." : "Nothing booked this week."}</p>`}</div>`;
  $("#app").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { ui.opTab = b.dataset.tab; renderOperator(); });
  $("#app").querySelectorAll(".mrow").forEach(r => r.onclick = () => { ui.opSel = r.dataset.id; renderOperator(); window.scrollTo(0, 0); });
}
function renderOpDetail(j) {
  const q = queueOf(j), done = j.status === "Done", started = j.status === "In progress";
  $("#app").innerHTML = `<div class="mob"><div class="mob-bar det ${QCLS[q]}"><button class="mback" id="back">‹ Jobs</button><div class="mob-title">Job #${esc(jobNo(j))}</div>
      <div class="mob-sub">${done ? "Completed" : started ? "In progress" : "Work Order"}</div></div>
    <div class="mcard"><div class="mlbl">Client</div><div class="mval">${esc(j.client || "")}</div></div>
    <a class="mcard link" href="${mapsUrl(j.address || "")}" target="_blank" rel="noopener"><div class="mlbl">Job Address</div><div class="mval big">📍 ${esc(j.address || "-")}</div><div class="chev">›</div></a>
    <div class="mcard"><div class="mlbl">Scheduled</div><div class="mval">${esc(dayLabel(j.date))} · ${esc(j.time || "")}${j.durationHrs ? " · " + esc(j.durationHrs) + "h" : ""}</div></div>
    <div class="mcard"><div class="mlbl">Job Description</div><div class="mval">${esc(j.description || "")}</div>
      <div class="mlbl" style="margin-top:8px">Purchase Order</div><div class="mval"><b>${esc(j.po || "—")}</b></div>
      ${(j.assignedNames || []).length ? `<div class="mlbl" style="margin-top:8px">Staff</div><div class="mval">${esc(j.assignedNames.join(", "))}</div>` : ""}</div>
    <div class="mcard"><div class="mlbl">Diary</div>${(j.log || []).map(l => `<div class="de"><span class="av">${esc((l.byName || "?")[0])}</span><div><small>${esc(l.byName)} · ${esc(l.at)}</small><div>${esc(l.text)}</div></div></div>`).join("") || `<div class="muted sub">No notes yet</div>`}
      <button class="mnote" data-act="note">＋ Add Note</button></div>
    <div class="mcard"><div class="mlbl">Photos</div><button type="button" class="mnote" id="emailph">📧 Email photos</button>
      <div class="muted sub">Send site photos to Alex by email</div></div>
    <div class="mactions">${done ? `<div class="donebar">✔ Completed${j.loads ? ` · ${j.loads} loads` : ""}</div>` :
      `<button class="mbtn start" data-act="start" ${started ? "disabled" : ""}>${started ? "Started" : "▶ Start Job"}</button>
       <button class="mbtn complete" data-act="done">✔ Complete</button>`}</div></div>`;
  $("#emailph").onclick = () => emailPhotos(j);
  $("#back").onclick = () => { ui.opSel = null; renderOperator(); };
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

// ------------------------------------------------------------------ email photos (no Firebase Storage)
// Pick photos -> (downscale) -> share sheet (Mail / Gmail) with subject + body, or a mailto: fallback. Then a diary entry.
// The share must be started by a fresh tap (browsers require a user gesture), so the picked photos are shown in a
// small dialog with a "Send" button.
const OFFICE_EMAIL = "alex@heartwoodew.com";
const emailSubject = j => `[Job Photos] Job #${jobNo(j)} – ${j.address || "(no address)"}`;
const emailBody = (j, infos, attached) => [`Job #${jobNo(j)}`, `Address: ${j.address || "-"}`, `Client: ${j.client || "-"}`, `PO: ${j.po || "-"}`,
  `Job date: ${j.date ? dayLabel(j.date) : "-"}`, "",
  attached ? `${infos.length} photo${infos.length > 1 ? "s" : ""} attached:` : `Please attach ${infos.length > 1 ? `these ${infos.length} photos` : "this photo"} to this email:`,
  ...infos.map((x, i) => `${i + 1}. ${x.time} (Brisbane) · ${fmtLL(x.gps)}${x.gps ? ` (${x.gps.src === "photo" ? "photo GPS" : "phone location"}) ${mapLink(x.gps)}` : ""}`),
  "", `From ${me.name}`].join("\n");
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
function emailPhotos(j) {
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
    emailDialog(j, files, infos);
  };
  inp.click();
}
function emailDialog(j, files, infos) {
  const mb = files.reduce((a, f) => a + f.size, 0) / 1e6, n = files.length;
  const canShare = !!(navigator.canShare && navigator.canShare({ files }));
  const mailto = `mailto:${OFFICE_EMAIL}?subject=${encodeURIComponent(emailSubject(j))}&body=${encodeURIComponent(emailBody(j, infos, false))}`;
  const v = document.createElement("div"); v.className = "emdlg";
  v.innerHTML = `<div class="embox"><h3>📧 Email ${n} photo${n > 1 ? "s" : ""}</h3>
    <div class="emthumbs">${files.map(f => `<img src="${URL.createObjectURL(f)}" alt="">`).join("")}</div>
    <p class="sub muted">Job #${esc(jobNo(j))} · ${esc(j.address || "")} · ${mb.toFixed(1)} MB${mb > 24 ? " — may be too big for one email, send fewer at a time" : ""}</p>
    ${canShare ? `<button type="button" class="mbtn complete" data-a="share">Send via email app</button>
      <p class="sub muted">Choose Mail or Gmail, then put <b>${OFFICE_EMAIL}</b> in the To box (the subject and job details are filled in).</p>`
    : `<p class="sub">This browser can't attach photos automatically. Tap below to open an email to ${OFFICE_EMAIL}, then attach the photos yourself.</p>
      <a class="mbtn complete" data-a="mail" href="${mailto}">Open email to Alex</a>
      <button type="button" class="mbtn" data-a="sent">I've sent it</button>`}
    <button type="button" class="mbtn ghost" data-a="x">Cancel</button></div>`;
  (document.querySelector("dialog[open]") || document.body).appendChild(v);
  const close = () => v.remove();
  v.querySelector('[data-a="x"]').onclick = close;
  const logIt = async () => {
    const ref = doc(db, "jobs", j.id);
    try { await updateDoc(ref, { log: arrayUnion(logEntry(`Photos emailed (${n}) by ${me.name}: ` + infos.map(x => `${x.time} @ ${fmtLL(x.gps)}`).join("; "))), updatedAt: serverTimestamp(), updatedBy: me.uid }); toast("Noted in the diary"); }
    catch (e) { toast("Diary not updated: " + (e.code || e.message)); }
  };
  const sh = v.querySelector('[data-a="share"]');
  if (sh) sh.onclick = async () => {
    try {
      await navigator.share({ files, title: emailSubject(j), text: `To: ${OFFICE_EMAIL}\nSubject: ${emailSubject(j)}\n\n${emailBody(j, infos, true)}` });
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
      <div class="mdc-top"><b class="mdc-time">${esc(j.time || "--:--")}</b><span class="mdc-no">#${esc(jobNo(j))}</span><span class="qpill ${QCLS[queueOf(j)]}">${esc(queueOf(j))}</span></div>
      <div class="mdc-cl">${esc(j.client || "")}</div>
      <a class="mdc-addr" href="${mapsUrl(j.address || "")}" target="_blank" rel="noopener">📍 ${esc(j.address || "-")}</a>
      <div class="mdc-desc">${esc(firstLine(j.description))}</div>
      <div class="mdc-foot"><span class="sub">${j.po ? "PO " + esc(j.po) : "No PO"}${j.durationHrs ? " · " + esc(j.durationHrs) + "h" : ""}${j.status === "In progress" ? ' · <b class="inprog">In progress</b>' : ""}</span>
        <button type="button" class="sm-btn mdc-move" data-move="${j.id}">⇄ Move</button></div></div>`;
  const groups = rowsFor(all).map(r => [r, dayJobs.filter(r.has)]);
  return `<div class="mdisp" id="mdisp"><div class="mdh">
      <div class="mdh-row"><button class="sm-btn" data-md="-1" aria-label="Previous day">‹</button>
        <div class="mdh-date"><b>${esc(dayLabel(d))}</b>${d === t0 ? '<span class="sub">Today</span>' : ""}</div>
        <button class="sm-btn" data-md="1" aria-label="Next day">›</button><button class="sm-btn" data-md="0">Today</button></div>
      <div class="mstrip">${strip.map(x => { const n = sched.filter(j => j.date === x).length;
        return `<button class="${x === d ? "on" : ""} ${x === t0 ? "today" : ""}" data-mday="${x}"><small>${new Date(x + "T00:00:00Z").toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" })}</small><b>${+x.slice(8)}</b><span class="${n ? "" : "zero"}">${n}</span></button>`; }).join("")}</div></div>
    ${groups.map(([r, js]) => `<div class="mgrp">${esc(r.name)} <span class="cnt">${js.length}</span></div>${js.map(card).join("") || `<p class="muted sub pad">Nothing booked.</p>`}`).join("")}
    <p class="sub muted pad">Swipe left / right to change day. Tap a card to open the job.</p></div>`;
}
function bindMobileDispatch(A, pool) {
  const go = d => { ui.mday = d; renderAdmin(); window.scrollTo(0, 0); };
  A.querySelectorAll("[data-md]").forEach(b => b.onclick = () => go(+b.dataset.md === 0 ? todayStr() : addDays(ui.mday, +b.dataset.md)));
  A.querySelectorAll("[data-mday]").forEach(b => b.onclick = () => go(b.dataset.mday));
  A.querySelectorAll(".mdc").forEach(c => { c.draggable = false; c.ondragstart = null; });
  A.querySelectorAll(".mdc-addr").forEach(a => a.addEventListener("click", ev => ev.stopPropagation()));
  A.querySelectorAll("[data-move]").forEach(b => b.onclick = ev => { ev.stopPropagation(); const j = pool.find(x => x.id === b.dataset.move); if (j) moveSheet(j); });
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
