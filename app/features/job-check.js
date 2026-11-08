// "Check for jobs" on the Jobs tab. Heartwood admins and supervisors only.
// Other companies, test companies, and friend companies do not see the button.
// This module does not talk to Firebase.

import { HEARTWOOD_COMPANY_ID } from "./company.js";

export const CHECKING_TEXT = "Checking emails and portals…";
export const STILL_TEXT = "Still checking, new jobs will appear in the Inbox";
export const JOB_CHECK_WAIT_MS = 15 * 60 * 1000;

export function canRequestJobCheck(person) {
  if (!person || typeof person !== "object") return false;
  if (person.companyId !== HEARTWOOD_COMPANY_ID) return false;
  if (person.isTest === true) return false;
  if (person.plan === "friend" || person.origin === "friend") return false;
  const role = person.role;
  const staffRole = person.staffRole;
  return role === "admin" || role === "supervisor" || staffRole === "admin" || staffRole === "supervisor";
}

function terminalResult(state) {
  if (!state) return false;
  if (state.status !== "done" && state.status !== "error") return false;
  if (typeof state.summary !== "string" || !state.summary.trim()) return false;
  return !!state.finishedAt;
}

export function jobCheckView(state, now) {
  const current = typeof now === "number" ? now : Date.now();
  if (!state) return { message: "", error: false, disabled: false };
  if (terminalResult(state)) {
    return { message: state.summary.trim(), error: state.status === "error", disabled: false };
  }
  const started = typeof state.startedAt === "number" ? state.startedAt : NaN;
  if (Number.isFinite(started) && current - started >= JOB_CHECK_WAIT_MS) {
    return { message: STILL_TEXT, error: false, disabled: false };
  }
  return { message: CHECKING_TEXT, error: false, disabled: true };
}

const KNOWN_FAILURES = new Set([
  "Sign in to check for jobs.",
  "Only a Heartwood admin or supervisor can check for jobs.",
  "A check already started. Try again in a couple of minutes.",
  "Job check is not set up yet.",
  "The check did not start. Try again in a couple of minutes.",
  "Couldn't start the check.",
]);

export function jobCheckFailureText(error) {
  const code = String((error && (error.code || error.status)) || "").toLowerCase().replace(/_/g, "-");
  if (code.includes("resource-exhausted")) return "A check already started. Try again in a couple of minutes.";
  if (code.includes("permission-denied")) return "Only a Heartwood admin or supervisor can check for jobs.";
  if (code.includes("unauthenticated")) return "Sign in to check for jobs.";
  if (code.includes("failed-precondition")) {
    const message = error && error.message;
    if (KNOWN_FAILURES.has(message)) return message;
    return "The check did not start. Try again in a couple of minutes.";
  }
  const message = error && error.message;
  if (KNOWN_FAILURES.has(message)) return message;
  return "Couldn't start the check. Try again shortly.";
}
