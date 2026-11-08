import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CERT_MAX_BYTES, addDays, assignmentWarning, approvedOn, cellLeaveText, certificateContentType, exportDayLeave,
  certificateObjectName, certificateStoragePath, halvesOk, leaveCreateBody, leaveDecisionBody,
  leaveScreenHtml, leaveSpan, newLeaveId, plannerLeaveHtml, portionLabel, saveCertificate, certificateDownloadName, weekLeaveHtml, weekLeaves,
} from "../../app/features/leave.js";

const id = "lv0123456789abcdef";

function draft(extra = {}) {
  return leaveCreateBody({
    id, uid: "op1", name: "Sam", type: "sick", start: "2026-11-10", end: "2026-11-12",
    startHalf: "", endHalf: "", reason: "Flu", certificatePath: "", certificateName: "",
    ...extra,
  });
}

test("a request accepts annual, sick, or other, and optional half days", () => {
  const full = draft();
  assert.equal(full.ok, true);
  assert.equal(full.data.status, "pending");
  assert.equal(full.data.decidedAt, null);
  assert.equal(draft({ type: "annual" }).ok, true);
  assert.equal(draft({ type: "other", start: "2026-11-10", end: "2026-11-10", startHalf: "am", endHalf: "am" }).ok, true);
  assert.equal(draft({ start: "2026-11-10", end: "2026-11-12", startHalf: "pm", endHalf: "am" }).ok, true);
  assert.equal(draft({ type: "holiday" }).ok, false);
  assert.equal(draft({ end: "2026-11-09" }).ok, false);
  assert.equal(draft({ start: "2026-11-10", end: "2026-11-10", startHalf: "am", endHalf: "pm" }).ok, false);
  assert.equal(draft({ startHalf: "am", endHalf: "" }).ok, false);
  assert.equal(draft({ reason: "  " }).ok, false);
  assert.equal(halvesOk("2026-11-10", "2026-11-12", "pm", "am"), true);
  assert.equal(halvesOk("2026-11-10", "2026-11-12", "am", ""), false);
  assert.match(draft({ start: "2026-11-10", end: "2026-11-12", startHalf: "am", endHalf: "" }).reason, /afternoon/);
});

test("the certificate path is the private leave folder or empty", () => {
  assert.equal(certificateObjectName("image/jpeg"), "cert.jpg");
  assert.equal(certificateObjectName("image/jpg"), "cert.jpg");
  assert.equal(certificateContentType("image/jpg"), "image/jpeg");
  assert.equal(certificateObjectName("text/plain"), "");
  const path = certificateStoragePath("op1", id, "cert.pdf");
  assert.equal(path, `leaveCertificates/op1/${id}/cert.pdf`);
  assert.equal(certificateStoragePath("op1", "nope", "cert.pdf"), "");
  assert.equal(draft({ certificatePath: path, certificateName: "note.pdf" }).ok, true);
  assert.equal(draft({ certificatePath: "tenants/heartwood/jobs/job1/photos/p.jpg", certificateName: "p.jpg" }).ok, false);
  assert.equal(draft({ certificatePath: path, certificateName: "" }).ok, false);
  assert.equal(CERT_MAX_BYTES, 8 * 1024 * 1024);
  assert.match(newLeaveId(), /^lv[a-z0-9]{16}$/);
});

test("a decision needs a note and does not rewrite the request", () => {
  const yes = leaveDecisionBody({ status: "approved", note: "Take care", uid: "sup1", name: "Sue" });
  assert.equal(yes.ok, true);
  assert.deepEqual(Object.keys(yes.data).sort(), ["decidedBy", "decidedByName", "decisionNote", "status"]);
  assert.equal(leaveDecisionBody({ status: "declined", note: "  ", uid: "sup1", name: "Sue" }).ok, false);
  assert.equal(leaveDecisionBody({ status: "pending", note: "No", uid: "sup1", name: "Sue" }).ok, false);
});

