// Field allow-list and text redaction for Helper.
// Operators never receive money. Anything not listed is dropped.

const MONEY_TEXT = /(?:\$\s?\d[\d,]*(?:\.\d+)?)|(?:\b(?:aud|usd)\s*\$?\s*\d[\d,]*(?:\.\d+)?)|(?:\b\d[\d,]*(?:\.\d+)?\s*(?:dollars|ex\s*gst|inc(?:l(?:uding)?)?\.?\s*gst|plus\s*gst)\b)/gi;

export const FIELD_CAP = 700;

const JOB_FIELDS = [
  "sm8JobNo", "status", "sm8Status", "quoteStatus", "date", "time", "address", "client",
  "type", "description", "notes", "siteNotes", "note", "assignedNames", "durationHrs", "po",
  "machines", "presetId", "includeLabourer", "source",
];

const MONEY_FIELDS = [
  "poAmount", "poAmountBasis", "poAmountSource", "quoteAmount",
  "invoiceNo", "invoiceAmount", "invoiceDate", "invoiceDescription", "invoiceContact",
  "invoiced", "invoicedAt",
];

const QUOTE_QTY = [
  "travelKm", "hoursOnSite", "machineDays", "materialQty", "tipLoads",
  "machines", "presetId", "includeLabourer", "travelMode", "yardAddress",
];

export function redactMoneyText(value) {
  return String(value ?? "").replace(MONEY_TEXT, "[amount hidden]");
}

export function clipText(value, max = FIELD_CAP) {
  const text = String(value ?? "");
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function clipDeep(value, hideMoney) {
  if (typeof value === "string") return clipText(hideMoney ? redactMoneyText(value) : value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => clipDeep(item, hideMoney));
  return null;
}

function projectQuote(quote, canSeeMoney) {
  if (!quote || typeof quote !== "object" || Array.isArray(quote)) return null;
  const out = {};
  for (const key of QUOTE_QTY) {
    if (quote[key] != null) out[key] = clipDeep(quote[key], !canSeeMoney);
  }
  if (typeof quote.travelNote === "string") out.travelNote = clipText(canSeeMoney ? quote.travelNote : redactMoneyText(quote.travelNote));
  if (canSeeMoney) {
    if (quote.totalEx != null) out.totalEx = quote.totalEx;
    if (Array.isArray(quote.lines)) {
      out.lines = quote.lines.slice(0, 20).map(line => ({
        label: clipText(line && line.label),
        amount: line && line.amount != null ? line.amount : null,
      }));
    }
  }
  return out;
}

/** Copy only the fields this login may hear about. */
export function projectJob(job, { canSeeMoney, finance } = {}) {
  const out = { id: String(job.id || "") };
  for (const key of JOB_FIELDS) {
    if (job[key] != null) out[key] = clipDeep(job[key], !canSeeMoney);
  }
  const quote = projectQuote(job.quote, !!canSeeMoney);
  if (quote && Object.keys(quote).length) out.quote = quote;
  if (canSeeMoney) {
    for (const key of MONEY_FIELDS) {
      if (job[key] != null) out[key] = clipDeep(job[key], false);
    }
    if (finance) {
      if (job.xeroStatus != null) out.xeroStatus = clipDeep(job.xeroStatus, false);
      if (job.xeroInvoiceNo != null) out.xeroInvoiceNo = clipDeep(job.xeroInvoiceNo, false);
      if (job.xeroCheck && typeof job.xeroCheck === "object") {
        const check = job.xeroCheck;
        out.xeroCheck = {
          status: check.status || null,
          matches: Array.isArray(check.matches) ? check.matches.slice(0, 3).map(match => ({
            invoiceNumber: match && match.invoiceNumber || null,
            status: match && match.status || null,
            totalEx: match && match.totalEx != null ? match.totalEx : null,
            amountDue: match && match.amountDue != null ? match.amountDue : null,
            date: match && match.date || null,
          })) : [],
        };
      }
    }
  }
  return out;
}

export function projectQuoteDoc(quote, { canSeeMoney } = {}) {
  if (!canSeeMoney || !quote) return null;
  return {
    id: String(quote.id || ""),
    client: clipText(quote.client || ""),
    address: clipText(quote.address || ""),
    description: clipText(quote.description || ""),
    quoteStatus: quote.quoteStatus || null,
    totalEx: quote.totalEx ?? null,
  };
}

export function projectReceipt(receipt, { canSeeMoney } = {}) {
  if (!canSeeMoney || !receipt) return null;
  return {
    id: String(receipt.id || ""),
    jobId: receipt.jobId || null,
    supplier: clipText(receipt.supplier || ""),
    status: receipt.status || null,
    createdAtIso: typeof receipt.createdAtIso === "string" ? receipt.createdAtIso.slice(0, 10) : null,
    amountInc: receipt.amountInc ?? null,
  };
}

/** Last three Brisbane months of company profit. Finance logins only. */
export function projectProfit(history, today) {
  const months = history && history.months;
  if (!months || typeof months !== "object") return null;
  const month = String(today || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const keys = Object.keys(months).filter(key => /^\d{4}-\d{2}$/.test(key) && key <= month).sort().slice(-3);
  if (!keys.length) return null;
  const out = {};
  for (const key of keys) {
    const row = months[key] || {};
    out[key] = {
      netProfit: row.netProfit ?? null,
      income: row.income ?? null,
      expenses: row.expenses ?? null,
    };
  }
  return out;
}

export function projectRates(rates) {
  if (!rates || typeof rates !== "object") return null;
  const keep = ["travelPerKm", "materialPerUnit", "tipPerLoad", "labourerRate"];
  const out = {};
  for (const key of keep) {
    if (rates[key] != null) out[key] = rates[key];
  }
  return Object.keys(out).length ? out : null;
}
