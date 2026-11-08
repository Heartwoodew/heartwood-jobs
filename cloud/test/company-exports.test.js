import test from "node:test";
import assert from "node:assert/strict";
import { exportAllowed, hoursCsv, invoiceCsv, jobsCsv, reimbursementsCsv } from "../../app/features/company-exports.js";

const job = {
  status: "Done", client: "Sample Homes", invoiceContact: "Sample Homes", invoiceNo: "1001",
  date: "2026-11-01", invoiceDescription: "Spoil — 12 Test Street", invoiceAmount: 200,
  address: "12 Test Street", description: "Spoil", po: "PO9", assignedNames: ["Sam Taylor"], sm8JobNo: "44",
};

test("only a customer-company admin can export, and the invoice CSV is generic", () => {
  assert.equal(exportAllowed({ role: "admin", companyId: "heartwood" }), false);
  assert.equal(exportAllowed({ role: "operator", companyId: "acme" }), false);
  assert.equal(exportAllowed({ role: "admin", companyId: "acme" }), true);
  const csv = invoiceCsv([
    job,
    { status: "Scheduled", client: "Not done", invoiceAmount: 9 },
    { status: "Done", client: "Skip", invoiceExcluded: true, invoiceAmount: 9 },
  ]);
  assert.match(csv, /^Contact,Invoice Number,Date,Due Date,Description,Quantity,Unit Amount,GST,Account Code\r\n/);
  assert.match(csv, /Sample Homes,1001,01\/11\/2026,08\/11\/2026,Spoil — 12 Test Street,1,200\.00,20\.00,\r\n$/);
  assert.doesNotMatch(csv, /Xero|AccountCode|\*ContactName|OUTPUT/);
  assert.equal(csv.split("\r\n").filter(Boolean).length, 2);
});

test("hours, reimbursements and jobs CSVs stay inside the company data", () => {
  const hours = hoursCsv({ people: [{ name: "Sam", rows: [{ date: "2026-11-02", start: "07:00", finish: "15:00", breakMins: 30, hours: 7.5, job: "12 Test Street", source: "Clocked", note: "" }], leave: [] }] });
  assert.match(hours, /Staff,Date,Start,Finish,Break minutes,Hours,Job,Source,Note/);
  assert.match(hours, /Sam,02\/11\/2026,07:00,15:00,30,7\.50,12 Test Street,Clocked,/);
  const claims = reimbursementsCsv([{ date: "2026-11-03", name: "Sam", supplier: "Bunnings", category: "fuel", notes: "diesel", amountCents: 1100, status: "approved", jobLabel: "12 Test Street" }]);
  assert.match(claims, /03\/11\/2026,Sam,Bunnings — fuel — diesel,1,10\.00,1\.00,,approved,12 Test Street/);
  assert.match(claims, /Account Code/);
  const jobs = jobsCsv([job]);
  assert.match(jobs, /44,01\/11\/2026,Sample Homes,12 Test Street,Spoil,Done,PO9,Sam Taylor/);
  assert.doesNotMatch(jobs, /200\.00|invoiceAmount/);
});