test("approved leave shows on the week and warns on a job that day", () => {
  const leaves = [
    { uid: "op1", name: "Sam", status: "approved", type: "annual", start: "2026-11-10", end: "2026-11-12", startHalf: "pm", endHalf: "am" },
    { uid: "op1", name: "Sam", status: "pending", type: "sick", start: "2026-11-13", end: "2026-11-13", startHalf: "", endHalf: "" },
    { uid: "sup1", name: "Sue", status: "approved", type: "sick", start: "2026-11-11", end: "2026-11-11", startHalf: "am", endHalf: "am" },
    { uid: "op2", name: "Riley", status: "declined", type: "other", start: "2026-11-10", end: "2026-11-10", startHalf: "", endHalf: "" },
  ];
  assert.equal(approvedOn(leaves, { uid: "op1", name: "Sam" }, "2026-11-11").type, "annual");
  assert.equal(approvedOn(leaves, { uid: "op1" }, "2026-11-13"), null);
  assert.equal(portionLabel(leaves[0], "2026-11-10"), "from the afternoon");
  assert.equal(portionLabel(leaves[0], "2026-11-12"), "until midday");
  assert.equal(portionLabel(leaves[2], "2026-11-11"), "morning only");
  const warn = assignmentWarning(leaves, "2026-11-11", [{ uid: "op1", name: "Sam" }, { uid: "sup1", name: "Sue" }]);
  assert.match(warn, /Sam is on approved annual leave/);
  assert.match(warn, /Sue is on approved sick leave \(morning only\)/);
  assert.equal(assignmentWarning(leaves, "2026-11-13", [{ uid: "op1", name: "Sam" }]), "");
  assert.equal(assignmentWarning(leaves, "", [{ uid: "op1", name: "Sam" }]), "");
  const week = weekLeaves(leaves, "2026-11-09", { uid: "op1", name: "Sam" });
  assert.equal(week.length, 1);
  assert.equal(addDays("2026-11-09", 6), "2026-11-15");
  const banner = weekLeaveHtml(leaves, "2026-11-09", { uid: "op1", name: "Sam" });
  assert.match(banner, /Annual leave/);
  assert.match(banner, /starts in the afternoon/);
  assert.equal(banner.includes("Riley"), false);
  assert.equal(banner.includes("Pending"), false);
  const board = plannerLeaveHtml(leaves, ["2026-11-09", "2026-11-15"], [{ uid: "op1", name: "Sam" }, { uid: "sup1", name: "Sue" }]);
  assert.match(board, /Approved leave/);
  assert.match(board, /Sue/);
  assert.equal(cellLeaveText(leaves, { name: "Sue" }, "2026-11-11"), "Sick leave · morning only");
  assert.equal(cellLeaveText(leaves, { name: "Riley" }, "2026-11-10"), "");
  assert.match(leaveSpan(leaves[2]), /morning only/);
});

test("the hours sheet uses approved leave, a certificate note, and pending wording", () => {
  const leaves = [
    { uid: "op1", name: "Sam", status: "approved", type: "sick", start: "2026-11-10", end: "2026-11-10", startHalf: "am", endHalf: "am", certificatePath: "leaveCertificates/op1/lv0123456789abcdef/cert.pdf", certificateName: "secret-scan.pdf" },
    { uid: "op1", name: "Sam", status: "pending", type: "annual", start: "2026-11-11", end: "2026-11-11", startHalf: "", endHalf: "" },
    { uid: "op1", name: "Sam", status: "declined", type: "other", start: "2026-11-12", end: "2026-11-12", startHalf: "", endHalf: "", reason: "No" },
    { uid: "op1", name: "Sam", status: "approved", type: "annual", start: "2026-11-10", end: "2026-11-12", startHalf: "pm", endHalf: "am" },
  ];
  const person = { uid: "op1", name: "Sam" };
  const sick = exportDayLeave(leaves, person, "2026-11-10");
  assert.equal(sick.text, "Annual leave · from the afternoon · Sick leave · morning only · Medical certificate");
  assert.equal(sick.annual, 0.5);
  assert.equal(sick.sick, 0.5);
  assert.equal(sick.pending, 0);
  const pending = exportDayLeave(leaves, person, "2026-11-11");
  assert.equal(pending.text, "Annual leave · Leave requested (pending)");
  assert.equal(pending.annual, 1);
  assert.equal(pending.pending, 1);
  const declined = exportDayLeave(leaves, person, "2026-11-12");
  assert.equal(declined.text, "Annual leave · until midday");
  assert.equal(declined.other, 0);
  assert.equal(declined.text.includes("secret-scan"), false);
  assert.equal(exportDayLeave(leaves, { uid: "other", name: "Pat" }, "2026-11-11").text, "");
});

test("the screen lets staff request leave and hides the file from a supervisor", () => {
  const rows = [{
    id, uid: "op1", name: "Sam", status: "pending", type: "sick", start: "2026-11-10", end: "2026-11-10",
    startHalf: "", endHalf: "", reason: "Flu", certificatePath: "leaveCertificates/op1/" + id + "/cert.pdf",
  }];
  const staff = leaveScreenHtml({ requests: rows, uid: "op1", canDecide: false, canOpenCert: false });
  assert.match(staff, /id="leaveform"/);
  assert.match(staff, /Open certificate/);
  assert.match(staff, />Download</);
  assert.equal(staff.includes("To decide"), false);
  const supervisor = leaveScreenHtml({ requests: rows, uid: "sup1", canDecide: true, canOpenCert: false });
  assert.match(supervisor, /To decide/);
  assert.match(supervisor, /Approve/);
  assert.match(supervisor, /Decline/);
  assert.equal(supervisor.includes("Open certificate"), false);
  assert.equal(supervisor.includes(">Download<"), false);
  assert.match(supervisor, /Only that person and an admin/);
  const admin = leaveScreenHtml({ requests: rows, uid: "ada", canDecide: true, canOpenCert: true });
  assert.match(admin, /Open certificate/);
  assert.match(admin, />Download</);
  assert.equal(staff.includes("<script"), false);
});

