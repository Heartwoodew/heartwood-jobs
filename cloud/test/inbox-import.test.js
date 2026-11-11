import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bulkCandidates, canImportInbox, composeAddress, defaultImportMode, duplicateWarning, findExistingJob,
  isImported, parseAddress, parseInboxEmail, sameSite,
} from "../../app/features/inbox-import.js";

const TODAY = "2026-11-08";

test("admins and supervisors can import; staff cannot", () => {
  assert.equal(canImportInbox({ role: "admin" }), true);
  assert.equal(canImportInbox({ role: "supervisor" }), true);
  assert.equal(canImportInbox({ role: "operator", staffRole: "supervisor" }), true);
  assert.equal(canImportInbox({ role: "operator", staffRole: "operator" }), false);
  assert.equal(canImportInbox({ role: "operator" }), false);
  assert.equal(canImportInbox(null), false);
  assert.equal(isImported({ imported: true }), true);
  assert.equal(isImported({ importedJobId: "j1" }), true);
  assert.equal(isImported({ read: true }), false);
});

test("Orbit spoil call-up uses cost code 900 and PO line 02", () => {
  const draft = parseInboxEmail({
    id: "orbit-spoil",
    builder: "Orbit",
    fromName: "BusinessCraft",
    fromEmail: "noreply@orbithomes.com.au",
    date: "2026-11-08T01:12:00.000Z",
    subject: "Purchase Order JOB/900/02 — Lot 45 Wattle Street",
    snippet: "PO JOB/900/02. Site: Lot 45, 12 Wattle Street, Springfield Lakes QLD 4300. Cost code 900. Required date: 14/11/2026. Supervisor: Dave Brown 0412 345 678 dave.brown@orbithomes.com.au. Notes: Spoil is piled on the nature strip. Access from Wattle Street.",
  }, { today: TODAY });
  assert.equal(draft.client, "Orbit Homes (Qld) Pty Ltd");
  assert.equal(draft.lot, "45");
  assert.equal(draft.street, "12 Wattle St");
  assert.equal(draft.suburb, "Springfield Lakes");
  assert.equal(draft.address, "Lot 45, 12 Wattle St, Springfield Lakes");
  assert.equal(draft.type, "spoil");
  assert.equal(draft.costCode, "900");
  assert.equal(draft.po, "JOB/900/02");
  assert.equal(draft.date, "2026-11-14");
  assert.equal(draft.supervisorName, "Dave Brown");
  assert.equal(draft.supervisorEmail, "dave.brown@orbithomes.com.au");
  assert.equal(draft.supervisorPhone, "0412 345 678");
  assert.match(draft.notes, /nature strip/);
  assert.equal(draft.jobLike, true);
});

test("Orbit slab is PO line 01, including a numeric job prefix", () => {
  const callup = parseInboxEmail({
    id: "orbit-slab",
    builder: "Orbit",
    subject: "Call up JOB/900/01",
    snippet: "Call-up for slab. Lot 45, 12 Wattle Street, Springfield Lakes. Required 14 November 2026. PO JOB/900/01. Cost code 900.",
  }, { today: TODAY });
  assert.equal(callup.type, "backslab");
  assert.equal(callup.po, "JOB/900/01");
  assert.equal(callup.date, "2026-11-14");
  assert.equal(callup.costCode, "900");

  const numeric = parseInboxEmail({
    id: "orbit-num",
    builder: "Orbit",
    subject: "BusinessCraft PO 110565/900/01",
    snippet: "Site address: Lot 88, 14 Brightvale Street, Redbank Plains QLD 4301. Required date 06/11/2026. Slab clean.",
  }, { today: TODAY });
  assert.equal(numeric.po, "110565/900/01");
  assert.equal(numeric.type, "backslab");
  assert.equal(numeric.suburb, "Redbank Plains");
});

