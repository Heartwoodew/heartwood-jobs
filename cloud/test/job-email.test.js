// Email job: plain-text body, money hidden from crew, dump receipts only.
// Dump receipt = receipts.paidPersonally === false (company-account tip docket).
// Reimbursement = paidPersonally true, or any reimbursement claim, including tip-fees.
// A missing paidPersonally is ambiguous and is not attached.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALEX_UID, resolveMembership } from "../../app/features/cloud-storage.js";
import {
  AMBIGUOUS_RECEIPT, DUMP_RECEIPT, DUMP_RECEIPT_FIELD, DUMP_RECEIPT_VALUE, MAILTO_URL_LIMIT,
  NOTES_TRIM_NOTE, PHOTO_BUDGET_BYTES, REIMBURSEMENT_RECEIPT,
  buildJobEmail, emailDumpReceipts, emailSendPlan, emailSheetHtml, fitEdge, formatJobDate, mailtoHref, moneyText,
  packEmailAttachments, parseEmailRecipients, photoBudget, photosZip, receiptEmailKind, selectEmailAttachments,
  suggestRecipient, unattachedFileNote, JOB_EMAIL_MAX_RECIPIENTS,
} from "../../app/features/job-email.js";

const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");

function member(uid, role, tenant = "heartwood") {
  return resolveMembership({ uid, profile: { role, tenantId: tenant, companyId: tenant } });
}
const admin = member(ALEX_UID, "admin");
const crew = member("crew1", "operator");
const labourer = member("lab1", "labourer");
const supervisor = member("sup1", "supervisor");

function job(extra = {}) {
  return {
    id: "job1",
    companyId: "heartwood",
    tenantId: "heartwood",
    client: "Orbit Homes",
    address: "14 Brightvale Street, Springfield",
    type: "spoil",
    title: "",
    date: "2026-11-16",
    time: "07:00",
    assigned: ["crew1"],
    assignedNames: ["Sam", "Pat"],
    po: "HW-44921",
    description: "Remove spoil $1,840.50 ex GST",
    notes: "Customer offered $40 cash",
    status: "Scheduled",
    poAmount: 1790,
    quoteAmount: 1840.5,
    invoiceAmount: 1840.5,
    workAmounts: ["Rubbish removed: 2 load", "Cash job $40"],
    ...extra,
  };
}
function photo(name = "pSite01") {
  return {
    path: `tenants/heartwood/jobs/job1/photos/${name}`,
    contentType: "image/jpeg",
    size: 4096,
    customMetadata: { purpose: "job-photo" },
  };
}
const dump = {
  id: "dump1", uid: "crew1", jobId: "job1", tenantId: "heartwood", companyId: "heartwood",
  paidPersonally: false, supplier: "Remondis", tonnes: 8.2, amountInc: 88.4, status: "queued",
};
const personal = {
  id: "re1", uid: "crew1", jobId: "job1", tenantId: "heartwood", companyId: "heartwood",
  paidPersonally: true, supplier: "Caltex", amountInc: 62.5, status: "queued",
};
const claim = {
  id: "rcabc", uid: "crew1", jobId: "job1", tenantId: "heartwood", companyId: "heartwood",
  category: "tip-fees", paidWith: "personal-card", supplier: "Tip claim shop", amountCents: 5000,
  receiptPath: "reimbursements/crew1/rcabc/receipt.jpg",
};
const ambiguous = {
  id: "amb1", uid: "crew1", jobId: "job1", tenantId: "heartwood", companyId: "heartwood",
  supplier: "Mystery Dump", tonnes: 2, amountInc: 15,
};
const quote = {
  companyId: "heartwood",
  totalEx: 1840.5,
  gst: 184.05,
  totalInc: 2024.55,
  lines: [{ label: "Excavator", qty: 4, unit: "hour", rate: 186.25, amount: 745 }],
};
const docs = [
  { id: "plan", name: "Site plan", visibility: "crew" },
  { id: "inv", name: "Invoice $1840.pdf", visibility: "office" },
];

function email(role, extra = {}) {
  return buildJobEmail({
    job: job(),
    company: { companyId: "heartwood", name: "Heartwood Earthworx" },
    companyId: "heartwood",
    role,
    documentRole: role,
    typeLabels: { spoil: "Spoil removal" },
    documents: docs,
    photos: [{ name: "Photo 1.jpg", path: "tenants/heartwood/jobs/job1/photos/pSite01" }],
    receipts: [dump, personal, claim, ambiguous],
    quote,
    ...extra,
  });
}

