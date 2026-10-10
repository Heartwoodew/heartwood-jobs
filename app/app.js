// Heartwood Jobs — Phase 1. Plain ES modules + Firebase modular SDK from the CDN. No build step.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, connectAuthEmulator }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, getDoc, getDocs, query, where, orderBy, onSnapshot, addDoc, updateDoc, serverTimestamp, arrayUnion }
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
    unsub = onSnapshot(q, s => { jobs = s.docs.map(d => ({ id: d.id, ...d.data() })); addNameOnlyStaff(jobs); renderAdmin(); });
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
// staff = people with a login {uid,name} + name-only people from ServiceM8 (e.g. Nick) {uid:null,name}.
// Jobs keep assigned[] (login uids, used by the rules) and assignedNames[] (everyone, used for display/filter).
const staffName = uid => (staff.find(s => s.uid === uid) || {}).name || "?";
const skey = s => s.uid || "name:" + s.name;
function addNameOnlyStaff(list) {
  for (const j of list) for (const n of j.assignedNames || [])
    if (!staff.some(s => s.name.toLowerCase() === n.toLowerCase())) staff.push({ uid: null, name: n });
}
const namesOf = j => (j.assignedNames && j.assignedNames.length ? j.assignedNames : (j.assigned || []).map(staffName));
const label = n => staff.some(s => !s.uid && s.name === n) ? `${n} (no login)` : n;
function filtered() {
  const f = ui.staffF, sel = staff.find(s => skey(s) === f);
  return jobs.filter(j => (!f || (f === "_none" ? !namesOf(j).length : namesOf(j).map(x => x.toLowerCase()).includes((sel?.name || "").toLowerCase())))
    && (!ui.typeF || j.type === ui.typeF));
}
function tiles() {
  const t0 = todayStr(), wk0 = addDays(t0, -dowMon(t0)), wk1 = addDays(wk0, 7), wk2 = addDays(wk0, 14), end = addDays(t0, 14);
  const up = jobs.filter(j => j.date >= t0 && j.date < end && j.status !== "Cancelled");
  const cnt = k => { const a = up.filter(j => j.type === k); return [a.length, a.filter(j => j.date < wk1).length, a.filter(j => j.date >= wk1 && j.date < wk2).length]; };
  const T = [["backslab", "Backslabs"], ["clean", "Site cleans"], ["spoil", "Spoil removals"], ["other", "Other"]];
  return `<section class="tiles">${T.map(([k, n]) => { const [a, b, c] = cnt(k);
    return `<button class="tile t-${k} ${ui.typeF === k ? "on" : ""}" data-type="${k}"><span class="big">${a}</span><span class="nm">${n}</span>
      <span class="sm">This wk ${b} · Next wk ${c}</span></button>`; }).join("")}</section>`;
}
function jobCard(j, compact) {
  const names = namesOf(j).map(label).join(", ") || "Unassigned";
  return `<div class="job s-${(j.status || "").replace(" ", "")} t-${j.type}" draggable="true" data-id="${j.id}">
    <div class="jt">${esc(j.time || "")}${j.durationHrs ? ` <small>${esc(j.durationHrs)}h</small>` : ""}</div>
    <div class="jm"><div class="addr">${esc(j.address || "-")}</div>
      <div class="cl"><span class="badge t-${j.type}">${esc(TYPES[j.type] || j.type)}</span> ${esc(j.client || "")} · <b>${esc(names)}</b></div>
      ${compact ? "" : `<div class="ds">${esc(j.description || "")}</div>`}
      <div class="meta">PO ${esc(j.po || "—")} · <span class="st">${esc(j.status)}</span>${j.loads ? ` · ${j.loads} loads` : ""}${j.sm8JobNo ? ` · SM8 #${esc(j.sm8JobNo)}` : ""}</div></div>
    <div class="mv"><button class="ghost sm" data-move="-1" title="Previous day">◀</button><button class="ghost sm" data-move="1" title="Next day">▶</button></div></div>`;
}
function renderAdmin() {
  if (!me || me.role !== "admin") return;
  const t0 = todayStr(), days = [...Array(14)].map((_, i) => addDays(t0, i));
  const fj = filtered();
  const overdue = fj.filter(j => j.date < t0 && ["Scheduled", "In progress"].includes(j.status));
  const undated = (ui.undated || []).filter(j => fj === jobs || (!ui.typeF || j.type === ui.typeF));
  let body;
  if (ui.view === "list") {
    body = days.map(d => { const js = fj.filter(j => j.date === d).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
      const lab = d === t0 ? " · Today" : d === addDays(t0, 1) ? " · Tomorrow" : "";
      return `<section class="day drop" data-date="${d}"><h3>${dayLabel(d)}${lab} <span class="cnt">${js.length}</span></h3>
        ${js.map(j => jobCard(j)).join("") || `<p class="muted empty">No jobs</p>`}</section>`; }).join("");
  } else {
    const start = addDays(t0, -dowMon(t0)), cells = [...Array(14)].map((_, i) => addDays(start, i));
    body = `<div class="cal">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(x => `<div class="ch">${x}</div>`).join("")}
      ${cells.map(d => { const js = fj.filter(j => j.date === d).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
        return `<div class="cc drop ${d === t0 ? "today" : ""} ${d < t0 ? "past" : ""}" data-date="${d}"><div class="cd">${d.slice(8)}/${d.slice(5, 7)}</div>
          ${js.map(j => `<div class="chip t-${j.type} s-${(j.status || "").replace(" ", "")}" draggable="true" data-id="${j.id}">${esc(j.time || "")} ${esc((j.address || "").split(",")[0])}</div>`).join("")}</div>`; }).join("")}</div>`;
  }
  $("#app").innerHTML = `${tiles()}
    <div class="bar">
      <div class="seg"><button data-view="list" class="${ui.view === "list" ? "on" : ""}">Days</button><button data-view="cal" class="${ui.view === "cal" ? "on" : ""}">Calendar</button></div>
      <select id="fs"><option value="">All staff</option>${staff.map(s => `<option value="${esc(skey(s))}" ${ui.staffF === skey(s) ? "selected" : ""}>${esc(label(s.name))}</option>`).join("")}<option value="_none" ${ui.staffF === "_none" ? "selected" : ""}>Unassigned</option></select>
      <select id="ft"><option value="">All types</option>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${ui.typeF === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <button id="new" class="primary">+ New job</button></div>
    ${overdue.length ? `<section class="day warn"><h3>Overdue / not marked done <span class="cnt">${overdue.length}</span></h3>${overdue.map(j => jobCard(j, true)).join("")}</section>` : ""}
    ${undated.length ? `<section class="day"><h3>Unscheduled (open jobs, no booking) <span class="cnt">${undated.length}</span></h3>${undated.map(j => jobCard(j, true)).join("")}</section>` : ""}
    ${body}`;
  const A = $("#app");
  A.querySelectorAll(".tile").forEach(b => b.onclick = () => { ui.typeF = ui.typeF === b.dataset.type ? "" : b.dataset.type; renderAdmin(); });
  A.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { ui.view = b.dataset.view; renderAdmin(); });
  $("#fs").onchange = e => { ui.staffF = e.target.value; renderAdmin(); };
  $("#ft").onchange = e => { ui.typeF = e.target.value; renderAdmin(); };
  $("#new").onclick = () => editJob(null);
  const all = [...jobs, ...(ui.undated || [])];
  A.querySelectorAll("[data-id]").forEach(el => {
    el.onclick = ev => { if (ev.target.closest("[data-move]")) return; editJob(all.find(j => j.id === el.dataset.id)); };
    el.ondragstart = ev => { ev.dataTransfer.setData("text/plain", el.dataset.id); el.classList.add("dragging"); };
    el.ondragend = () => el.classList.remove("dragging");
  });
  A.querySelectorAll("[data-move]").forEach(b => b.onclick = ev => {
    ev.stopPropagation(); const j = all.find(x => x.id === b.closest("[data-id]").dataset.id);
    moveJob(j, addDays(j.date || todayStr(), +b.dataset.move));
  });
  A.querySelectorAll(".drop").forEach(z => {
    z.ondragover = ev => { ev.preventDefault(); z.classList.add("over"); };
    z.ondragleave = () => z.classList.remove("over");
    z.ondrop = ev => { ev.preventDefault(); z.classList.remove("over"); const j = all.find(x => x.id === ev.dataTransfer.getData("text/plain")); if (j && j.date !== z.dataset.date) moveJob(j, z.dataset.date); };
  });
}
async function moveJob(j, date) {
  await updateDoc(doc(db, "jobs", j.id), { date, editedInApp: true, updatedAt: serverTimestamp(), updatedBy: me.uid });
  if (ui.undated) ui.undated = ui.undated.filter(x => x.id !== j.id);
  toast(`Moved to ${dayLabel(date)}`);
}
function editJob(j) {
  const n = !j; j = j || { date: todayStr(), time: "07:00", durationHrs: 4, status: "Scheduled", type: "spoil", assigned: [], client: CLIENTS[0] };
  const d = $("#dlg");
  d.innerHTML = `<form method="dialog" id="jf" class="jf"><h2>${n ? "New job" : "Edit job"}</h2>
    <label>Client<input name="client" list="clients" value="${esc(j.client)}" required><datalist id="clients">${CLIENTS.map(c => `<option value="${esc(c)}">`).join("")}</datalist></label>
    <label>Address / lot<input name="address" value="${esc(j.address)}" required></label>
    <div class="row"><label>Job type<select name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${j.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>PO<input name="po" value="${esc(j.po)}"></label></div>
    <label>Description<textarea name="description" rows="3">${esc(j.description)}</textarea></label>
    <p class="hint">Spoil removal is always its own job — never add spoil to a backslab job.</p>
    <div class="row"><label>Date<input type="date" name="date" value="${esc(j.date)}"></label>
      <label>Time<input type="time" name="time" value="${esc(j.time)}"></label>
      <label>Hours<input type="number" step="0.5" min="0" name="durationHrs" value="${esc(j.durationHrs)}"></label></div>
    <fieldset><legend>Assigned staff</legend>${staff.map(s => `<label class="ck"><input type="checkbox" name="assigned" value="${esc(skey(s))}" ${namesOf(j).map(x => x.toLowerCase()).includes(s.name.toLowerCase()) ? "checked" : ""}> ${esc(label(s.name))}</label>`).join("")}</fieldset>
    <div class="row"><label>Status<select name="status">${STATUSES.map(s => `<option ${j.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label>Loads<input type="number" min="0" name="loads" value="${esc(j.loads ?? "")}"></label></div>
    <label>Notes (office)<textarea name="notes" rows="2">${esc(j.notes)}</textarea></label>
    ${(j.log || []).length ? `<div class="log"><b>Site notes</b>${j.log.map(l => `<div><small>${esc(l.byName)} ${esc(l.at)}</small> ${esc(l.text)}</div>`).join("")}</div>` : ""}
    <p id="ferr" class="err"></p>
    <div class="btns"><button value="cancel" formnovalidate class="ghost">Close</button><button value="save" class="primary">Save</button></div></form>`;
  d.showModal();
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
      d.close(); toast("Saved"); if (!data.date) location.reload();
    } catch (e) { $("#ferr").textContent = e.message; }
  };
}

// ------------------------------------------------------------------ operator
function renderOperator() {
  const t0 = todayStr(), t1 = addDays(t0, 1), wkEnd = addDays(t0, 7);
  const mine = jobs.filter(j => j.status !== "Cancelled").sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const groups = [["Today", mine.filter(j => j.date === t0 || (j.date < t0 && j.status === "In progress"))],
    ["Tomorrow", mine.filter(j => j.date === t1)],
    ["This week", mine.filter(j => j.date > t1 && j.date <= wkEnd)]];
  $("#app").innerHTML = `<div class="op">${groups.map(([g, js]) => `<section class="opg"><h2>${g} <span class="cnt">${js.length}</span></h2>
    ${js.map(j => `<article class="opj s-${(j.status || "").replace(" ", "")}" data-id="${j.id}">
      <div class="opt">${g === "This week" ? dayLabel(j.date).split(" ")[0] + " · " : ""}${esc(j.time || "")} <span class="badge t-${j.type}">${esc(TYPES[j.type] || "")}</span> <span class="st">${esc(j.status)}</span></div>
      <a class="opa" href="${mapsUrl(j.address || "")}" target="_blank" rel="noopener">📍 ${esc(j.address || "-")}</a>
      <div class="opd">${esc(j.description || "")}</div>
      <div class="opm">PO <b>${esc(j.po || "—")}</b> · ${esc(j.client || "")}</div>
      ${(j.log || []).slice(-2).map(l => `<div class="opn">📝 ${esc(l.text)}</div>`).join("")}
      <div class="opb">${j.status === "Done" ? `<div class="donebar">✔ Done${j.loads ? ` · ${j.loads} loads` : ""}</div>` : `
        <button class="big start" data-act="start" ${j.status === "In progress" ? "disabled" : ""}>${j.status === "In progress" ? "Started" : "Start"}</button>
        <button class="big done" data-act="done">Done</button>`}
        <button class="big note" data-act="note">Add note</button></div></article>`).join("") || `<p class="muted">Nothing booked.</p>`}</section>`).join("")}</div>`;
  $("#app").querySelectorAll("[data-act]").forEach(b => b.onclick = () => opAction(jobs.find(j => j.id === b.closest("[data-id]").dataset.id), b.dataset.act));
}
const logEntry = text => ({ text, by: me.uid, byName: me.name, at: new Date().toLocaleString("en-AU", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }) });
async function opAction(j, act) {
  const ref = doc(db, "jobs", j.id), base = { updatedAt: serverTimestamp(), updatedBy: me.uid };
  if (act === "start") { await updateDoc(ref, { ...base, status: "In progress", startedAt: serverTimestamp() }); return toast("Started"); }
  const d = $("#dlg");
  d.innerHTML = `<form method="dialog" id="of" class="jf"><h2>${act === "done" ? "Mark done" : "Add note"}</h2>
    <p class="muted">${esc(j.address)}</p>
    ${act === "done" ? `<label>Loads (optional)<input name="loads" type="number" inputmode="numeric" min="0" value="${esc(j.loads ?? "")}"></label>` : ""}
    <label>Note${act === "done" ? " (optional)" : ""}<textarea name="note" rows="3" ${act === "note" ? "required" : ""}></textarea></label>
    <div class="btns"><button value="cancel" formnovalidate class="ghost big">Cancel</button><button value="ok" class="primary big">${act === "done" ? "Done ✔" : "Save note"}</button></div></form>`;
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
