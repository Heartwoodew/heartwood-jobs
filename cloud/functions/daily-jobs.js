// Morning job list, and at most one "your jobs changed" note after it.
// Pure selection and copy. push-schedule.js runs this at 06:00 Brisbane.
// A person is told about jobs whose assigned list contains their uid,
// for today's date in Australia/Brisbane, in their own company only.
// Copy is the count and the first stop. No prices.

import {
  HEARTWOOD_COMPANY, PUSH_ORIGINS, isStaleTokenError, jobCompany, jobPlace, staleTargets, userCompany,
} from "./chat-push.js";

export { isStaleTokenError, jobCompany, jobPlace, staleTargets, userCompany };

export function brisbaneDate(now) {
  const date = now instanceof Date ? now : new Date(now);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function jobsDayTitle(date) {
  const parts = String(date || "").split("-");
  if (parts.length !== 3) return "Your jobs for today";
  const dt = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
  if (Number.isNaN(dt.getTime())) return "Your jobs for today";
  const label = new Intl.DateTimeFormat("en-AU", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  }).format(dt).replace(/,/g, "");
  return "Your jobs for " + label;
}

export function jobsDayBody(jobs) {
  const list = jobs || [];
  if (!list.length) return "No jobs left today";
  const place = jobPlace(list[0]) || "No address";
  const count = list.length === 1 ? "1 job" : list.length + " jobs";
  return (count + " · " + place).slice(0, 140);
}

export function companySkipped(company) {
  if (!company) return false;
  if (company.isTest === true) return true;
  return String(company.status || "") === "archived";
}

export function companiesToScan(docs) {
  const list = Array.isArray(docs) ? docs : [];
  const out = [];
  let sawHeartwood = false;
  for (const company of list) {
    if (!company || !company.id) continue;
    if (company.id === "heartwood") sawHeartwood = true;
    if (companySkipped(company)) continue;
    out.push({ id: company.id, name: typeof company.name === "string" ? company.name : "" });
  }
  if (!sawHeartwood) out.unshift({ id: "heartwood", name: "Heartwood" });
  return out;
}

export function jobOpenToday(job, date) {
  if (!job || String(job.date || "") !== String(date || "")) return false;
  const status = String(job.status || "");
  const legacy = String(job.sm8Status || "");
  if (status === "Cancelled" || status === "Done") return false;
  if (legacy === "Unsuccessful" || legacy === "Completed") return false;
  if (job.quoteStatus === "Draft") return false;
  if (job.quoteStatus !== "Accepted" && legacy === "Quote") return false;
  return true;
}

function customerOk(profile, job) {
  const ids = profile && Array.isArray(profile.customerIds)
    ? profile.customerIds.filter(item => typeof item === "string" && item.trim())
    : [];
  if (!ids.length) return true;
  return typeof job.client === "string" && ids.includes(job.client);
}

function allocatedTo(job, uid) {
  return Array.isArray(job.assigned) && job.assigned.includes(uid);
}

export function digestDocId(companyId, date, uid) {
  const safeUid = String(uid || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
  return `${companyId}_${date}_${safeUid}`.slice(0, 500);
}

export function dailyOpenUrl(origin, companyId) {
  const fallback = companyId === HEARTWOOD_COMPANY
    ? "https://jobs.heartwoodew.com"
    : "https://app.callupapp.com.au";
  const base = PUSH_ORIGINS.includes(origin) ? origin : fallback;
  return base + "/app/?jobs=today";
}

function byTime(a, b) {
  return String(a.time || "").localeCompare(String(b.time || "")) || String(a.id || "").localeCompare(String(b.id || ""));
}

// Approved run sheet order when we have one. Otherwise the day's start times.
export function orderNoticeJobs(jobs, sheet) {
  const rows = (jobs || []).slice();
  const approved = sheet && sheet.status === "approved" && Array.isArray(sheet.jobIds) && sheet.jobIds.length;
  if (!approved) return rows.sort(byTime);
  const rank = new Map(sheet.jobIds.map((id, i) => [id, i]));
  return rows.sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : 100000;
    const rb = rank.has(b.id) ? rank.get(b.id) : 100000;
    if (ra !== rb) return ra - rb;
    return byTime(a, b);
  });
}

export function sheetForCompany(sheet, companyId) {
  if (!sheet || sheet.status !== "approved" || !Array.isArray(sheet.jobIds)) return null;
  const company = typeof sheet.companyId === "string" ? sheet.companyId.trim() : "";
  if (!company) return companyId === HEARTWOOD_COMPANY ? sheet : null;
  return company === companyId ? sheet : null;
}

export function dayFingerprint(jobs) {
  return orderNoticeJobs(jobs).map(job => [job.id, job.time || "", jobPlace(job), job.status || ""].join("~")).join("|");
}

function dailyMessage(token, content) {
  return {
    token,
    data: content.data,
    webpush: { fcmOptions: { link: content.url } },
  };
}

function copyFor(companyId, date, jobs, origin, kind) {
  const title = kind === "update" ? "Your jobs changed" : jobsDayTitle(date);
  const body = jobsDayBody(jobs);
  const url = dailyOpenUrl(origin, companyId);
  const tag = kind === "update" ? "jobs-" + date + "-changed" : "jobs-" + date;
  return {
    title,
    body,
    url,
    data: {
      kind: kind === "update" ? "jobs-update" : "jobs",
      title,
      body,
      url,
      view: "today",
      companyId: String(companyId),
      date: String(date),
      tag,
    },
  };
}

function usableTokens(person, companyId) {
  return (person.tokens || []).filter(token => token && token.companyId === companyId && typeof token.token === "string" && token.token.length >= 20);
}