test("dump receipts are paidPersonally false; claims and blank flags are not", () => {
  assert.equal(DUMP_RECEIPT_FIELD, "paidPersonally");
  assert.equal(DUMP_RECEIPT_VALUE, false);
  assert.equal(receiptEmailKind(dump), DUMP_RECEIPT);
  assert.equal(receiptEmailKind({ paidPersonally: false, supplier: "Weighbridge", tonnes: 12.4 }), DUMP_RECEIPT);
  assert.equal(receiptEmailKind(personal), REIMBURSEMENT_RECEIPT);
  assert.equal(receiptEmailKind(claim), REIMBURSEMENT_RECEIPT);
  assert.equal(receiptEmailKind({ category: "fuel", paidWith: "cash", supplier: "BP" }), REIMBURSEMENT_RECEIPT);
  assert.equal(receiptEmailKind({ purpose: "reimbursement-receipt", paidPersonally: false }), REIMBURSEMENT_RECEIPT);
  assert.equal(receiptEmailKind({ reimbursed: true, supplier: "Bunnings" }), REIMBURSEMENT_RECEIPT);
  assert.equal(receiptEmailKind(ambiguous), AMBIGUOUS_RECEIPT);
  assert.equal(receiptEmailKind({ paidPersonally: false, needsAmount: true }), DUMP_RECEIPT);
  assert.equal(receiptEmailKind({}), AMBIGUOUS_RECEIPT);
  const veolia = {
    id: "JsZW", jobId: "YIYNzDnlc6tfDXz5YbAl", supplier: "Veolia wattleglen - tip fees",
    paidPersonally: false, amountInc: null, tonnes: 2.45, status: "queued", bytes: 99552, mime: "image/jpeg",
  };
  assert.equal(receiptEmailKind(veolia), DUMP_RECEIPT);
  assert.equal(emailDumpReceipts({ role: "admin", job: { id: "YIYNzDnlc6tfDXz5YbAl", companyId: "heartwood" }, receipts: [veolia] }).length, 1);
  assert.equal(emailDumpReceipts({ role: "operator", job: { id: "YIYNzDnlc6tfDXz5YbAl", companyId: "heartwood" }, receipts: [veolia] }).length, 0);
});

