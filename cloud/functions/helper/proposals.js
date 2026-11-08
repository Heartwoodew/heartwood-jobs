// Propose, confirm, and cancel. Confirm is the only step that changes a job,
// timesheet, quote, or chat. Cancel changes the proposal status and nothing else.

import { randomBytes } from "node:crypto";
import { PROPOSAL_TTL_MS, intentFromQuestion, prepareAction } from "./actions.js";

export const CONFIRM_REPLY = "Saved. That change is in CallUp now.";
export const CANCEL_REPLY = "Cancelled. Nothing was changed.";
export const PREVIEW_REPLY = "Here's what I'll change. Nothing is saved until you tap Confirm.";

function proposalId() {
  return "hp_" + randomBytes(9).toString("hex");
}

function publicProposal(proposal) {
  return { id: proposal.id, title: proposal.title, lines: proposal.lines };
}

export async function proposeHelperAction({ membership, question, action, reader, store, name, now }) {
  if (!store) return { ok: false, reply: "I couldn't prepare that. Nothing was changed." };
  const intent = action || intentFromQuestion(question);
  if (!intent) return { ok: false, reply: "Tell me the change in one sentence and I'll show a preview." };
  const at = (now instanceof Date ? now : new Date(now || Date.now())).toLocaleString("en-AU", {
    timeZone: "Australia/Brisbane", dateStyle: "short", timeStyle: "short",
  });
  const prepared = await prepareAction({
    membership, intent, reader, name, at, today: dayOf(now),
  });
  if (!prepared.ok) {
    const reply = prepared.reason === "supervisor-only"
      ? "That one is for a supervisor or admin. Nothing was changed."
      : prepared.reason === "admin-only"
        ? "Only an admin can do that. Nothing was changed."
        : "I can't do that on your login. Nothing was changed.";
    return { ok: false, reply };
  }
  const proposal = {
    id: proposalId(),
    uid: membership.uid,
    tenantId: membership.tenantId,
    status: "pending",
    createdAtMs: (now instanceof Date ? now : new Date(now || Date.now())).getTime(),
    title: prepared.title,
    lines: prepared.lines,
    action: prepared.action,
  };
  await store.saveProposal(proposal);
  return { ok: true, reply: PREVIEW_REPLY, proposal: publicProposal(proposal) };
}

export async function confirmHelperAction({ membership, proposalId, reader, store, now, name }) {
  if (!store || !proposalId) return { ok: true, reply: "Nothing was changed." };
  const proposal = await store.getProposal(proposalId);
  if (!proposal || proposal.uid !== membership.uid || proposal.tenantId !== membership.tenantId) {
    return { ok: true, reply: "That preview isn't yours. Nothing was changed." };
  }
  if (proposal.status !== "pending") return { ok: true, reply: "That preview is already closed. Nothing new was changed." };
  const clock = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
  if (clock - proposal.createdAtMs > PROPOSAL_TTL_MS) {
    await store.markProposal(proposal.id, { status: "expired" });
    return { ok: true, reply: "That preview expired. Nothing was changed." };
  }
  const prepared = await prepareAction({
    membership,
    intent: intentFromStored(proposal.action),
    reader,
    name,
    at: proposal.action.at,
    today: dayOf(now),
  });
  if (!prepared.ok || prepared.action.type !== proposal.action.type) {
    await store.markProposal(proposal.id, { status: "denied" });
    return { ok: true, reply: "You can't do that any more. Nothing was changed." };
  }
  if (proposal.action.jobId && prepared.action.jobId !== proposal.action.jobId) {
    await store.markProposal(proposal.id, { status: "denied" });
    return { ok: true, reply: "That job isn't yours to change. Nothing was changed." };
  }
  await store.apply(prepared.action, { uid: membership.uid, name, tenantId: membership.tenantId });
  await store.markProposal(proposal.id, { status: "confirmed", confirmedAtMs: clock });
  await store.audit({
    uid: membership.uid,
    name,
    tenantId: membership.tenantId,
    action: prepared.action.type,
    summary: proposal.lines.join(" · "),
    at: new Date(clock).toISOString(),
    via: "helper",
    proposalId: proposal.id,
  });
  return { ok: true, reply: CONFIRM_REPLY };
}

function intentFromStored(action) {
  if (!action) return null;
  if (action.type === "job-note") return { type: "job-note", jobHint: action.jobId, text: action.text, jobId: action.jobId };
  if (action.type === "timesheet") return { type: "timesheet", date: action.date, start: action.start, finish: action.finish, note: action.note };
  if (action.type === "job-draft") return { type: "job-draft", address: action.address, client: action.client, description: action.description, jobType: action.jobType };
  if (action.type === "quote-draft") return { type: "quote-draft", address: action.address, client: action.client, description: action.description, jobType: action.jobType };
  if (action.type === "chat" && action.threadId === "staff") return { type: "chat", where: "staff", text: action.text };
  if (action.type === "chat") return { type: "chat", where: "job", jobHint: action.jobId, text: action.text, jobId: action.jobId };
  if (action.type === "job-status") return { type: "job-status", jobHint: action.jobId, status: action.status, jobId: action.jobId };
  if (action.type === "job-edit") return { type: "job-edit", jobHint: action.jobId, jobId: action.jobId, field: action.field, value: action.value };
  if (action.type === "prestart") return { type: "prestart", assetHint: action.assetId, day: action.day, reading: String(action.reading ?? "") };
  if (action.type === "leave-create") return { type: "leave-create", id: action.id, leaveType: action.leaveType, start: action.start, end: action.end, startHalf: action.startHalf, endHalf: action.endHalf, reason: action.reason };
  if (action.type === "leave-decision") return { type: "leave-decision", id: action.id, hint: action.id, status: action.status, note: action.note };
  if (action.type === "invite") return { type: "invite", name: action.name, email: action.email, role: action.role, token: action.token };
  return null;
}

function dayOf(now) {
  const date = now instanceof Date ? now : new Date(now || Date.now());
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export async function cancelHelperAction({ membership, proposalId, store }) {
  if (!store || !proposalId) return { ok: true, reply: CANCEL_REPLY };
  const proposal = await store.getProposal(proposalId);
  if (!proposal || proposal.uid !== membership.uid) return { ok: false, reply: "That preview isn't yours. Nothing was changed." };
  if (proposal.status === "pending") await store.markProposal(proposal.id, { status: "cancelled" });
  return { ok: true, reply: CANCEL_REPLY };
}
