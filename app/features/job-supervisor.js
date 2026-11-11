// Site supervisor on a job ticket: name, mobile and email.
// Admins and supervisors may set it. Ordinary operators may not.
// Heartwood supervisors can type it onto the job. Saving it onto the client's
// contact list is limited to people the rules already let write clients.

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function canEditJobSupervisor(me) {
  return !!(me && (me.role === "admin" || me.role === "supervisor" || me.staffRole === "supervisor"));
}

// Client contact writes: Heartwood admins (rules isAdmin) and a non-Heartwood
// office (admin or supervisor). A Heartwood supervisor cannot write clients.
export function canSaveSupervisorContact(me, companyId) {
  if (!canEditJobSupervisor(me)) return false;
  if (me.role === "admin") return true;
  return !!companyId && companyId !== "heartwood";
}

export function supervisorContactDefaultOn(me) {
  return !!(me && me.role === "admin");
}

export function explicitSupervisor(job) {
  const name = String(job && job.supervisorName || "").trim();
  const email = String(job && job.supervisorEmail || "").trim();
  const mobile = String(job && job.contactPhone || "").trim();
  if (!name && !email) return null;
  return { name, email, mobile };
}

function matchContact(sups, s) {
  return sups.find(x => (s.email && x.email && x.email.toLowerCase() === String(s.email).toLowerCase())
    || (s.name && x.name && x.name.toLowerCase().startsWith(String(s.name).toLowerCase())));
}

export function clientSupervisors(client) {
  return ((client && client.contacts) || []).filter(x => x && x.kind === "supervisor");
}

// Job fields win, then the remembered meta row, then the client's supervisor contacts.
export function resolveJobSupervisor(job, meta, contacts) {
  const sups = (contacts || []).filter(x => x && x.kind === "supervisor");
  const explicit = explicitSupervisor(job);
  if (explicit) {
    const hit = matchContact(sups, explicit);
    return {
      ...(hit || {}),
      name: explicit.name || (hit && hit.name) || "",
      email: explicit.email || (hit && hit.email) || "",
      mobile: explicit.mobile || (hit && (hit.mobile || hit.phone)) || "",
    };
  }
  if (meta) {
    const hit = matchContact(sups, meta);
    return { ...meta, ...(hit || {}), email: meta.email || (hit && hit.email), name: (hit && hit.name) || meta.name };
  }
  const base = String(job && job.po || "").split("/")[0].replace(/\D/g, "");
  const byPo = base && sups.find(x => (x.pos || []).includes(base));
  if (byPo) return byPo;
  if (sups.length === 1) return sups[0];
  return sups.find(x => x.default) || null;
}

export function supervisorJobFields({ name, email, mobile }) {
  const n = String(name || "").trim();
  const e = String(email || "").trim();
  const m = String(mobile || "").trim();
  if (!n) return { ok: false, error: "Enter the supervisor's name." };
  if (n.length > 80 || /[\n\r<>]/.test(n)) return { ok: false, error: "Check the name and try again." };
  if (e.length > 120 || (e && !EMAIL.test(e))) return { ok: false, error: "That doesn't look like an email address." };
  if (m.length > 40 || /[\n\r<>]/.test(m)) return { ok: false, error: "Check the mobile and try again." };
  return {
    ok: true,
    fields: { supervisorName: n, contactName: n, supervisorEmail: e, contactPhone: m },
  };
}

// Add or refresh one supervisor contact. Same email, or the same name, updates the row.
export function mergeSupervisorContact(contacts, person) {
  const list = (Array.isArray(contacts) ? contacts : []).map(x => ({ ...x }));
  const email = String(person.email || "").trim().toLowerCase();
  const name = String(person.name || "").trim().toLowerCase();
  const idx = list.findIndex(x => {
    if ((x.kind || "") !== "supervisor") return false;
    if (email && String(x.email || "").trim().toLowerCase() === email) return true;
    return !!name && String(x.name || "").trim().toLowerCase() === name;
  });
  const prev = idx >= 0 ? list[idx] : {};
  const row = {
    ...prev,
    kind: "supervisor",
    name: String(person.name || "").trim(),
    role: prev.role || "Supervisor",
    mobile: String(person.mobile || "").trim(),
    email: String(person.email || "").trim(),
    source: prev.source || "Added from a job",
  };
  if (idx >= 0) list[idx] = row;
  else list.push(row);
  return list;
}