test("the subject and body carry the job, and not storage links", () => {
  const built = email("admin");
  assert.equal(built.ok, true);
  assert.equal(built.showMoney, true);
  const date = formatJobDate("2026-11-16");
  assert.equal(built.subject, `Job: Spoil removal – 14 Brightvale Street, Springfield – ${date}`);
  assert.match(built.body, /Heartwood Earthworx/);
  assert.match(built.body, /Client: Orbit Homes/);
  assert.match(built.body, /Site: 14 Brightvale Street, Springfield/);
  assert.match(built.body, /https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.match(built.body, /Scheduled: Mon, 16 Nov 2026 · 7:00 am/);
  assert.match(built.body, /Operators: Sam, Pat/);
  assert.match(built.body, /PO: HW-44921/);
  assert.match(built.body, /Status: Scheduled/);
  assert.match(built.body, /Remove spoil \$1,840\.50 ex GST/);
  assert.match(built.body, /Customer offered \$40 cash/);
  assert.match(built.body, /Rubbish removed: 2 load/);
  assert.match(built.body, /Excavator — 4 hour — \$186\.25\/hour — \$745\.00 ex GST/);
  assert.match(built.body, new RegExp(moneyText(1840.5).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(built.body, /PO value: \$1,790\.00 ex GST/);
  assert.match(built.body, /Invoice amount:/);
  assert.match(built.body, /Site plan/);
  assert.match(built.body, /Invoice \$1840\.pdf/);
  assert.match(built.body, /Photo 1\.jpg/);
  assert.match(built.body, /Remondis tip docket \(8\.2 t\)/);
  assert.match(built.body, /\$88\.40 inc GST/);
  assert.doesNotMatch(built.body, /Caltex|Tip claim shop|Mystery Dump/);
  assert.doesNotMatch(built.body, /tenants\/|firebasestorage|googleapis|X-Goog-|token=/);
  const leaked = email("admin", { job: job({ notes: "see https://firebasestorage.googleapis.com/v0/b/x/o/secret?token=abc" }) });
  assert.doesNotMatch(leaked.body, /firebasestorage|token=/);
});

test("crew and labourers export no prices and no receipts", () => {
  for (const role of ["operator", "labourer"]) {
    const built = email(role);
    assert.equal(built.showMoney, false);
    assert.doesNotMatch(built.body, /\$/);
    assert.doesNotMatch(built.body, /186\.25|1,790|1790|1,840|1840|745|88\.40|62\.5|Caltex|Remondis|Dump receipts|Invoice/);
    assert.match(built.body, /Remove spoil \[price removed\]/);
    assert.match(built.body, /HW-44921/);
    assert.match(built.body, /Site plan/);
    assert.match(built.body, /Photo 1\.jpg/);
    assert.doesNotMatch(built.body, /tenants\//);
  }
  assert.equal(email("manager").showMoney, true);
  assert.equal(email("supervisor").showMoney, true);
  assert.match(email("manager").body, /\$186\.25/);
});

test("a plumbing company job uses that company's name and trade", () => {
  const built = buildJobEmail({
    job: job({
      companyId: "northside-plumbing", tenantId: "northside-plumbing", type: "pl-rough",
      client: "Northside Homes", address: "10 King St, Brisbane", po: "P-10",
      description: "Rough-in", notes: "Gate code 1234", poAmount: null, quoteAmount: null, invoiceAmount: null,
      workAmounts: [],
    }),
    company: { companyId: "northside-plumbing", name: "Northside Plumbing" },
    companyId: "northside-plumbing",
    role: "admin",
    typeLabels: { "pl-rough": "Rough-in" },
  });
  assert.equal(built.ok, true);
  assert.match(built.subject, /^Job: Rough-in – 10 King St, Brisbane – /);
  assert.match(built.body, /Northside Plumbing/);
  assert.match(built.body, /Client: Northside Homes/);
  assert.equal(buildJobEmail({ job: job({ companyId: "acme", tenantId: "acme" }), companyId: "heartwood", role: "admin" }).reason, "wrong-company");
});

test("client contact email is suggested, and a long note is trimmed only for mailto", () => {
  const suggested = suggestRecipient(
    { contactName: "Jo", supervisorEmail: "" },
    { contacts: [{ name: "Jo Builder", email: "Jo@Orbit.example", default: true }, { name: "Accounts", email: "accounts@orbit.example" }] },
  );
  assert.equal(suggested.email, "jo@orbit.example");
  assert.equal(suggestRecipient({ contactEmail: "site@orbit.example" }, { contacts: [{ email: "other@orbit.example", default: true }] }).email, "site@orbit.example");
  const notes = "n".repeat(4000);
  const built = email("admin", { job: job({ notes }) });
  const link = mailtoHref({ to: "jo@orbit.example", subject: built.subject, body: built.body });
  assert.equal(link.trimmed, true);
  assert.match(link.body, new RegExp(NOTES_TRIM_NOTE));
  assert.ok(link.href.length <= MAILTO_URL_LIMIT);
  assert.ok(link.href.startsWith("mailto:jo@orbit.example?subject="));
  assert.match(link.fullBody, new RegExp("n{100}"));
  const short = mailtoHref({ to: "jo@orbit.example", subject: "Job: Spoil removal", body: "Notes:\nShort\n\nDocuments:\n- None" });
  assert.equal(short.trimmed, false);
  assert.match(short.body, /Short/);
  assert.doesNotMatch(short.body, new RegExp(NOTES_TRIM_NOTE));
});

test("admin gets the dump receipt ticked; reimbursements, ambiguous rows and crew get none", () => {
  const listing = [
    photo(),
    { path: "tenants/heartwood/jobs/job1/photos/pReceipt", contentType: "image/jpeg", size: 100, customMetadata: { purpose: "receipt", receiptId: "hid" } },
    { path: "tenants/acme/jobs/job1/photos/pOther", contentType: "image/jpeg", size: 100, customMetadata: { purpose: "job-photo" } },
  ];
  const receipts = [dump, personal, claim, ambiguous, { ...dump, id: "other", jobId: "job9", supplier: "Other tip" }];
  const asAdmin = selectEmailAttachments({ membership: admin, job: job(), companyId: "heartwood", role: "admin", listing, receipts });
  assert.equal(asAdmin.ok, true);
  assert.equal(asAdmin.photos.length, 1);
  assert.equal(asAdmin.photos[0].name, "Photo 1.jpg");
  assert.doesNotMatch(asAdmin.photos[0].name, /tenants\//);
  assert.equal(asAdmin.receipts.length, 1);
  assert.equal(asAdmin.receipts[0].kind, "dump-receipt");
  assert.match(asAdmin.receipts[0].name, /Remondis tip docket/);
  assert.equal(asAdmin.receipts[0].paidPersonally, false);
  assert.ok(asAdmin.attachments.some(item => item.id === "receipt:dump1"));
  assert.ok(asAdmin.dropped.some(item => item.reason === REIMBURSEMENT_RECEIPT && item.id === "re1"));
  assert.ok(asAdmin.dropped.some(item => item.reason === REIMBURSEMENT_RECEIPT && item.id === "rcabc"));
  assert.ok(asAdmin.dropped.some(item => item.reason === AMBIGUOUS_RECEIPT && item.id === "amb1"));
  assert.ok(asAdmin.dropped.some(item => item.reason === "other-job"));
  const none = selectEmailAttachments({
    membership: admin, job: job(), companyId: "heartwood", role: "admin", listing, receipts, pickedIds: [],
  });
  assert.equal(none.attachments.length, 0);
  const photoOnly = selectEmailAttachments({
    membership: admin, job: job(), companyId: "heartwood", role: "admin", listing, receipts,
    pickedIds: [asAdmin.photos[0].id],
  });
  assert.equal(photoOnly.receipts.length, 0);
  assert.equal(photoOnly.photos.length, 1);

  for (const [who, role] of [[crew, "operator"], [labourer, "labourer"]]) {
    const picked = selectEmailAttachments({
      membership: who, job: job({ assigned: [who.uid] }), companyId: "heartwood", role, listing: [photo()], receipts: [dump],
    });
    assert.equal(picked.ok, true);
    assert.equal(picked.photos.length, 1);
    assert.equal(picked.receipts.length, 0);
    assert.ok(picked.dropped.some(item => item.reason === "no-money" && item.id === "dump1"));
  }
  const own = selectEmailAttachments({
    membership: supervisor, job: job({ assigned: ["sup1"] }), companyId: "heartwood", role: "supervisor",
    listing: [photo()], receipts: [{ ...dump, uid: "sup1" }],
  });
  assert.equal(own.receipts.length, 1);
  const someoneElses = selectEmailAttachments({
    membership: supervisor, job: job({ assigned: ["sup1"] }), companyId: "heartwood", role: "supervisor",
    listing: [], receipts: [dump],
  });
  assert.equal(someoneElses.receipts.length, 0);
  assert.equal(selectEmailAttachments({ membership: crew, job: job({ assigned: ["other"] }), role: "operator", listing: [photo()] }).ok, false);
});

test("share attaches files, otherwise mailto plus a download, and photos shrink under 1600px", () => {
  assert.deepEqual(emailSendPlan({ canShareFiles: true, attachmentCount: 2 }), { channel: "share", download: false });
  assert.deepEqual(emailSendPlan({ canShareFiles: false, attachmentCount: 2 }), { channel: "mailto", download: true });
  assert.deepEqual(emailSendPlan({ canShareFiles: true, attachmentCount: 0 }), { channel: "mailto", download: false });
  assert.deepEqual(fitEdge(4000, 2000), { width: 1600, height: 800, scale: 0.4 });
  assert.equal(fitEdge(800, 600).scale, 1);
  const over = photoBudget([PHOTO_BUDGET_BYTES + 1]);
  assert.equal(over.over, true);
  assert.match(over.message, /20 MB/);
  assert.equal(photoBudget([1024]).over, false);
  const zip = photosZip([{ name: "Photo 1.jpg", data: Uint8Array.from([1, 2, 3]) }, { name: "tenants/heartwood/jobs/job1/photos/p1.jpg", data: Uint8Array.from([4]) }]);
  assert.equal(zip.ok, true);
  assert.equal(zip.zip[0], 0x50);
  assert.equal(zip.zip[1], 0x4b);
  assert.deepEqual(zip.names, ["Photo 1.jpg", "Photo 2.jpg"]);
  assert.equal(Buffer.from(zip.zip).includes("tenants"), false);
  const html = emailSheetHtml({
    subject: "Job: Spoil removal", body: "Hello", to: "jo@orbit.example", suggestion: "jo@orbit.example",
    photos: [{ name: "Photo 1.jpg" }], receipts: [{ name: "Remondis tip docket" }],
  });
  assert.match(html, /Email job/);
  assert.match(html, /Other mail app/);
  assert.match(html, />Send</);
  assert.match(html, />Copy</);
  assert.match(html, /id="jemcc"/);
  assert.match(html, /value="jo@orbit.example"/);
  assert.doesNotMatch(html, /Copy to clipboard/);
  assert.match(html, /Download photos/);
  assert.match(html, /No photos/);
  assert.match(html, /checked/);
  assert.match(html, /Remondis tip docket/);
  assert.doesNotMatch(html, /firebasestorage|tenants\/|Caltex/);
});

test("addresses are checked, overflow files are named without a public storage link, and the sheet sends", () => {
  assert.equal(parseEmailRecipients({ to: "Jo@Orbit.example", cc: "accounts@orbit.example" }).ok, true);
  assert.deepEqual(parseEmailRecipients({ to: "jo@orbit.example", cc: "jo@orbit.example,  " }).cc, []);
  assert.equal(parseEmailRecipients({ to: "" }).reason, "invalid-recipient");
  assert.equal(parseEmailRecipients({ to: "not-an-email" }).ok, false);
  const many = Array.from({ length: JOB_EMAIL_MAX_RECIPIENTS + 1 }, (_, i) => `p${i}@orbit.example`).join(", ");
  assert.equal(parseEmailRecipients({ to: many }).ok, false);
  assert.equal(parseEmailRecipients({ to: "a@orbit.example, b@orbit.example", cc: "c@orbit.example, d@orbit.example, e@orbit.example" }).ok, true);
  const packed = packEmailAttachments([{ name: "a.jpg", size: 8 }, { name: "b.jpg", size: 6 }, { name: "c.jpg", size: 0 }], 10);
  assert.equal(packed.attach.length, 1);
  assert.equal(packed.linked.length, 1);
  assert.equal(packed.skipped.length, 1);
  const note = unattachedFileNote({
    photos: ["Photo 4.jpg"],
    receipts: ["Remondis tip docket"],
    url: "https://jobs.heartwoodew.com/app/",
  });
  assert.match(note, /Photos:/);
  assert.match(note, /Dump receipts:/);
  assert.match(note, /https:\/\/jobs\.heartwoodew\.com\/app\//);
  assert.match(note, /signed in/);
  assert.doesNotMatch(note, /tenants\/|firebasestorage|token=/);
  assert.equal(unattachedFileNote({ photos: [], receipts: [] }), "");
  assert.equal(emailDumpReceipts({ role: "operator", job: job(), receipts: [dump] }).length, 0);
  assert.equal(emailDumpReceipts({ role: "admin", job: job(), receipts: [dump, personal, claim, ambiguous] }).length, 1);
  assert.equal(emailDumpReceipts({ role: "supervisor", job: job(), receipts: [dump, personal] })[0].id, "dump1");
  const fn = app.slice(app.indexOf("function emailActorRole"), app.indexOf("// ------------------------------------------------------------------ email photos"));
  assert.match(fn, /selectEmailAttachments/);
  assert.match(fn, /parseEmailRecipients/);
  assert.match(fn, /callAuthed\("sendJobEmail"/);
  assert.match(fn, /navigator\.share/);
  assert.match(fn, /mailtoHref/);
  assert.match(fn, /emailJobReceipts/);
  assert.match(fn, /canSeeMoney\(\)/);
  assert.match(fn, /Sending…/);
  assert.match(fn, /overflowCount/);
  assert.match(fn, /compressed to fit/);
  assert.match(fn, /Other mail app|jemmail/);
  assert.doesNotMatch(fn, /getDownloadURL|httpsCallable|functions\(/);
  assert.ok(app.split('id="emailjob"').length - 1 >= 2);
  assert.match(sw, /callup-shell-v141-industries/);
  assert.match(sw, /features\/job-email\.js/);
});