test("Orbit clean cost codes 901, 902 and 903", () => {
  const roof = parseInboxEmail({
    builder: "Orbit",
    subject: "Call-up roof clean",
    snippet: "Cost code 901 roof clean. Lot 8, 3 Oak Circuit, Ripley QLD. Required date 18/11/2026. PO JOB/901/01.",
  }, { today: TODAY });
  assert.equal(roof.type, "clean");
  assert.equal(roof.typeLabel, "Roof clean");
  assert.equal(roof.costCode, "901");
  assert.equal(roof.po, "JOB/901/01");
  assert.equal(roof.suburb, "Ripley");
  assert.equal(roof.date, "2026-11-18");

  const scaffold = parseInboxEmail({
    builder: "Orbit",
    subject: "Scaffold clean",
    snippet: "Cost code 902. Lot 2, 9 River Road, Chuwar. PO JOB/902/01. Required date: 20/11/2026.",
  }, { today: TODAY });
  assert.equal(scaffold.costCode, "902");
  assert.equal(scaffold.typeLabel, "Scaffold clean");
  assert.equal(scaffold.type, "clean");

  const finalClean = parseInboxEmail({
    builder: "Orbit",
    subject: "Final clean",
    snippet: "Cost code 903 final clean. Lot 6, 4 Cedar Court, Redbank Plains. PO JOB/903/01. Booked for 21/11/2026.",
  }, { today: TODAY });
  assert.equal(finalClean.costCode, "903");
  assert.equal(finalClean.typeLabel, "Final clean");
});

test("an email with both spoil and slab stays one review and names both POs", () => {
  const draft = parseInboxEmail({
    builder: "Orbit",
    subject: "Call up Lot 45 Wattle Street",
    snippet: "Spoil PO JOB/900/02 and slab PO JOB/900/01. Lot 45, 12 Wattle Street, Springfield Lakes. Required date 14/11/2026.",
  }, { today: TODAY });
  assert.equal(draft.twoTasks, true);
  assert.match(draft.warnings.join(" "), /separate jobs/);
  assert.match(draft.notes, /JOB\/900\/0/);
});

test("Torsion and Silkwood freeform emails", () => {
  const torsion = parseInboxEmail({
    builder: "Torsion",
    fromName: "Jake Smith",
    fromEmail: "jake@torsionbuilt.com.au",
    date: "2026-11-08T00:00:00.000Z",
    subject: "Lot 8 Oak Circuit Ripley - slab clean Thursday",
    snippet: "Hi Alex, slab clean at Lot 8, 22 Oak Circuit, Ripley on Thursday. PO TB-44821. Cheers Jake 0413 555 666",
  }, { today: TODAY });
  assert.equal(torsion.client, "Torsion Built Pty Ltd");
  assert.equal(torsion.type, "backslab");
  assert.equal(torsion.po, "TB-44821");
  assert.equal(torsion.lot, "8");
  assert.equal(torsion.street, "22 Oak Cct");
  assert.equal(torsion.suburb, "Ripley");
  assert.equal(torsion.date, "2026-11-12");
  assert.equal(torsion.supervisorName, "Jake Smith");
  assert.equal(torsion.supervisorEmail, "jake@torsionbuilt.com.au");
  assert.equal(torsion.supervisorPhone, "0413 555 666");
  assert.equal(torsion.jobLike, true);

  const silk = parseInboxEmail({
    builder: "Silkwood",
    subject: "Final clean Lot 3 Banksia Drive",
    snippet: "Please book final clean for 18 Nov 2026. Lot 3, 7 Banksia Drive, Bellbird Park. Supervisor Kelly Watts kelly@silkwoodhomes.com.au 0422 333 444. PO SW-90319. Cost code 903.",
  }, { today: TODAY });
  assert.equal(silk.client, "Silkwood Homes");
  assert.equal(silk.type, "clean");
  assert.equal(silk.costCode, "903");
  assert.equal(silk.po, "SW-90319");
  assert.equal(silk.suburb, "Bellbird Park");
  assert.equal(silk.date, "2026-11-18");
  assert.equal(silk.supervisorName, "Kelly Watts");
  assert.equal(silk.supervisorPhone, "0422 333 444");
});

