// Chooses the jobs a signed-in person may hear about.
// Client job ids and tenant ids are hints. canSeeJob is the decision.

import { HEARTWOOD_TENANT, canSeeJob, jobTenantOf } from "../shared/cloud-storage.js";
import {
  projectFleet, projectJob, projectLeave, projectProfit, projectQuoteDoc, projectRates,
  projectReceipt, projectRunSheet, projectService, projectTimesheet,
} from "./money.js";

export const SCAN_CAP = 80;
export const KEEP_CAP = 12;

function tokens(question) {
  return String(question || "").toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 2);
}

function dateDist(date, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return 9999;
  return Math.abs(Date.parse(date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000;
}

function scoreJob(job, question, today, jobId) {
  let score = jobId && job.id === jobId ? 100 : 0;
  const hay = [job.address, job.client, job.sm8JobNo, job.po, job.type, job.status, job.description, job.date]
    .join("\n").toLowerCase();
  for (const token of tokens(question)) {
    if (hay.includes(token)) score += 5;
  }
  if (job.date === today) score += 4;
  return score;
}

function sameBusiness(record, tenantId) {
  return jobTenantOf(record) === tenantId;
}

function customerOk(membership, client) {
  if (!membership.customerIds) return true;
  return membership.customerIds.includes(client);
}

export async function buildHelperContext({ reader, membership, question, jobId, today }) {
  const hinted = jobId && /^[A-Za-z0-9_-]{1,80}$/.test(jobId) ? jobId : "";
  const scanned = membership.rulesAdmin
    ? await reader.jobs({ limit: SCAN_CAP })
    : await reader.jobs({ assignedUid: membership.uid, limit: SCAN_CAP });
  const rows = Array.isArray(scanned) ? [...scanned] : [];
  if (hinted && !rows.some(job => job && job.id === hinted)) {
    const one = await reader.job(hinted);
    if (one) rows.push(one);
  }
  const visible = rows
    .filter(job => job && canSeeJob(membership, job))
    .sort((a, b) => {
      const diff = scoreJob(b, question, today, hinted) - scoreJob(a, question, today, hinted);
      if (diff) return diff;
      const close = dateDist(a.date, today) - dateDist(b.date, today);
      if (close) return close;
      return String(a.id).localeCompare(String(b.id));
    })
    .slice(0, KEEP_CAP)
    .map(job => projectJob(job, membership));

  const quotes = [];
  const receipts = [];
  let rateCard = null;
  let profit = null;
  if (membership.canSeeMoney) {
    const quoteRows = await reader.quotes({ limit: 30 });
    for (const quote of quoteRows || []) {
      if (!quote || !sameBusiness(quote, membership.tenantId) || !customerOk(membership, quote.client)) continue;
      const projected = projectQuoteDoc(quote, membership);
      if (projected) quotes.push(projected);
      if (quotes.length >= 8) break;
    }
    const receiptRows = await reader.receipts({ limit: 40 });
    const visibleIds = new Set(visible.map(job => job.id));
    for (const receipt of receiptRows || []) {
      if (!receipt || !sameBusiness(receipt, membership.tenantId)) continue;
      const own = receipt.uid === membership.uid;
      if (!membership.finance && !own) continue;
      if (receipt.jobId && !visibleIds.has(receipt.jobId) && !membership.finance) continue;
      const projected = projectReceipt(receipt, membership);
      if (projected) receipts.push(projected);
      if (receipts.length >= 8) break;
    }
    if (membership.tenantId === HEARTWOOD_TENANT) {
      rateCard = projectRates(await reader.meta("quoteRates"));
    }
    if (membership.finance) profit = projectProfit(await reader.meta("profitHistory"), today);
  }
  const runSheets = [];
  for (const sheet of await optionalRows(reader, "runSheets", { limit: 40 })) {
    if (!sheet || jobTenantOf(sheet) !== membership.tenantId) continue;
    if (!membership.rulesAdmin && sheet.workerUid !== membership.uid) continue;
    const projected = projectRunSheet(sheet);
    if (projected) runSheets.push(projected);
    if (runSheets.length >= 8) break;
  }
  const fleet = [];
  for (const asset of await optionalRows(reader, "fleet", { limit: 40 })) {
    if (!asset || jobTenantOf(asset) !== membership.tenantId) continue;
    const projected = projectFleet(asset);
    if (projected) fleet.push(projected);
    if (fleet.length >= 12) break;
  }
  const costs = {};
  if (membership.canSeeMoney) {
    for (const cost of await optionalRows(reader, "serviceCosts", { limit: 40 })) {
      if (cost && cost.id && jobTenantOf(cost) === membership.tenantId) costs[cost.id] = cost;
    }
  }
  const servicing = [];
  for (const record of await optionalRows(reader, "servicing", { limit: 40 })) {
    if (!record || jobTenantOf(record) !== membership.tenantId) continue;
    const projected = projectService(record, costs[record.id], membership.canSeeMoney);
    if (projected) servicing.push(projected);
    if (servicing.length >= 8) break;
  }
  const timesheets = [];
  for (const sheet of await optionalRows(reader, "timesheets", { limit: 40 })) {
    if (!sheet || jobTenantOf(sheet) !== membership.tenantId) continue;
    if (!membership.rulesAdmin && sheet.uid !== membership.uid) continue;
    const projected = projectTimesheet(sheet, membership.canSeeMoney);
    if (projected) timesheets.push(projected);
    if (timesheets.length >= 8) break;
  }
  const leave = [];
  for (const row of await optionalRows(reader, "leaveRequests", { limit: 40 })) {
    if (!row || jobTenantOf(row) !== membership.tenantId) continue;
    if (!membership.rulesAdmin && row.uid !== membership.uid) continue;
    const projected = projectLeave(row, membership.canSeeMoney);
    if (projected) leave.push(projected);
    if (leave.length >= 8) break;
  }
  return { jobs: visible, quotes, receipts, rateCard, profit, runSheets, fleet, servicing, timesheets, leave };
}

async function optionalRows(reader, method, args) {
  if (!reader || typeof reader[method] !== "function") return [];
  try {
    const rows = await reader[method](args);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}
