// What Helper is allowed to prepare.
// A proposal is not a write. Job notes are never parsed for actions.
// Prices, email, deletes, Xero, roles and Storage are not actions.

import { canSeeJob } from "../shared/cloud-storage.js";
import { redactMoneyText } from "./money.js";

export const PROPOSAL_TTL_MS = 30 * 60 * 1000;
export const NOTE_CAP = 2000;
export const CHAT_CAP = 4000;
const STATUSES = ["Scheduled", "In progress", "Done", "Cancelled"];
const JOB_TYPES = ["spoil", "backslab", "waterproof", "clean", "other"];

const BLOCKED = /email|sms|delete|xero|invoice|payment|reimburse|invite|role|storage|receipt|profit/i;

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

export async function prepareAction({ membership, intent, reader, name, at }) {
  if (!membership?.ok || !intent || BLOCKED.test(intent.type || "")) return deny("not-allowed");
  const hideMoney = !membership.canSeeMoney;
  if (intent.type === "job-note") return prepareNote(membership, intent, reader, name, at, hideMoney);
  if (intent.type === "timesheet") return prepareTimesheet(membership, intent, hideMoney);
  if (intent.type === "job-draft") return prepareJobDraft(membership, intent);
  if (intent.type === "quote-draft") return prepareQuoteDraft(membership, intent, name);
  if (intent.type === "chat") return prepareChat(membership, intent, reader, name, hideMoney);
  if (intent.type === "job-status") return prepareStatus(membership, intent, reader, name);
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
  if (!membership.canSeeMoney) return deny("supervisor-only");
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
