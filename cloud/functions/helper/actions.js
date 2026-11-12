// What Helper is allowed to prepare.
// A proposal is not a write. Job notes are never parsed for actions.
// Prices, email, deletes, Xero, roles and Storage are not actions.

import { randomBytes } from "node:crypto";
import { canSeeJob } from "../shared/cloud-storage.js";
import { redactMoneyText } from "./money.js";

export const PROPOSAL_TTL_MS = 30 * 60 * 1000;
export const NOTE_CAP = 2000;
export const CHAT_CAP = 4000;
const STATUSES = ["Scheduled", "In progress", "Done", "Cancelled"];
const JOB_TYPES = ["spoil", "backslab", "waterproof", "clean", "other"];

const BLOCKED = /email|sms|delete|xero|invoice|payment|reimburse|role|storage|receipt|profit/i;

export function intentFromQuestion(question) {
  const q = String(question || "").trim();
  let match = /^add (?:a )?note (?:on|to) (.+?): (.+)$/i.exec(q);
  if (match) return { type: "job-note", jobHint: match[1].trim(), text: match[2].trim() };
  match = /^set my hours for (\d{4}-\d{2}-\d{2}) from (\d{2}:\d{2}) to (\d{2}:\d{2})(?: note (.+))?$/i.exec(q);
  if (match) return { type: "timesheet", date: match[1], start: match[2], finish: match[3], note: (match[4] || "").trim() };
  match = /^create (?:a )?job at (.+?) for (.+)$/i.exec(q);
  if (match) return { type: "job-draft", address: match[1].trim(), client: match[2].trim(), description: "" };
  match = /^save (?:a )?quote draft for (.+?) at (.+)$/i.exec(q);
  if (match) return { type: "quote-draft", client: match[1].trim(), address: match[2].trim(), description: "" };
  match = /^post to team chat: (.+)$/i.exec(q);
  if (match) return { type: "chat", where: "staff", text: match[1].trim() };
  match = /^post on the (.+?) job chat: (.+)$/i.exec(q);
  if (match) return { type: "chat", where: "job", jobHint: match[1].trim(), text: match[2].trim() };
  match = /^start the (.+?) job$/i.exec(q);
  if (match) return { type: "job-status", jobHint: match[1].trim(), status: "In progress" };
  match = /^mark the (.+?) job done$/i.exec(q);
  if (match) return { type: "job-status", jobHint: match[1].trim(), status: "Done" };
  match = /^set the (.+?) job to (Scheduled|In progress|Done|Cancelled)$/i.exec(q);
  if (match) return { type: "job-status", jobHint: match[1].trim(), status: match[2] };
  match = /^edit the (.+?) job (date|time|address|client|description|notes) to (.+)$/i.exec(q);
  if (match) return { type: "job-edit", jobHint: match[1].trim(), field: match[2].toLowerCase(), value: match[3].trim() };
  match = /^(?:add a timesheet entry on|edit my timesheet for) (\d{4}-\d{2}-\d{2}) from (\d{2}:\d{2}) to (\d{2}:\d{2})(?: note (.+))?$/i.exec(q);
  if (match) return { type: "timesheet", date: match[1], start: match[2], finish: match[3], note: (match[4] || "").trim() };
  match = /^start a prestart on (.+?)(?: for (\d{4}-\d{2}-\d{2}))?(?: reading (\d+))?$/i.exec(q);
  if (match) return { type: "prestart", assetHint: match[1].trim(), day: match[2] || "", reading: match[3] || "" };
  match = /^request (annual|sick|other) leave from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})(?: (morning|afternoon))?: (.+)$/i.exec(q);
  if (match) {
    const half = match[4] === "morning" ? "am" : match[4] === "afternoon" ? "pm" : "";
    const sameDay = match[2] === match[3];
    return {
      type: "leave-create",
      leaveType: match[1].toLowerCase(),
      start: match[2],
      end: match[3],
      startHalf: half,
      endHalf: sameDay ? half : "",
      reason: match[5].trim(),
    };
  }
  match = /^(approve|decline) leave (.+?): (.+)$/i.exec(q);
  if (match) return { type: "leave-decision", status: match[1].toLowerCase() === "approve" ? "approved" : "declined", hint: match[2].trim(), note: match[3].trim() };
  match = /^invite (labourer|operator|supervisor|admin) (.+?) at (\S+)$/i.exec(q);
  if (match) return { type: "invite", role: match[1].toLowerCase(), name: match[2].trim(), email: match[3].trim() };
  return null;
}

