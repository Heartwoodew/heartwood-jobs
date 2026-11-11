// CSV downloads for a customer company. Admins only.
// These files are plain text a bookkeeper can import into Xero or MYOB.
// Nothing here talks to Xero, MYOB, or Stripe. Heartwood keeps its own Xero screens.

export const INVOICE_COLUMNS = Object.freeze([
  "Contact", "Invoice Number", "Date", "Due Date", "Description", "Quantity", "Unit Amount", "GST", "Account Code",
]);

const GST_RATE = 0.1;

export function exportAllowed({ role, companyId } = {}) {
  return role === "admin" && typeof companyId === "string" && companyId.length > 0 && companyId !== "heartwood";
}

// Text typed by staff (notes, job, supplier) must not run as a spreadsheet formula when the CSV is opened in Excel or
// Sheets. Plain numbers such as -12.50 are left alone.
function cell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function table(headers, rows) {
  return [headers, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function auDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function plusDays(iso, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function gstOnEx(ex) {
  const n = Number(ex);
  if (!Number.isFinite(n)) return "";
  return money(n * GST_RATE);
}

export function billableJobs(jobs) {
  return (jobs || []).filter(job => {
    const status = job && job.status;
    return (status === "Done" || status === "Completed") && job.invoiceExcluded !== true && job.doNotInvoice !== true;
  });
}

export function invoiceCsv(jobs) {
  const rows = billableJobs(jobs).map(job => {
    const date = job.invoiceDate || job.date || "";
    const ex = job.invoiceAmount;
    return [
      job.invoiceContact || job.client || "",
      job.invoiceNo || "",
      auDate(date),
      auDate(plusDays(date, 7)),
      job.invoiceDescription || job.description || "",
      "1",
      money(ex),
      gstOnEx(ex),
      "",
    ];
  });
  return table(INVOICE_COLUMNS, rows);
}

function shiftCsv(name, shift) {
  return [
    name,
    auDate(shift.date),
    shift.start || "",
    shift.finish || "",
    shift.breakMins == null ? "" : String(shift.breakMins),
    money(shift.hours),
    shift.job || "",
    shift.source || "",
    shift.note || "",
  ];
}

export function hoursCsv(report) {
  const headers = ["Staff", "Date", "Start", "Finish", "Break minutes", "Hours", "Job", "Source", "Note"];
  const rows = [];
  for (const person of (report && report.people) || []) {
    const name = person.name || "";
    if (Array.isArray(person.days)) {
      for (const day of person.days) {
        const shifts = day.shifts || [];
        if (shifts.length) for (const shift of shifts) rows.push(shiftCsv(name, shift));
        else rows.push([name, auDate(day.date), "", "", "", money(day.total), "", day.leaveText || "", day.note || ""]);
      }
    } else {
      for (const shift of person.rows || []) rows.push(shiftCsv(name, shift));
      for (const leave of person.leave || []) {
        rows.push([name, auDate(leave.date), "", "", "", "", "", "Leave", leave.label || ""]);
      }
    }
  }
  return table(headers, rows);
}

export function reimbursementsCsv(claims) {
  const headers = ["Date", "Contact", "Description", "Quantity", "Unit Amount", "GST", "Account Code", "Status", "Job"];
  const rows = (claims || []).map(row => {
    const cents = Number(row.amountCents);
    const inc = Number.isFinite(cents) ? cents / 100 : Number(row.amountInc) || 0;
    const gst = Number.isFinite(inc) ? Math.round((inc / 11) * 100) / 100 : 0;
    const ex = Math.round((inc - gst) * 100) / 100;
    const description = [row.supplier, row.category, row.notes].filter(Boolean).join(" — ");
    return [
      auDate(row.date),
      row.name || row.workerName || "",
      description,
      "1",
      money(ex),
      money(gst),
      "",
      row.status || "",
      row.jobLabel || row.jobNo || "",
    ];
  });
  return table(headers, rows);
}

export function jobsCsv(jobs) {
  const headers = ["Job number", "Date", "Contact", "Site", "Description", "Status", "PO", "Staff"];
  const rows = (jobs || []).map(job => [
    job.sm8JobNo || job.jobNo || job.invoiceNo || "",
    auDate(job.date),
    job.client || "",
    job.address || "",
    job.description || "",
    job.status || "",
    job.po || "",
    Array.isArray(job.assignedNames) ? job.assignedNames.join("; ") : "",
  ]);
  return table(headers, rows);
}
