// Job receipt measures: a docket is valid with a dollar amount, a tonnes weight, or both.
// Tip dockets (e.g. Remondis on account) often have only a weight. Tonnes is not a price.
// Personally paid receipts with no dollar amount need an amount before they can be paid back.
// Account dockets (not paid personally) with only tonnes are normal — no warning, not owed money.

export function receiptAmount(row) {
  const n = Number(row && row.amountInc);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

export function receiptTonnes(row) {
  const n = Number(row && row.tonnes);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
}

export function receiptHasMoney(row) {
  return receiptAmount(row) > 0;
}

export function formatTonnes(n) {
  const t = receiptTonnes({ tonnes: n });
  if (!t) return "";
  return `${t} t`;
}

/** Parse form values. Empty or invalid fields become null. ok when at least one measure is > 0. */
export function parseReceiptMeasures({ amount, tonnes } = {}) {
  const amtRaw = amount === "" || amount == null ? NaN : Number(amount);
  const tRaw = tonnes === "" || tonnes == null ? NaN : Number(tonnes);
  const amountInc = Number.isFinite(amtRaw) && amtRaw > 0 ? Math.round(amtRaw * 100) / 100 : null;
  const tonnesN = Number.isFinite(tRaw) && tRaw > 0 ? Math.round(tRaw * 1000) / 1000 : null;
  return { amountInc, tonnes: tonnesN, ok: amountInc != null || tonnesN != null };
}

export function receiptMeasureFields(measures) {
  const out = { amountInc: measures && measures.amountInc != null ? measures.amountInc : null };
  if (measures && measures.tonnes != null) out.tonnes = measures.tonnes;
  return out;
}

export function validateReceiptUpload({ hasPhoto, supplier, amount, tonnes } = {}) {
  const measures = parseReceiptMeasures({ amount, tonnes });
  if (!hasPhoto || !String(supplier || "").trim() || !measures.ok) {
    return { ok: false, reason: "Photo, supplier, and either a dollar amount or tonnes are needed.", measures };
  }
  return { ok: true, measures };
}

/**
 * True only for a personally-paid receipt (or its reimbursements ledger row) that has no dollar amount.
 * Trade-account / tip dockets that were not marked paid personally must never flag this.
 */
export function receiptNeedsAmount(row) {
  if (!row || receiptHasMoney(row)) return false;
  if (row.paidPersonally) return true;
  if (row.needsAmount) return true;
  if (row.pending || row.createdFrom === "pill") return true;
  if (Object.prototype.hasOwnProperty.call(row, "paid")) return true;
  return false;
}

/** Visible label: $ amount (via moneyFmt, which may hide dollars) and/or tonnes. */
export function formatReceiptMeasure(row, moneyFmt) {
  const parts = [];
  if (receiptHasMoney(row)) {
    const money = typeof moneyFmt === "function" ? moneyFmt(receiptAmount(row)) : `$${receiptAmount(row).toFixed(2)}`;
    if (money) parts.push(money);
  }
  const t = formatTonnes(receiptTonnes(row));
  if (t) parts.push(t);
  return parts.join(" · ");
}

export function receiptOwedTotal(rows) {
  return (rows || []).reduce((sum, row) => sum + receiptAmount(row), 0);
}

/** Duplicate key for the owner attention list. Does not treat missing $ as $0.00. */
export function receiptDupKey(row) {
  const who = (row && row.workerName) || "";
  const day = String((row && row.date) || "").slice(0, 10);
  const money = receiptHasMoney(row) ? receiptAmount(row).toFixed(2) : "";
  const tonnes = receiptTonnes(row) ? receiptTonnes(row).toFixed(3) : "";
  const measure = money ? `$${money}` : (tonnes ? `t:${tonnes}` : "none");
  return [who, measure, day].join("|");
}

export function receiptHubdocLines(row) {
  const parts = [];
  if (receiptHasMoney(row)) parts.push(`Amount $${receiptAmount(row).toFixed(2)} inc GST`);
  if (receiptTonnes(row)) parts.push(`Tonnes: ${formatTonnes(receiptTonnes(row))}`);
  if (!parts.length) parts.push("Amount not on docket");
  return parts.join(". ");
}