/** Model text is never an action. Only the signed-in person's own question is. */
export function actionFromModelReply() {
  return null;
}

function cleanText(value, max, hideMoney) {
  let text = String(value || "").replace(/\r\n/g, "\n").trim();
  if (hideMoney) text = redactMoneyText(text);
  if (text.length > max) text = text.slice(0, max);
  return text;
}

function clock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "";
  return `${match[1]}:${match[2]}`;
}

export function weekStartOf(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
  const date = new Date(iso + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const date = new Date(iso + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function timesheetHours(start, finish) {
  const a = clock(start);
  const b = clock(finish);
  if (!a || !b) return 0;
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  const mins = (bh * 60 + bm >= ah * 60 + am ? (bh * 60 + bm) - (ah * 60 + am) : (bh * 60 + bm) + 1440 - (ah * 60 + am)) - 30;
  return Math.max(0, Math.round(mins / 60 * 100) / 100);
}

function deny(reason) {
  return { ok: false, reason };
}

const STAFF_ACTIONS = new Set(["job-note", "timesheet", "prestart", "leave-create"]);
const SUPERVISOR_ACTIONS = new Set([...STAFF_ACTIONS, "leave-decision", "invite", "quote-draft", "chat", "job-status"]);
const ADMIN_ACTIONS = new Set([...SUPERVISOR_ACTIONS, "job-draft", "job-edit"]);

/** Same gates as the Firestore rules: own timesheet and leave, member prestart, supervisor leave and invites, admin job edits. */
export function actionAllowed(membership, type) {
  if (!membership?.ok) return { ok: false, reason: "not-allowed" };
  if (membership.rulesAdmin) return ADMIN_ACTIONS.has(type) ? { ok: true } : { ok: false, reason: "not-allowed" };
  if (membership.role === "supervisor") {
    if (type === "job-draft" || type === "job-edit") return { ok: false, reason: "admin-only" };
    return SUPERVISOR_ACTIONS.has(type) ? { ok: true } : { ok: false, reason: "not-allowed" };
  }
  if (type === "leave-decision" || type === "invite" || type === "quote-draft") return { ok: false, reason: "supervisor-only" };
  if (type === "job-draft" || type === "job-edit" || type === "job-status" || type === "chat") return { ok: false, reason: "not-allowed" };
  return STAFF_ACTIONS.has(type) ? { ok: true } : { ok: false, reason: "not-allowed" };
}

export async function prepareAction({ membership, intent, reader, name, at, today }) {
  if (!membership?.ok || !intent || BLOCKED.test(intent.type || "")) return deny("not-allowed");
  const gate = actionAllowed(membership, intent.type);
  if (!gate.ok) return deny(gate.reason);
  const hideMoney = !membership.canSeeMoney;
  if (intent.type === "job-note") return prepareNote(membership, intent, reader, name, at, hideMoney);
  if (intent.type === "timesheet") return prepareTimesheet(membership, intent, hideMoney);
  if (intent.type === "job-draft") return prepareJobDraft(membership, intent);
  if (intent.type === "quote-draft") return prepareQuoteDraft(membership, intent, name);
  if (intent.type === "chat") return prepareChat(membership, intent, reader, name, hideMoney);
  if (intent.type === "job-status") return prepareStatus(membership, intent, reader, name);
  if (intent.type === "job-edit") return prepareJobEdit(membership, intent, reader);
  if (intent.type === "prestart") return preparePrestart(membership, intent, reader, name, today);
  if (intent.type === "leave-create") return prepareLeave(membership, intent, name);
  if (intent.type === "leave-decision") return prepareLeaveDecision(membership, intent, reader, name);
  if (intent.type === "invite") return prepareInvite(membership, intent, reader);
  return deny("not-allowed");
}

async function oneJob(reader, membership, hint) {
  const raw = String(hint || "").trim();
  const needle = raw.toLowerCase();
  if (needle.length < 3) return deny("which-job");
  const rows = membership.rulesAdmin
    ? await reader.jobs({ limit: 80 })
    : await reader.jobs({ assignedUid: membership.uid, limit: 80 });
  const visible = (rows || []).filter(job => canSeeJob(membership, job));
  const byId = visible.filter(job => job.id === raw);
  if (byId.length === 1) return { ok: true, job: byId[0] };
  const hits = visible.filter(job => String(job.address || "").toLowerCase().includes(needle));
  if (hits.length !== 1) return deny(hits.length ? "which-job" : "not-allowed");
  return { ok: true, job: hits[0] };
}

async function prepareNote(membership, intent, reader, name, at, hideMoney) {
  const found = await oneJob(reader, membership, intent.jobHint);
  if (!found.ok) return found;
  const text = cleanText(intent.text, NOTE_CAP, hideMoney);
  if (!text) return deny("empty");
  return {
    ok: true,
    action: { type: "job-note", jobId: found.job.id, text, by: membership.uid, byName: name, at },
    title: "Add a note",
    lines: [`Job: ${found.job.address}`, `Note: ${text}`],
  };
}

function prepareTimesheet(membership, intent, hideMoney) {
  const date = String(intent.date || "");
  const start = clock(intent.start);
  const finish = clock(intent.finish);
  const week = weekStartOf(date);
  if (!week || !start || !finish) return deny("invalid");
  const note = cleanText(intent.note, 200, hideMoney);
  const hours = timesheetHours(start, finish);
  return {
    ok: true,
    action: {
      type: "timesheet",
      uid: membership.uid,
      date,
      weekStart: week,
      weekEnd: addDays(week, 6),
      start,
      finish,
      note,
      hours,
    },
    title: "Update your timesheet",
    lines: [`Your hours on ${date}`, `${start} to ${finish}`, note ? `Note: ${note}` : "No note", "30 minutes lunch comes off a day with a start and finish."],
  };
}

function prepareJobDraft(membership, intent) {
  if (!membership.rulesAdmin) return deny("admin-only");
  const address = cleanText(intent.address, 200, true);
  const client = cleanText(intent.client, 120, true);
  if (!address || !client) return deny("invalid");
  return {
    ok: true,
    action: {
      type: "job-draft",
      tenantId: membership.tenantId,
      client,
      address,
      jobType: JOB_TYPES.includes(intent.jobType) ? intent.jobType : "other",
      description: cleanText(intent.description, 500, true),
      status: "Scheduled",
      createdBy: membership.uid,
    },
    title: "Create a job draft",
    lines: [`Client: ${client}`, `Address: ${address}`, "Status: Scheduled", "No price is set."],
  };
}

function prepareQuoteDraft(membership, intent, name) {
  if (!membership.canSeeMoney) return deny("supervisor-only");
  const address = cleanText(intent.address, 200, true);
  const client = cleanText(intent.client, 120, true);
  if (!address || !client) return deny("invalid");
  return {
    ok: true,
    action: {
      type: "quote-draft",
      tenantId: membership.tenantId,
      client,
      address,
      jobType: JOB_TYPES.includes(intent.jobType) ? intent.jobType : "other",
      description: cleanText(intent.description, 500, true),
      quoteStatus: "Draft",
      totalEx: null,
      createdBy: membership.uid,
      createdByName: name,
    },
    title: "Save a quote draft",
    lines: [`Client: ${client}`, `Address: ${address}`, "Quote status: Draft", "No price is set."],
  };
}

async function prepareChat(membership, intent, reader, name, hideMoney) {
  const text = cleanText(intent.text, CHAT_CAP, hideMoney);
  if (!text) return deny("empty");
  if (intent.where === "staff") {
    return {
      ok: true,
      action: { type: "chat", tenantId: membership.tenantId, threadId: "staff", text, senderUid: membership.uid, senderName: name },
      title: "Post to team chat",
      lines: ["Team chat", `Message: ${text}`],
    };
  }
  const found = await oneJob(reader, membership, intent.jobHint);
  if (!found.ok) return found;
  return {
    ok: true,
    action: {
      type: "chat",
      tenantId: membership.tenantId,
      threadId: "job_" + found.job.id,
      jobId: found.job.id,
      text,
      senderUid: membership.uid,
      senderName: name,
    },
    title: "Post to job chat",
    lines: [`Job: ${found.job.address}`, `Message: ${text}`],
  };
}

async function prepareStatus(membership, intent, reader, name) {
  if (!STATUSES.includes(intent.status)) return deny("not-allowed");
  if (intent.status === "Cancelled" && !membership.rulesAdmin) return deny("admin-only");
  if (!membership.rulesAdmin && intent.status === "Scheduled") return deny("not-allowed");
  const found = await oneJob(reader, membership, intent.jobHint);
  if (!found.ok) return found;
  const current = found.job.status || "Scheduled";
  if (current === "Cancelled") return deny("not-allowed");
  if (intent.status === "In progress" && current !== "Scheduled") return deny("not-allowed");
  if (intent.status === "Done" && current === "Done") return deny("not-allowed");
  if (!membership.rulesAdmin && !["In progress", "Done"].includes(intent.status)) return deny("not-allowed");
  return {
    ok: true,
    action: { type: "job-status", jobId: found.job.id, from: current, status: intent.status, updatedBy: membership.uid, updatedByName: name },
    title: "Update job status",
    lines: [`Job: ${found.job.address}`, `Status: ${current} → ${intent.status}`],
  };
}

export function previewHasMoney(lines) {
  return (lines || []).some(line => /\$\s?\d|poAmount|invoice|totalEx|xero|profit/i.test(String(line)));
}

const EDIT_FIELDS = ["date", "time", "address", "client", "description", "notes"];

async function prepareJobEdit(membership, intent, reader) {
  if (!membership.rulesAdmin) return deny("admin-only");
  if (!EDIT_FIELDS.includes(intent.field)) return deny("not-allowed");
  const found = await oneJob(reader, membership, intent.jobId || intent.jobHint);
  if (!found.ok) return found;
  const value = cleanText(intent.value, intent.field === "description" || intent.field === "notes" ? 500 : 200, true);
  if (!value) return deny("invalid");
  if (intent.field === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return deny("invalid");
  if (intent.field === "time" && !clock(value)) return deny("invalid");
  return {
    ok: true,
    action: { type: "job-edit", jobId: found.job.id, field: intent.field, value: intent.field === "time" ? clock(value) : value, updatedBy: membership.uid },
    title: "Edit a job",
    lines: [`Job: ${found.job.address}`, `${intent.field}: ${value}`, "No price is changed."],
  };
}

async function preparePrestart(membership, intent, reader, name, today) {
  if (!reader || typeof reader.fleet !== "function") return deny("not-allowed");
  const hint = String(intent.assetHint || "").trim().toLowerCase();
  if (hint.length < 2) return deny("invalid");
  const fleet = await reader.fleet({ limit: 80 });
  const rows = (fleet || []).filter(asset => {
    const tenant = asset && asset.tenantId ? asset.tenantId : "heartwood";
    return tenant === membership.tenantId;
  });
  const hits = rows.filter(asset => String(asset.name || "").toLowerCase().includes(hint) || asset.id === intent.assetHint);
  if (hits.length !== 1) return deny(hits.length ? "which-job" : "not-allowed");
  const asset = hits[0];
  const day = intent.day && /^\d{4}-\d{2}-\d{2}$/.test(intent.day) ? intent.day : (/^\d{4}-\d{2}-\d{2}$/.test(today || "") ? today : "");
  if (!day) return deny("invalid");
  const reading = intent.reading === "" || intent.reading == null ? 0 : Number(intent.reading);
  if (!Number.isInteger(reading) || reading < 0 || reading > 10000000) return deny("invalid");
  const kind = ["skid-steer", "excavator", "tip-truck", "ute", "trailer", "other-plant"].includes(asset.prestartKind) ? asset.prestartKind : "other-plant";
  const assetType = asset.type === "trailer" || asset.type === "plant" || asset.type === "vehicle" ? asset.type : "plant";
  return {
    ok: true,
    action: {
      type: "prestart",
      tenantId: membership.tenantId,
      assetId: asset.id,
      assetName: String(asset.name || "Machine").slice(0, 80),
      assetType,
      kind,
      day,
      reading,
      readingUnit: reading ? "hours" : "",
      signerUid: membership.uid,
      signerName: String(name || "Admin").slice(0, 80),
    },
    title: "Start a prestart",
    lines: [`Machine: ${asset.name}`, `Day: ${day}`, "Checklist starts as passed. You can still open it and mark a fail.", "Nothing is saved until you tap Confirm."],
  };
}

function prepareLeave(membership, intent, name) {
  const type = intent.leaveType;
  if (!["annual", "sick", "other"].includes(type)) return deny("invalid");
  const start = String(intent.start || "");
  const end = String(intent.end || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return deny("invalid");
  const startHalf = intent.startHalf || "";
  const endHalf = intent.endHalf || "";
  const same = start === end;
  if (same ? startHalf !== endHalf : !((startHalf === "" || startHalf === "pm") && (endHalf === "" || endHalf === "am"))) return deny("invalid");
  const reason = cleanText(intent.reason, 500, !membership.canSeeMoney);
  if (!reason) return deny("empty");
  const id = /^lv[a-z0-9]{16}$/.test(intent.id || "") ? intent.id : "lv" + randomLeaveId();
  return {
    ok: true,
    action: {
      type: "leave-create",
      id,
      uid: membership.uid,
      name: String(name || "Admin").slice(0, 80),
      leaveType: type,
      start,
      end,
      startHalf,
      endHalf,
      reason,
    },
    title: "Request leave",
    lines: [`${type} leave`, `${start} to ${end}`, `Reason: ${reason}`, "Status: pending"],
  };
}

function randomLeaveId() {
  const alphabet = "abcdef0123456789";
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function prepareLeaveDecision(membership, intent, reader, name) {
  if (!(membership.rulesAdmin || membership.role === "supervisor")) return deny("supervisor-only");
  if (intent.status !== "approved" && intent.status !== "declined") return deny("not-allowed");
  const note = cleanText(intent.note, 500, true);
  if (!note) return deny("empty");
  if (!reader || typeof reader.leaveRequests !== "function") return deny("not-allowed");
  const rows = await reader.leaveRequests({ limit: 80 });
  const hint = String(intent.hint || intent.id || "").trim().toLowerCase();
  const pending = (rows || []).filter(row => row && row.status === "pending" && (row.tenantId || "heartwood") === membership.tenantId);
  const hits = pending.filter(row => row.id === intent.hint || row.id === intent.id || String(row.name || "").toLowerCase().includes(hint));
  if (hits.length !== 1) return deny(hits.length ? "which-job" : "not-allowed");
  const row = hits[0];
  return {
    ok: true,
    action: {
      type: "leave-decision",
      id: row.id,
      status: intent.status,
      note,
      uid: membership.uid,
      name: String(name || "Admin").slice(0, 80),
      who: row.name || "",
    },
    title: intent.status === "approved" ? "Approve leave" : "Decline leave",
    lines: [`${row.name || "Staff"} · ${row.type || "leave"}`, `${row.start} to ${row.end}`, `Note: ${note}`],
  };
}

async function prepareInvite(membership, intent, reader) {
  if (!(membership.rulesAdmin || membership.role === "supervisor")) return deny("supervisor-only");
  const role = String(intent.role || "");
  // Supervisors: labourer, operator or supervisor. Admin invites: rules-admins (Heartwood: fixed list or granted admin).
  const roles = membership.rulesAdmin
    ? ["labourer", "operator", "supervisor", "admin"] : ["labourer", "operator", "supervisor"];
  if (!roles.includes(role)) return deny("not-allowed");
  const email = String(intent.email || "").trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) || email.length > 120) return deny("invalid");
  const name = String(intent.name || "").trim().replace(/ +/g, " ");
  if (!name || name.length > 80 || /[\n\r\t<>]/.test(name)) return deny("invalid");
  if (reader && typeof reader.invites === "function") {
    const rows = await reader.invites({ limit: 40 });
    const pending = (rows || []).some(row => row && row.email === email && row.status === "pending" && (row.tenantId || "heartwood") === membership.tenantId);
    if (pending) return deny("not-allowed");
  }
  const token = /^[A-Za-z0-9_-]{43,128}$/.test(intent.token || "") ? intent.token : randomBytes(32).toString("base64url");
  return {
    ok: true,
    action: { type: "invite", name, email, role, token, tenantId: membership.tenantId, createdBy: membership.uid },
    title: "Invite staff",
    lines: [`${name}`, email, `Role: ${role}`, "No email is sent."],
  };
}