test("HTML body is read and a remittance is not a job", () => {
  const htmlEmail = {
    builder: "Orbit",
    subject: "Call-up",
    html: "<p>Site: Lot 10, 5 Maple Street, Ripley QLD</p><p>Required date: 19/11/2026</p><p>PO JOB/900/02</p><p>Notes: Leave the gate shut.</p>",
  };
  const html = parseInboxEmail(htmlEmail, { today: TODAY });
  assert.equal(html.lot, "10");
  assert.equal(html.type, "spoil");
  assert.match(html.notes, /gate shut/);
  assert.equal(html.jobLike, true);

  const payEmail = {
    builder: "Orbit",
    subject: "Remittance advice October",
    snippet: "Payment of the October account has been deposited. Please find the remittance attached.",
  };
  const pay = parseInboxEmail(payEmail, { today: TODAY });
  assert.equal(pay.jobLike, false);
  assert.equal(bulkCandidates([htmlEmail, payEmail, { ...htmlEmail, id: "done", imported: true }], { today: TODAY }).length, 1);
});

test("the same address or PO matches an existing job, including the middle-dot form", () => {
  const jobs = [
    { id: "j2", status: "Scheduled", po: "110565/900/01", address: "Lot 88 · 14 Brightvale Street, Redbank Plains QLD 4301", date: "2026-11-06" },
    { id: "gone", status: "Cancelled", po: "JOB/900/02", address: "Lot 1, 1 Gone Street, Ripley" },
  ];
  const byPo = findExistingJob(jobs, { po: "110565 / 900 / 01", address: "somewhere else" });
  assert.equal(byPo.job.id, "j2");
  assert.equal(byPo.by, "po");
  const byAddr = findExistingJob(jobs, { po: "", address: "Lot 88, 14 Brightvale St, Redbank Plains" });
  assert.equal(byAddr.job.id, "j2");
  assert.equal(byAddr.by, "address");
  assert.equal(findExistingJob(jobs, { po: "JOB/900/02", address: "Lot 1, 1 Gone Street, Ripley" }), null);
  assert.equal(defaultImportMode(byPo), "date");
  assert.equal(defaultImportMode(byAddr), "create");
  assert.match(duplicateWarning(byPo, "#2402"), /update that job's date/i);
  assert.equal(sameSite("Lot 88 · 14 Brightvale Street, Redbank Plains QLD 4301", "Lot 88, 14 Brightvale St, Redbank Plains"), true);
  assert.equal(composeAddress({ lot: "3", street: "7 Banksia Dr", suburb: "Bellbird Park" }), "Lot 3, 7 Banksia Dr, Bellbird Park");
  const parts = parseAddress("Lot 88 · 14 Brightvale Street, Redbank Plains QLD 4301");
  assert.equal(parts.lot, "88");
  assert.equal(parts.suburb, "Redbank Plains");
});

test("the shell keeps inbox off the staff menu and bumps the cache for this screen", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  assert.match(app, /canImportInbox/);
  assert.match(app, /k === "inbox" \? !canImport\(\)/);
  assert.match(app, /data-iimport/);
  assert.match(app, /data-go="inbox"/);
  assert.match(app, /Supervisors and admins only/);
  assert.match(app, /Import as job/);
  assert.match(app, /Bulk import/);
  assert.match(sw, /features\/inbox-import\.js/);
  assert.match(sw, /callup-shell-v87-daily-jobs/);
  assert.match(readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8"), /match \/inbox\/\{id\}/);
  assert.match(readFileSync(new URL("../production/firestore.inbox.rules", import.meta.url), "utf8"), /BEGIN INBOX IMPORT RULES/);
});
