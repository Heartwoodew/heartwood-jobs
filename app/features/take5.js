// Take 5: the standard Australian five-step check done when field crew start a job.
// Stop and think, look for hazards, assess the risk, control the hazards, proceed safely.
// The record is company-scoped. A short note is required. A photo is optional.

export const TAKE5_STEPS = Object.freeze([
  ["stop", "Stop and think"],
  ["look", "Look for hazards"],
  ["assess", "Assess the risk"],
  ["control", "Control the hazards"],
  ["proceed", "Proceed safely"],
]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^t5[a-z0-9]{16}$/;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export function newTake5Id() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return "t5" + [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

// One Take 5 per person per job, so a second start finds the same record without listing the collection.
export function take5IdFor(uid, jobId) {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x01000193;
  const text = `${uid}\n${jobId}`;
  for (let i = 0; i < text.length; i++) {
    h1 ^= text.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= text.charCodeAt(i) + 1;
    h2 = Math.imul(h2, 0x01000193);
  }
  const hex = n => (n >>> 0).toString(16).padStart(8, "0");
  return "t5" + hex(h1) + hex(h2);
}

export function take5PhotoPath(companyId, uid, id) {
  if (!companyId || !uid || !ID.test(id || "")) return "";
  return `take5Photos/${companyId}/${uid}_${id}.jpg`;
}

// Missing setting, a blank document, or enabled true: Take 5s are on.
// Only an admin saving enabled: false turns them off.
export function take5Enabled(setting) {
  return !(setting && setting.enabled === false);
}

export function shouldPromptTake5(me, enabled) {
  if (!enabled || !me) return false;
  const role = me.staffRole || me.role || "";
  return role === "labourer" || role === "operator";
}

export function canViewTake5(me) {
  if (!me) return false;
  if (me.role === "admin") return true;
  const role = me.staffRole || me.role || "";
  return role === "supervisor" || role === "manager" || role === "admin";
}

export function take5Payload({ id, uid, name, companyId, job, note, steps, photoPath, day } = {}) {
  if (!ID.test(id || "")) return { ok: false, reason: "That Take 5 could not be started. Try again." };
  if (!uid) return { ok: false, reason: "Sign in again." };
  const who = String(name || "").trim().slice(0, 80);
  if (who.length < 2) return { ok: false, reason: "Your name is missing." };
  const company = String(companyId || "").trim();
  if (!company) return { ok: false, reason: "Sign in again." };
  if (!DATE.test(day || "")) return { ok: false, reason: "Today's date is missing." };
  const jobId = String(job && job.id || "").trim().slice(0, 80);
  if (!jobId) return { ok: false, reason: "Open the job first." };
  const jobNo = String(job && (job.jobNo || job.sm8JobNo) || "").trim().slice(0, 40);
  const text = String(note || "").replace(/\r\n/g, "\n").trim().slice(0, 500);
  if (!text) return { ok: false, reason: "Add a short note of the hazards and the controls." };
  const flags = {};
  for (const [key] of TAKE5_STEPS) {
    if (!steps || steps[key] !== true) return { ok: false, reason: "Tick all five steps." };
    flags[key] = true;
  }
  const path = String(photoPath || "");
  const allowed = path === "" || path === take5PhotoPath(company, uid, id);
  if (!allowed || path.length > 200) return { ok: false, reason: "The photo could not be attached." };
  return {
    ok: true,
    data: {
      companyId: company,
      uid,
      name: who,
      jobId,
      jobNo,
      day,
      note: text,
      steps: flags,
      photoPath: path,
    },
  };
}

export function hasTake5(records, uid, jobId) {
  return (records || []).some(row => row && row.uid === uid && row.jobId === jobId);
}

export function take5FormHtml(job, { name = "", day = "" } = {}) {
  const steps = TAKE5_STEPS.map(([key, label]) => `<label class="take5-step"><input type="checkbox" name="${key}"> ${esc(label)}</label>`).join("");
  const title = job && (job.jobNo || job.sm8JobNo) ? `#${job.jobNo || job.sm8JobNo}` : "this job";
  return `<form id="take5form" class="take5">
    <h3>Take 5</h3>
    <p class="sub">Before you start ${esc(title)}. Tick each step, then note the hazards and what you will do about them. A photo is optional. This saves on the phone if you are out of range, the same way a prestart does.</p>
    ${steps}
    <label>Hazards and controls<textarea name="note" rows="3" required maxlength="500" placeholder="What could hurt someone, and what you will do"></textarea></label>
    <label>Photo (optional)<input name="photo" type="file" accept="image/*" capture="environment"></label>
    <input type="hidden" name="day" value="${esc(day)}">
    <p class="sub">Signed by ${esc(name)}</p>
    <div class="btns"><button type="button" class="mbtn ghost" data-x>Not now</button><button class="mbtn complete" type="submit">Save and start job</button></div>
  </form>`;
}

export function take5CardHtml(row) {
  if (!row) return "";
  const when = row.day || "";
  return `<article class="comp-card" data-take5="${esc(row.id)}"><div class="comp-top"><div><b>${esc(row.name || "Staff")}</b><div class="sub">${esc(when)}${row.jobNo ? ` · #${esc(row.jobNo)}` : ""}</div></div><span class="qpill q-comp">Take 5</span></div><p>${esc(row.note || "")}</p>${row.photoPath ? `<p class="sub">Photo attached</p>` : ""}</article>`;
}

export function take5ListHtml(records, { jobId = "", empty = "No Take 5s yet." } = {}) {
  const rows = (records || []).filter(row => !jobId || row.jobId === jobId)
    .slice()
    .sort((a, b) => String(b.day || "").localeCompare(String(a.day || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  if (!rows.length) return `<p class="muted pad">${esc(empty)}</p>`;
  return rows.map(take5CardHtml).join("");
}

export function take5JobHtml(records, jobId, { ownUid = "", canView = false } = {}) {
  const rows = (records || []).filter(row => row && row.jobId === jobId && (canView || row.uid === ownUid));
  if (!rows.length) return canView ? `<p class="sub">No Take 5 on this job yet.</p>` : "";
  return take5ListHtml(rows, { jobId });
}
