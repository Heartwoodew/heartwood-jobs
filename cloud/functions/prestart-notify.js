// Prestart prompt when someone is put on a machine.
// Two shapes exist in CallUp, and both are checked:
//   1. A job's plant (machines / plant / quote.machines) with the assigned crew.
//      An explicit uid + machine row on the job wins for that person.
//   2. A machine-to-staff link: operatorUid (or assignedUid / staffUid) on a fleet
//      asset, or the machine saved on that person's timesheet entry.
// The Cloud Function sends one push and writes one in-app notice. Saving the
// same pairing again does not send another. A prestart already stored for that
// machine on that day, or for that job, is left alone. No prices are copied.

import {
  HEARTWOOD_COMPANY, PUSH_ORIGINS, fcmMessage, jobCompany, jobPlace, logPushException, logPushSend, staleTargets, userCompany,
} from "./chat-push.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_IDS = new Set(["skid-steer", "excavator", "tip-truck", "ute", "trailer", "other-plant"]);
const PLANT_KIND = Object.freeze({
  truck: "tip-truck",
  skid: "skid-steer",
  excavator: "excavator",
  "skid-steer": "skid-steer",
  "tip-truck": "tip-truck",
  ute: "ute",
  trailer: "trailer",
  "other-plant": "other-plant",
});
const PLANT_LABEL = Object.freeze({
  truck: "Truck",
  skid: "Skid steer",
  excavator: "Excavator",
  "skid-steer": "Skid steer",
  "tip-truck": "Tip truck",
  ute: "Ute",
  trailer: "Trailer",
  "other-plant": "Plant",
});
const PAIR_KEYS = ["assignments", "machineAssignments", "plantAssignments", "staffMachines"];
const OPERATOR_KEYS = ["operatorUid", "assignedUid", "staffUid", "assignedOperator"];
const MONEY_RE = /\$\s?\d[\d,]*(?:\.\d+)?/g;

function scrub(value) {
  return String(value || "").replace(MONEY_RE, "").replace(/\s+/g, " ").trim();
}

function textList(value) {
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") return String(item.id || item.assetId || item.machineId || "").trim();
      return "";
    }).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function closedJob(job) {
  if (!job) return true;
  const status = String(job.status || "");
  const legacy = String(job.sm8Status || "");
  if (status === "Cancelled" || status === "Done") return true;
  if (legacy === "Unsuccessful" || legacy === "Completed") return true;
  if (job.quoteStatus === "Draft") return true;
  return false;
}

export function prestartEnabled(company) {
  if (!company) return true;
  if (company.prestart === false) return false;
  if (company.features && company.features.prestart === false) return false;
  return true;
}

export function assetKindOf(asset) {
  const chosen = asset && asset.prestartKind;
  if (KIND_IDS.has(chosen)) return chosen;
  if (asset && asset.type === "trailer") return "trailer";
  if (asset && asset.type === "plant") return "other-plant";
  return "ute";
}

function plantIds(job) {
  const quote = job && job.quote && typeof job.quote === "object" ? job.quote.machines : [];
  return [...new Set([
    ...textList(job && job.machines),
    ...textList(job && job.plant),
    ...textList(job && job.machine),
    ...textList(job && job.machineIds),
    ...textList(job && job.assetId),
    ...textList(job && job.assetIds),
    ...textList(quote),
  ])];
}

function explicitPairs(job, companyId, day) {
  const out = [];
  for (const key of PAIR_KEYS) {
    const rows = Array.isArray(job && job[key]) ? job[key] : [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const uid = String(row.uid || row.operatorUid || row.staffUid || row.assignedUid || "").trim();
      const machineId = String(row.assetId || row.machineId || row.plantId || "").trim();
      const rowDay = String(row.day || day || "");
      if (!uid || !machineId || !DAY_RE.test(rowDay)) continue;
      out.push({
        uid,
        companyId,
        day: rowDay,
        machineId,
        machineName: scrub(row.machineName || row.assetName || row.name),
        jobId: String(job.id || ""),
        job,
        source: "pair",
      });
    }
  }
  return out;
}

export function jobAssignments(job) {
  if (!job || closedJob(job)) return [];
  const day = String(job.date || "");
  if (!DAY_RE.test(day)) return [];
  const companyId = jobCompany(job);
  if (!companyId) return [];
  const explicit = explicitPairs(job, companyId, day);
  const named = new Set(explicit.map(row => row.uid));
  const uids = textList(job.assigned).filter(uid => !named.has(uid));
  const machines = plantIds(job);
  const broad = [];
  for (const uid of uids) {
    for (const machineId of machines) {
      broad.push({
        uid,
        companyId,
        day,
        machineId,
        machineName: "",
        jobId: String(job.id || ""),
        job,
        source: "job",
      });
    }
  }
  return [...explicit, ...broad];
}

function pairKey(row) {
  return [row.companyId, row.uid, row.day, row.machineId, row.jobId || "", row.source].join("|");
}

export function changedJobAssignments(before, after) {
  const prev = new Set(jobAssignments(before).map(pairKey));
  return jobAssignments(after).filter(row => !prev.has(pairKey(row)));
}