export function jobsForPerson(jobs, uid, profile, companyId, date, sheet) {
  const open = (jobs || []).filter(job => jobOpenToday(job, date) && jobCompany(job) === companyId && allocatedTo(job, uid) && customerOk(profile, job));
  return orderNoticeJobs(open, sheet);
}

export function selectDailyDigests({ companyId, date, jobs, people }) {
  const digests = [];
  for (const person of people || []) {
    if (!person || !person.uid || person.muteDaily === true) continue;
    if (userCompany(person.profile, person.uid) !== companyId) continue;
    const tokens = usableTokens(person, companyId);
    if (!tokens.length) continue;
    const mine = jobsForPerson(jobs, person.uid, person.profile, companyId, date, sheetForCompany(person.sheet, companyId));
    if (!mine.length) continue;
    const fingerprint = dayFingerprint(mine);
    digests.push({
      id: digestDocId(companyId, date, person.uid),
      companyId,
      date,
      uid: person.uid,
      jobIds: mine.map(job => String(job.id || "")),
      fingerprint,
      targets: tokens.map(token => ({
        uid: person.uid,
        tokenId: token.id,
        token: token.token,
        origin: typeof token.origin === "string" ? token.origin : "",
      })),
      messages: tokens.map(token => dailyMessage(token.token, copyFor(companyId, date, mine, token.origin, "morning"))),
    });
  }
  return digests;
}

export async function dispatchDailyJobs({ date, loadCompanies, loadJobs, loadPeople, loadRunSheet, claim, sendEach, deleteToken }) {
  const companies = companiesToScan(await loadCompanies());
  let sent = 0;
  let skipped = 0;
  let dropped = 0;
  for (const company of companies) {
    const [jobs, people] = await Promise.all([
      loadJobs(company.id, date),
      loadPeople(company.id),
    ]);
    if (loadRunSheet) {
      await Promise.all((people || []).map(async person => {
        if (!person || !person.uid) return;
        try { person.sheet = await loadRunSheet(person.uid, date, company.id); }
        catch { person.sheet = null; }
      }));
    }
    const digests = selectDailyDigests({ companyId: company.id, date, jobs, people });
    for (const digest of digests) {
      const claimed = await claim(digest);
      if (!claimed) {
        skipped += 1;
        continue;
      }
      try {
        const result = await sendEach(digest.messages);
        const stale = staleTargets(result && result.responses, digest.targets);
        for (const target of stale) {
          try { await deleteToken(target); } catch { /* the next morning can try again */ }
        }
        dropped += stale.length;
        sent += 1;
      } catch {
        // The claim is already stored, so a retry will not send a second copy.
      }
    }
  }
  return { sent, skipped, dropped };
}

// Notes, prices and diary text do not count. Only the day's shape does.
export function scheduleFieldsChanged(before, after) {
  const pick = job => !job ? "" : [
    job.date, job.status, job.sm8Status, job.quoteStatus, job.time, job.address, job.suburb,
    job.companyId, job.tenantId, Array.isArray(job.assigned) ? job.assigned.join(",") : "",
  ].join("|");
  return pick(before) !== pick(after);
}

export function affectedUids(before, after, date, companyId) {
  const ids = new Set();
  for (const job of [before, after]) {
    if (!job || jobCompany(job) !== companyId || String(job.date || "") !== String(date || "")) continue;
    const assigned = Array.isArray(job.assigned) ? job.assigned : [];
    for (const uid of assigned) if (typeof uid === "string" && uid) ids.add(uid);
  }
  return [...ids];
}

export function updateDecision({ existing, fingerprint, muteDaily }) {
  if (muteDaily) return "muted";
  if (!existing) return "before-morning";
  if (existing.updateSent === true) return "already";
  if (existing.fingerprint === fingerprint) return "same";
  return "send";
}

export async function dispatchDailyChange({ companyId, date, uid, jobs, person, existing, claimUpdate, sendEach, deleteToken }) {
  if (!person || !uid || userCompany(person.profile, uid) !== companyId) return { sent: 0, skipped: "company" };
  if (person.muteDaily === true) return { sent: 0, skipped: "muted" };
  const tokens = usableTokens(person, companyId);
  if (!tokens.length) return { sent: 0, skipped: "token" };
  const mine = jobsForPerson(jobs, uid, person.profile, companyId, date, sheetForCompany(person.sheet, companyId));
  const fingerprint = dayFingerprint(mine);
  const decision = updateDecision({ existing, fingerprint, muteDaily: false });
  if (decision !== "send") return { sent: 0, skipped: decision };
  const claimed = await claimUpdate({
    id: digestDocId(companyId, date, uid),
    fingerprint,
    jobIds: mine.map(job => String(job.id || "")),
  });
  if (!claimed) return { sent: 0, skipped: "claim" };
  const targets = tokens.map(token => ({
    uid, tokenId: token.id, token: token.token, origin: typeof token.origin === "string" ? token.origin : "",
  }));
  const messages = targets.map(target => dailyMessage(target.token, copyFor(companyId, date, mine, target.origin, "update")));
  try {
    const result = await sendEach(messages);
    const stale = staleTargets(result && result.responses, targets);
    for (const target of stale) {
      try { await deleteToken(target); } catch { /* next change can try again */ }
    }
    const failed = ((result && result.responses) || []).filter(row => row && row.success === false).length;
    return { sent: Math.max(0, targets.length - failed), dropped: stale.length, skipped: "" };
  } catch {
    return { sent: 0, dropped: 0, skipped: "send" };
  }
}