test("a certificate downloads as name, leave type, and start date", async () => {
  const row = { name: "Sam Lee", type: "sick", start: "2026-11-10", certificatePath: "leaveCertificates/op1/lv0123456789abcdef/cert.jpeg" };
  assert.equal(certificateDownloadName(row), "Sam_Lee_sick_2026-11-10.jpg");
  assert.equal(certificateDownloadName({ name: "Sam", type: "annual", start: "2026-11-20", certificatePath: "leaveCertificates/op1/x/cert.pdf" }), "Sam_annual_2026-11-20.pdf");
  const links = [];
  const doc = {
    body: { appendChild(node) { links.push(node); } },
    createElement() { return { href: "", download: "", rel: "", target: "", click() {}, remove() {} }; },
  };
  const shared = [];
  const ios = await saveCertificate({
    blob: new Uint8Array([1, 2, 3]),
    downloadUrl: "https://example.invalid/cert.pdf",
    filename: "Sam_sick_2026-11-10.pdf",
    doc,
    nav: {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      canShare() { return true; },
      share(payload) { shared.push(payload.files[0].name); },
    },
  });
  assert.equal(ios.via, "share");
  assert.deepEqual(shared, ["Sam_sick_2026-11-10.pdf"]);
  assert.equal(links.length, 0);
  const desktop = await saveCertificate({
    blob: null,
    downloadUrl: "https://example.invalid/cert.pdf",
    filename: "Sam_sick_2026-11-10.pdf",
    doc,
    nav: { userAgent: "Mozilla/5.0 (Macintosh)" },
  });
  assert.equal(desktop.via, "url");
  assert.equal(links[0].download, "Sam_sick_2026-11-10.pdf");
  assert.equal(links[0].href, "https://example.invalid/cert.pdf");
});

test("leave rules use the live helpers and match the emulator block", () => {
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const frag = readFileSync(new URL("../production/firestore.leave.rules", import.meta.url), "utf8");
  const storageFrag = readFileSync(new URL("../production/storage.leave.rules", import.meta.url), "utf8");
  const storage = readFileSync(new URL("../emulator/storage.rules", import.meta.url), "utf8");
  const prodStorage = readFileSync(new URL("../production/storage.rules", import.meta.url));
  const slice = (text, begin, end) => {
    const start = text.indexOf(begin);
    const stop = text.indexOf(end);
    assert.ok(start >= 0 && stop > start);
    return text.slice(start, stop + end.length);
  };
  assert.equal(slice(emu, "// BEGIN LEAVE RULES", "// END LEAVE RULES"), slice(frag, "// BEGIN LEAVE RULES", "// END LEAVE RULES"));
  assert.equal(
    slice(storage, "// BEGIN LEAVE CERTIFICATE RULES", "// END LEAVE CERTIFICATE RULES"),
    slice(storageFrag, "// BEGIN LEAVE CERTIFICATE RULES", "// END LEAVE CERTIFICATE RULES"),
  );
  assert.equal(prodStorage.equals(Buffer.from(storage)), true);
  const block = slice(frag, "// BEGIN LEAVE RULES", "// END LEAVE RULES");
  for (const name of ["isAlex()", "isPatrick()", "hasProfile()", "profile()", "same("]) {
    assert.equal(block.includes(name), true, name);
  }
  assert.doesNotMatch(block, /\bsignedIn\(|isAppAdmin\(|svcMember\(|psMember\(|inviteAdmin\(|fleetMember\(/);
  assert.match(block, /allow delete: if false/);
  assert.match(emu, /match \/receipts\/\{id\}/);
  assert.match(emu, /match \/xeroQueue\/\{id\}/);
  assert.doesNotMatch(block, /match \/receipts\/|match \/xeroQueue\/|match \/jobs\//);
  const cert = slice(storage, "// BEGIN LEAVE CERTIFICATE RULES", "// END LEAVE CERTIFICATE RULES");
  assert.match(cert, /request\.auth\.uid == uid \|\| lvCertAdmin\(uid\)/);
  assert.doesNotMatch(cert, /role == "supervisor"/);
  assert.equal(cert.split("firestore.get(").length - 1, 1);
  const doc = readFileSync(new URL("../rules-additions-leave.md", import.meta.url), "utf8");
  assert.match(doc, /BEGIN LEAVE RULES/);
  assert.match(doc, /BEGIN LEAVE CERTIFICATE RULES/);
  assert.match(doc, /isAlex/);
});
