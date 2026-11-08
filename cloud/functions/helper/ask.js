// Read-only Helper turn.
// The callable wrapper verifies the Firebase ID token, then this loads
// users/{uid} and decides jobs with the server profile. Client role, tenant
// and job lists are ignored.

import { ALEX_UID, PATRICK_UID, resolveMembership } from "../shared/cloud-storage.js";
import { buildHelperContext } from "./context.js";
import { loadKnowledge } from "./knowledge.js";
import { buildHelperPrompt, sanitiseReply } from "./prompt.js";

export const QUESTION_CAP = 2000;
export const DISABLED_REPLY = "Helper is switched off, so I didn't ask a model. Nothing was changed.";
export const DENIED_REPLY = "You don't have access to Helper.";
export const SIGN_IN_REPLY = "Sign in to use Helper.";
export const BAD_QUESTION = "Type a question, up to 2000 characters.";
export const MODEL_FAILED = "I couldn't get an answer just then. Nothing was changed.";

export function brisbaneToday(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function displayName(uid, profile) {
  if (profile && typeof profile.name === "string" && profile.name.trim()) return profile.name.trim().slice(0, 80);
  if (uid === ALEX_UID) return "Alex";
  if (uid === PATRICK_UID) return "Patrick";
  return "there";
}

export async function authorizeCallable(request, verify) {
  const header = String(request?.authorization || request?.rawRequest?.headers?.authorization || "");
  const match = /^Bearer\s+(\S+)$/.exec(header);
  if (!match) return { ok: false, code: "unauthenticated", reply: SIGN_IN_REPLY };
  const token = match[1];
  if (token.length < 20 || token.length > 10000) return { ok: false, code: "unauthenticated", reply: SIGN_IN_REPLY };
  let decoded;
  try {
    decoded = await verify(token);
  } catch {
    return { ok: false, code: "unauthenticated", reply: SIGN_IN_REPLY };
  }
  if (!decoded || typeof decoded.uid !== "string" || !decoded.uid) {
    return { ok: false, code: "unauthenticated", reply: SIGN_IN_REPLY };
  }
  if (request.auth && request.auth.uid && request.auth.uid !== decoded.uid) {
    return { ok: false, code: "unauthenticated", reply: SIGN_IN_REPLY };
  }
  return { ok: true, uid: decoded.uid };
}

export async function handleHelperAsk({
  auth, data, reader, model, enabled = false, now, knowledge, canary,
} = {}) {
  if (!auth || !auth.uid) return { ok: false, code: "unauthenticated", reply: SIGN_IN_REPLY };
  const profile = reader ? await reader.user(auth.uid) : null;
  const membership = resolveMembership({
    uid: auth.uid,
    profile,
    requestedTenantId: data && data.tenantId,
    requestedBusinessId: data && data.businessId,
  });
  if (!membership.ok) return { ok: false, code: "permission-denied", reply: DENIED_REPLY };
  const pack = knowledge || loadKnowledge();
  if (!enabled) {
    return { ok: true, enabled: false, reply: DISABLED_REPLY, knowledge: pack.source };
  }
  const question = typeof data?.question === "string" ? data.question.trim() : "";
  if (!question || question.length > QUESTION_CAP) {
    return { ok: false, code: "invalid-argument", reply: BAD_QUESTION };
  }
  const today = brisbaneToday(now || new Date());
  const context = await buildHelperContext({
    reader,
    membership,
    question,
    jobId: typeof data?.jobId === "string" ? data.jobId : "",
    today,
  });
  const prompt = buildHelperPrompt({
    name: displayName(auth.uid, profile),
    role: membership.role,
    tenantId: membership.tenantId,
    canSeeMoney: membership.canSeeMoney,
    finance: membership.finance,
    today,
    knowledge: pack,
    context,
    question,
    canary,
  });
  let raw = "";
  try {
    raw = await model.generate({ system: prompt.system, user: prompt.user });
  } catch {
    return { ok: true, enabled: true, reply: MODEL_FAILED, knowledge: pack.source };
  }
  return {
    ok: true,
    enabled: true,
    reply: sanitiseReply(raw, { canary: prompt.canary, canSeeMoney: membership.canSeeMoney }),
    knowledge: pack.source,
  };
}
