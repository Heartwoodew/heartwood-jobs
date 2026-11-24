// Weekday Clock On reminder. Pure selection and copy. clock-on-push.js runs it.
// This is not the 06:00 morning job list (daily-jobs.js) and not the manual
// "turn on location sharing" nudge (location-remind.js). Those do not look at
// clock-on state. Crew, supervisors and managers are included unless they set
// muteClockOnReminder on users/{uid}/chatSettings/prefs. Absence means on.
// The scheduler ticks every 15 minutes. A company is due when its local time
// is 06:30 up to, but not including, 07:00 on Monday to Friday. The claim doc
// clockOnReminders/{companyId}_{date}_{uid} stops a second send that day.

import { appOriginFor } from "./shared/staff-invites.js";
import {
  HEARTWOOD_COMPANY, PUSH_ORIGINS, fcmMessage, logPushException, logPushSend, staleTargets, userCompany,
} from "./chat-push.js";

export { staleTargets, userCompany };

export const DEFAULT_TIME_ZONE = "Australia/Brisbane";
export const CLOCK_ON_TITLE = "Clock On in CallUp";
export const CLOCK_ON_BODY = "Morning! Tap to Clock On for today.";
export const CLOCK_ON_ROLES = Object.freeze(["labourer", "operator", "supervisor", "manager"]);

const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);
const ROLE_SET = new Set(CLOCK_ON_ROLES);
const WINDOW_START = 6 * 60 + 30;
const WINDOW_END = 7 * 60;

export function millisOf(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value.toDate === "function") {
    try {
      const date = value.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && typeof value.seconds === "number") return value.seconds * 1000;
  const n = new Date(value).getTime();
  return Number.isNaN(n) ? null : n;
}

// companies.timezone or companies.timeZone. Anything else, including a blank
// or unknown name, is Australia/Brisbane. No company has a zone stored today.
export function companyTimeZone(company) {
  let raw = "";
  if (company && typeof company === "object") {
    if (typeof company.timezone === "string" && company.timezone.trim()) raw = company.timezone.trim();
    else if (typeof company.timeZone === "string" && company.timeZone.trim()) raw = company.timeZone.trim();
  }
  if (!raw || raw.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(raw)) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function zonedParts(now, timeZone) {
  const date = now instanceof Date ? now : new Date(now);
  const zone = companyTimeZone({ timezone: timeZone });
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = type => {
    const part = parts.find(item => item.type === type);
    return part ? part.value : "";
  };
  let hour = get("hour");
  if (hour === "24") hour = "00";
  const weekday = get("weekday").replace(".", "");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(hour),
    minute: Number(get("minute")),
    weekday,
    timeZone: zone,
  };
}

// Null unless this instant is a weekday and the local clock is in [06:30, 07:00).
// The 15-minute tick at 06:30 and a late tick at 06:45 both qualify. The claim
// doc makes the second one a no-op. 07:00 is the next company's problem, not a second copy.
export function inClockOnWindow(now, timeZone) {
  const parts = zonedParts(now, timeZone);
  if (!WEEKDAYS.has(parts.weekday)) return null;
  if (!Number.isFinite(parts.hour) || !Number.isFinite(parts.minute)) return null;
  const mins = parts.hour * 60 + parts.minute;
  if (mins < WINDOW_START || mins >= WINDOW_END) return null;
  return parts;
}

// Heartwood is never paused. Test companies are skipped even though they can
// still sign in. Archived, suspended, owner-paused, ended trial, ended friend
// plan, and a paid plan that is not billing active/trialing are skipped.
export function companyReminderBlock(company, companyId, now = new Date()) {
  if (!companyId) return "missing";
  if (companyId === HEARTWOOD_COMPANY) return "";
  if (!company || typeof company !== "object") return "missing";
  if (company.isTest === true) return "test";
  if (company.ownerPaused === true) return "paused";
  const status = company.status === "suspended" || company.status === "archived" ? company.status : "active";
  if (status === "archived" || status === "suspended") return "archived";
  const billing = (company.billing && company.billing.status) || "";
  if (billing === "active" || billing === "trialing") return "";
  const plan = company.plan === "paid" || company.plan === "friend" ? company.plan : "trial";
  const at = now instanceof Date ? now.getTime() : Number(now);
  if (plan === "paid") return "paused";
  if (plan === "friend") {
    const end = millisOf(company.friendEndsAt);
    if (end != null && end <= at) return "expired";
    return "";
  }
  const end = millisOf(company.trialEndsAt);
  if (end != null && end <= at) return "expired";
  return "";
}

