// Morning job list. Pure selection and copy. index.js schedules the send.
// A person is told about jobs whose assigned list contains their uid,
// for today's date in Australia/Brisbane, in their own company only.

import { PUSH_ORIGINS, isStaleTokenError, jobCompany, staleTargets, userCompany } from "./chat-push.js";

export { isStaleTokenError, staleTargets };

const PREFIX_RE = /^[A-Z0-9]{1,5}$/;

export function brisbaneDate(now) {
  const date = now instanceof Date ? now : new Date(now);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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
    out.push({
      id: company.id,
      name: typeof company.name === "string" ? company.name : "",
      jobPrefix: typeof company.jobPrefix === "string" ? company.jobPrefix : "",
    });
  }
  if (!sawHeartwood) out.unshift({ id: "heartwood", name: "Heartwood", jobPrefix: "HW" });
  return out;
}

export function jobOpenToday(job, date) {
  if (!job || String(job.date || "") !== String(date || "")) return false;
  const status = String(job.status || "");
  const legacy = String(job.sm8Status || "");
  if (status === "Cancelled" || status === "Done") return false;
  if (legacy === "Unsuccessful" || legacy === "Completed") return false;
  return true;
}

export function jobRef(job, company) {
  const printed = String((job && (job.sm8JobNo || job.jobNo)) || "").replace(/[$]/g, "").trim();
  if (printed) return printed.slice(0, 20);
  const tail = String((job && job.id) || "").slice(-4).toUpperCase() || "JOB";
  let prefix = "HW";
  if (company && company.id && company.id !== "heartwood") {
    const set = String(company.jobPrefix || "").trim().toUpperCase();
    prefix = PREFIX_RE.test(set) ? set : String(company.id).replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "JOB";
  }
  return prefix + "-" + tail;
}

export function jobPlace(job) {
  const suburb = String((job && job.suburb) || "").replace(/[$]/g, "").trim();
  if (suburb) return suburb.slice(0, 40);
  const address = String((job && job.address) || "").replace(/[$]/g, "").trim();
  if (!address) return "No address";
  const parts = address.split(",").map(part => part.trim()).filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  const cleaned = last.replace(/\b(QLD|NSW|VIC|SA|WA|TAS|NT|ACT|Australia)\b/gi, "").replace(/\b\d{4}\b/g, "").trim();
  return (cleaned || address).slice(0, 40);
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
  const fallback = companyId === "heartwood"
    ? "https://jobs.heartwoodew.com"
    : "https://app.callupapp.com.au";
  const base = PUSH_ORIGINS.includes(origin) ? origin : fallback;
  return base + "/app/?jobs=today";
}

export function digestCopy(lines) {
  const count = lines.length;
  const title = count === 1 ? "1 job today" : count + " jobs today";
  const shown = lines.slice(0, 4);
  const extra = count - shown.length;
  const body = (shown.join("\n") + (extra > 0 ? "\n+" + extra + " more" : "")).slice(0, 240);
  return { title, body };
}

function dailyMessage(token, content) {
  return {
    token,
    data: content.data,
    webpush: {
      fcmOptions: { link: content.url },
      notification: {
        title: content.title,
        body: content.body,
        icon: content.icon,
        tag: "jobs-" + content.data.date,
        renotify: true,
      },
    },
  };
}

function copyFor(companyId, date, lines, origin) {
  const text = digestCopy(lines);
  const url = dailyOpenUrl(origin, companyId);
  const icon = new URL(url).origin + "/app/icons/icon-192.png";
  return {
    title: text.title,
    body: text.body,
    url,
    icon,
    data: {
      title: text.title,
      body: text.body,
      url,
      view: "today",
      companyId: String(companyId),
      date: String(date),
    },
  };
}

export function selectDailyDigests({ companyId, date, company, jobs, people }) {
  const open = (jobs || []).filter(job => jobOpenToday(job, date) && jobCompany(job) === companyId);
  const digests = [];
  for (const person of people || []) {
    if (!person || !person.uid || person.push !== true || person.dailyJobs === false) continue;
    if (userCompany(person.profile, person.uid) !== companyId) continue;
    const tokens = (person.tokens || []).filter(token => token && token.companyId === companyId && typeof token.token === "string" && token.token.length >= 20);
    if (!tokens.length) continue;
    const mine = open.filter(job => allocatedTo(job, person.uid) && customerOk(person.profile, job));
    mine.sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")) || String(a.id || "").localeCompare(String(b.id || "")));
    if (!mine.length) continue;
    const lines = mine.map(job => jobRef(job, company) + " · " + jobPlace(job));
    digests.push({
      id: digestDocId(companyId, date, person.uid),
      companyId,
      date,
      uid: person.uid,
      jobIds: mine.map(job => String(job.id || "")),
      targets: tokens.map(token => ({
        uid: person.uid,
        tokenId: token.id,
        token: token.token,
        origin: typeof token.origin === "string" ? token.origin : "",
      })),
      messages: tokens.map(token => dailyMessage(token.token, copyFor(companyId, date, lines, token.origin))),
    });
  }
  return digests;
}

export async function dispatchDailyJobs({ date, loadCompanies, loadJobs, loadPeople, claim, sendEach, deleteToken }) {
  const companies = companiesToScan(await loadCompanies());
  let sent = 0;
  let skipped = 0;
  let dropped = 0;
  for (const company of companies) {
    const [jobs, people] = await Promise.all([
      loadJobs(company.id, date),
      loadPeople(company.id),
    ]);
    const digests = selectDailyDigests({ companyId: company.id, date, company, jobs, people });
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