function operatorOf(asset) {
  if (!asset) return "";
  for (const key of OPERATOR_KEYS) {
    const value = asset[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function changedAssetAssignments(before, after, { assetId, companyId, day } = {}) {
  const next = operatorOf(after);
  if (!next || next === operatorOf(before)) return [];
  if (!DAY_RE.test(String(day || "")) || !companyId) return [];
  return [{
    uid: next,
    companyId,
    day,
    machineId: String(assetId || (after && after.id) || ""),
    machineName: scrub(after && after.name),
    jobId: "",
    job: null,
    source: "asset",
  }];
}

function entryMachines(sheet) {
  const out = new Map();
  const entries = sheet && sheet.entries && typeof sheet.entries === "object" ? sheet.entries : {};
  for (const entry of Object.values(entries)) {
    if (!entry || typeof entry !== "object") continue;
    const machineId = String(entry.machineId || "").trim();
    if (entry.machineChoice && entry.machineChoice !== "asset") continue;
    if (!machineId || !DAY_RE.test(String(entry.date || ""))) continue;
    out.set(String(entry.id || machineId), {
      machineId,
      machineName: scrub(entry.machineName),
      date: String(entry.date),
      job: scrub(entry.job),
    });
  }
  return out;
}

export function sheetCompany(sheet) {
  if (!sheet) return "";
  const company = typeof sheet.companyId === "string" ? sheet.companyId.trim() : "";
  if (company) return company;
  const tenant = typeof sheet.tenantId === "string" ? sheet.tenantId.trim() : "";
  if (tenant) return tenant;
  return HEARTWOOD_COMPANY;
}

export function changedTimesheetAssignments(before, after, uid) {
  if (!after || !uid) return [];
  if (after.uid && after.uid !== uid) return [];
  const companyId = sheetCompany(after);
  const prev = entryMachines(before);
  const out = [];
  for (const [id, row] of entryMachines(after)) {
    const old = prev.get(id);
    if (old && old.machineId === row.machineId && old.date === row.date) continue;
    out.push({
      uid,
      companyId,
      day: row.date,
      machineId: row.machineId,
      machineName: row.machineName,
      jobId: "",
      job: null,
      jobLabel: row.job,
      source: "timesheet",
    });
  }
  return out;
}

export function resolveMachine(machineId, machineName, assets) {
  const id = String(machineId || "").trim();
  const name = scrub(machineName).toLowerCase();
  const list = (assets || []).filter(asset => asset && asset.id);
  const byId = list.find(asset => asset.id === id);
  if (byId) {
    return { assetId: byId.id, assetName: scrub(byId.name) || "Machine", kind: assetKindOf(byId), ambiguous: false };
  }
  if (name) {
    const byName = list.filter(asset => scrub(asset.name).toLowerCase() === name);
    if (byName.length === 1) {
      return { assetId: byName[0].id, assetName: scrub(byName[0].name) || "Machine", kind: assetKindOf(byName[0]), ambiguous: false };
    }
  }
  const kind = PLANT_KIND[id] || "";
  const label = PLANT_LABEL[id] || scrub(machineName) || "Machine";
  if (kind) {
    const matches = list.filter(asset => assetKindOf(asset) === kind)
      .sort((a, b) => scrub(a.name).localeCompare(scrub(b.name), "en-AU"));
    if (matches.length === 1) {
      return { assetId: matches[0].id, assetName: scrub(matches[0].name) || label, kind, ambiguous: false };
    }
    if (matches.length > 1) {
      return { assetId: matches[0].id, assetName: label, kind, ambiguous: true };
    }
    return { assetId: "", assetName: label, kind, ambiguous: true };
  }
  return { assetId: id, assetName: label, kind: "", ambiguous: false };
}

export function prestartCovers(records, target) {
  const assetId = String(target && target.assetId || "");
  const kind = String(target && target.kind || "");
  const day = String(target && target.day || "");
  const jobId = String(target && target.jobId || "");
  const ambiguous = !!(target && (target.ambiguous === true || !assetId));
  return (records || []).some(row => {
    if (!row) return false;
    const sameMachine = (assetId && row.assetId === assetId) || (ambiguous && kind && row.kind === kind);
    if (!sameMachine) return false;
    if (day && row.day === day) return true;
    if (jobId && (row.jobId === jobId || row.job === jobId)) return true;
    return false;
  });
}

export function auDay(iso) {
  const parts = String(iso || "").split("-");
  if (parts.length !== 3) return String(iso || "");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[+parts[1] - 1];
  return month ? `${+parts[2]} ${month}` : String(iso || "");
}

export function assignmentWhen(row) {
  const date = auDay(row && row.day);
  if (row && row.job) {
    const place = scrub(jobPlace(row.job));
    const client = scrub(row.job.client);
    const who = place || client;
    if (who && date) return `${who} / ${date}`;
    return who || date || "today";
  }
  const label = scrub(row && row.jobLabel);
  if (label && date) return `${label} / ${date}`;
  return label || date || "today";
}

export function prestartSentence(machine, when) {
  const name = scrub(machine).slice(0, 80) || "Machine";
  const slot = scrub(when).slice(0, 80) || "today";
  const sentence = `Prestart needed: ${name} for ${slot}. Tap to complete.`;
  if (sentence.length <= 180) return sentence;
  const tail = ". Tap to complete.";
  return sentence.slice(0, 180 - tail.length).trimEnd() + tail;
}

// A date before today in Australia/Brisbane is history: back-filling a timesheet
// or editing an old job must not push or write a notice. Today and later still do.
export function dueAssignments(assignments, today) {
  const day = String(today || "");
  if (!DAY_RE.test(day)) return [];
  return (assignments || []).filter(row => row && DAY_RE.test(String(row.day || "")) && String(row.day) >= day);
}

export function noticeDocId(companyId, day, key) {
  const raw = `${companyId}_${day}_${key}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 400) || "prestart";
}

export function prestartOpenUrl(origin, companyId, { assetId, kind, day, jobId } = {}) {
  const fallback = companyId === HEARTWOOD_COMPANY
    ? "https://jobs.heartwoodew.com"
    : "https://app.callupapp.com.au";
  const base = PUSH_ORIGINS.includes(origin) ? origin : fallback;
  const params = new URLSearchParams();
  params.set("prestart", assetId || "1");
  if (kind) params.set("kind", kind);
  if (day) params.set("day", day);
  if (jobId) params.set("psjob", jobId);
  return `${base}/app/?${params.toString()}`;
}

function tokensFor(person, companyId) {
  return (person.tokens || []).filter(token => token && token.companyId === companyId && typeof token.token === "string" && token.token.length >= 20);
}

export function buildPrestartNotices({ companyId, assignments, assets, prestarts, people, enabled }) {
  if (!enabled || !companyId) return [];
  const byUid = new Map((people || []).filter(person => person && person.uid).map(person => [person.uid, person]));
  const notices = [];
  const seen = new Set();
  for (const row of assignments || []) {
    if (!row || row.companyId !== companyId || !row.uid || !DAY_RE.test(row.day || "")) continue;
    const person = byUid.get(row.uid);
    if (!person || userCompany(person.profile, person.uid) !== companyId) continue;
    if (row.source === "job" && person.profile && person.profile.role === "labourer") continue;
    const resolved = resolveMachine(row.machineId, row.machineName, assets);
    if (prestartCovers(prestarts, { ...resolved, day: row.day, jobId: row.jobId || "" })) continue;
    const key = resolved.ambiguous || !resolved.assetId ? `kind:${resolved.kind || row.machineId || "machine"}` : resolved.assetId;
    const id = noticeDocId(companyId, row.day, key);
    const dedupe = `${row.uid}|${id}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const when = assignmentWhen(row);
    const sentence = prestartSentence(resolved.assetName, when);
    const targets = tokensFor(person, companyId).map(token => ({
      uid: row.uid,
      tokenId: token.id,
      token: token.token,
      origin: typeof token.origin === "string" ? token.origin : "",
    }));
    const messages = targets.map(target => {
      const url = prestartOpenUrl(target.origin, companyId, {
        assetId: resolved.assetId, kind: resolved.kind, day: row.day, jobId: row.jobId || "",
      });
      return fcmMessage(target, {
        url,
        data: {
          kind: "prestart",
          title: "Prestart needed",
          body: sentence,
          url,
          assetId: resolved.assetId || "",
          prestartKind: resolved.kind || "",
          day: row.day,
          jobId: row.jobId || "",
          companyId,
          tag: `prestart-${id}`,
        },
      });
    });
    notices.push({
      id,
      uid: row.uid,
      companyId,
      day: row.day,
      assetId: resolved.assetId || "",
      assetName: resolved.assetName,
      kind: resolved.kind || "",
      ambiguous: resolved.ambiguous === true,
      jobId: row.jobId || "",
      jobLabel: when,
      body: sentence,
      source: row.source || "job",
      targets,
      messages,
    });
  }
  return notices;
}

export async function deliverPrestartNotices({ notices, claim, sendEach, deleteToken }) {
  let sent = 0;
  let noticed = 0;
  let skipped = 0;
  let dropped = 0;
  for (const notice of notices || []) {
    const fresh = await claim(notice);
    if (!fresh) {
      skipped += 1;
      continue;
    }
    noticed += 1;
    if (!notice.messages || !notice.messages.length) continue;
    try {
      const result = await sendEach(notice.messages);
      const responses = (result && result.responses) || [];
      logPushSend("prestart", responses, notice.targets, [notice.companyId, notice.day]);
      const drop = staleTargets(responses, notice.targets);
      for (const target of drop) {
        try { await deleteToken(target); } catch { /* the next send tries again */ }
      }
      dropped += drop.length;
      const failed = responses.filter(row => row && row.success === false).length;
      sent += Math.max(0, notice.messages.length - failed);
    } catch (err) {
      // The notice is the in-app fallback. A later save of the same pairing does not push again.
      logPushException("prestart", err);
      console.log("prestart", notice.companyId, notice.day, "targets", (notice.targets || []).length, "sent", 0, "dropped", 0);
    }
  }
  return { sent, noticed, skipped, dropped };
}