export function reminderCompanies(docs, now) {
  const list = Array.isArray(docs) ? docs.slice() : [];
  if (!list.some(company => company && company.id === HEARTWOOD_COMPANY)) {
    list.unshift({ id: HEARTWOOD_COMPANY, name: "Heartwood" });
  }
  const out = [];
  const seen = new Set();
  for (const company of list) {
    if (!company || !company.id || seen.has(company.id)) continue;
    seen.add(company.id);
    if (companyReminderBlock(company, company.id, now)) continue;
    const timeZone = companyTimeZone(company);
    const slot = inClockOnWindow(now, timeZone);
    if (!slot) continue;
    out.push({
      id: company.id,
      name: typeof company.name === "string" ? company.name : "",
      timeZone,
      date: slot.date,
      weekday: slot.weekday,
    });
  }
  return out;
}

export function weekStartOf(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
  const date = new Date(iso + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function clockOnRole(profile) {
  const role = profile && typeof profile.role === "string" ? profile.role : "";
  return ROLE_SET.has(role) ? role : "";
}

function entryList(entries) {
  if (!entries) return [];
  return Array.isArray(entries) ? entries.filter(Boolean) : Object.values(entries).filter(Boolean);
}

// Open or on-break clock entry for this local date, or a live clockedOn flag.
// A finished (closed) entry does not count: they are not clocked on.
export function clockedOnAlready(sheet, date, live, companyId, uid) {
  if (live && live.clockedOn === true) {
    const liveCompany = typeof live.companyId === "string" ? live.companyId.trim() : "";
    const liveUid = typeof live.uid === "string" ? live.uid : "";
    if ((!liveCompany || liveCompany === companyId) && (!liveUid || liveUid === uid)) return true;
  }
  return entryList(sheet && sheet.entries).some(entry =>
    entry.source === "clock"
    && (entry.status === "open" || entry.status === "break")
    && String(entry.date || "") === String(date || ""));
}

// Approved leave that covers this morning. An afternoon-only day, or a longer
// request that starts this afternoon, still needs a morning clock on.
export function leaveSkipsClockOn(leaves, person, date) {
  const uid = person && person.uid;
  const companyId = person && person.companyId;
  if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  const hit = (leaves || []).find(leave => {
    if (!leave || leave.status !== "approved" || leave.uid !== uid) return false;
    if (leave.companyId && companyId && leave.companyId !== companyId) return false;
    return String(leave.start || "") <= date && String(leave.end || "") >= date;
  });
  if (!hit) return false;
  if (date === hit.start && date === hit.end && hit.startHalf === "pm") return false;
  if (date === hit.start && date !== hit.end && hit.startHalf === "pm") return false;
  return true;
}

export function clockOnReminderId(companyId, date, uid) {
  const safeUid = String(uid || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
  return `${companyId}_${date}_${safeUid}`.slice(0, 500);
}

export function clockOnOpenUrl(origin, companyId) {
  const clean = String(origin || "").replace(/\/$/, "");
  const base = PUSH_ORIGINS.includes(clean) ? clean : appOriginFor(companyId);
  return String(base).replace(/\/$/, "") + "/app/?open=timesheet";
}

function usableTokens(person, companyId) {
  return (person.tokens || []).filter(token =>
    token && token.companyId === companyId && typeof token.token === "string" && token.token.length >= 20 && token.token.length <= 4096);
}

function messageFor(token, companyId, date) {
  const url = clockOnOpenUrl(token.origin, companyId);
  const content = {
    url,
    data: {
      kind: "clock-on",
      title: CLOCK_ON_TITLE,
      body: CLOCK_ON_BODY,
      url,
      companyId: String(companyId),
      date: String(date),
      tag: "clock-on-" + date,
    },
  };
  return fcmMessage({ token: token.token }, content);
}

export function selectClockOnReminders({ companyId, timeZone, now, people, sheets, live, leaves } = {}) {
  const slot = inClockOnWindow(now, timeZone || DEFAULT_TIME_ZONE);
  if (!slot || !companyId) return [];
  const date = slot.date;
  const out = [];
  for (const person of people || []) {
    if (!person || !person.uid || person.muteClockOnReminder === true) continue;
    if (!clockOnRole(person.profile)) continue;
    if (userCompany(person.profile, person.uid) !== companyId) continue;
    const tokens = usableTokens(person, companyId);
    if (!tokens.length) continue;
    const sheet = sheets && sheets[person.uid];
    const here = live && live[person.uid];
    if (clockedOnAlready(sheet, date, here, companyId, person.uid)) continue;
    if (leaveSkipsClockOn(leaves, { uid: person.uid, companyId }, date)) continue;
    const targets = tokens.map(token => ({
      uid: person.uid,
      tokenId: token.id,
      token: token.token,
      origin: typeof token.origin === "string" ? token.origin : "",
    }));
    out.push({
      id: clockOnReminderId(companyId, date, person.uid),
      companyId,
      date,
      uid: person.uid,
      timeZone: slot.timeZone,
      targets,
      messages: tokens.map(token => messageFor(token, companyId, date)),
    });
  }
  return out;
}

export async function dispatchClockOnReminders({
  now, loadCompanies, loadPeople, loadSheet, loadLive, loadLeave, claim, sendEach, deleteToken,
} = {}) {
  const at = now instanceof Date ? now : new Date(now || Date.now());
  const companies = reminderCompanies(await loadCompanies(), at);
  let sent = 0;
  let skipped = 0;
  let dropped = 0;
  for (const company of companies) {
    const people = typeof loadPeople === "function" ? await loadPeople(company.id) : [];
    const sheets = {};
    const live = {};
    const week = weekStartOf(company.date);
    await Promise.all((people || []).map(async person => {
      if (!person || !person.uid) return;
      try {
        sheets[person.uid] = typeof loadSheet === "function" ? await loadSheet(person.uid, week, company.id) : null;
      } catch {
        sheets[person.uid] = null;
      }
      try {
        live[person.uid] = typeof loadLive === "function" ? await loadLive(company.id, person.uid) : null;
      } catch {
        live[person.uid] = null;
      }
    }));
    let leaves = [];
    try {
      leaves = typeof loadLeave === "function" ? await loadLeave(company.id) : [];
    } catch {
      leaves = [];
    }
    const reminders = selectClockOnReminders({
      companyId: company.id,
      timeZone: company.timeZone,
      now: at,
      people,
      sheets,
      live,
      leaves,
    });
    for (const reminder of reminders) {
      let claimed = false;
      try {
        claimed = typeof claim === "function" ? await claim(reminder) : false;
      } catch (err) {
        logPushException("clock on", err);
        continue;
      }
      if (!claimed) {
        skipped += 1;
        continue;
      }
      try {
        const result = await sendEach(reminder.messages);
        const responses = (result && result.responses) || [];
        logPushSend("clock on", responses, reminder.targets, [company.id, company.date]);
        const stale = staleTargets(responses, reminder.targets);
        for (const target of stale) {
          try {
            if (typeof deleteToken === "function") await deleteToken(target);
          } catch { /* the next morning can try again */ }
        }
        dropped += stale.length;
        sent += 1;
      } catch (err) {
        logPushException("clock on", err);
        console.log("clock on", company.id, company.date, "targets", reminder.targets.length, "sent", 0, "dropped", 0);
      }
    }
  }
  return { sent, skipped, dropped, companies: companies.map(company => company.id) };
}
