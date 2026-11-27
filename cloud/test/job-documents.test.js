// Job document planning, crew visibility and the documents section. No emulator.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DOC_MAX_BYTES, OFFLINE_COPY, OFFLINE_FAIL_COPY, PRICE_HINT,
  canManageDocuments, classifyFile, planDocumentUpload, visibleDocuments,
  documentsSectionHtml, formatBytes, documentKind, shouldQueueUpload,
  flushDocumentQueue, memoryQueue, queueRow,
} from "../../app/features/job-documents.js";

const pdf = (name = "plan.pdf", size = 1200, type = "application/pdf") => ({ name, size, type });

test("office can manage documents and crew cannot", () => {
  for (const role of ["admin", "manager", "supervisor"]) assert.equal(canManageDocuments(role), true);
  for (const role of ["operator", "labourer", "", "staff"]) assert.equal(canManageDocuments(role), false);
});

test("accepted files are pdf, images, word, excel and drawings under 25 MB", () => {
  assert.equal(classifyFile(pdf()).ok, true);
  assert.equal(classifyFile(pdf("a.docx", 10, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).ok, true);
  assert.equal(classifyFile(pdf("a.xlsx", 10, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).ok, true);
  assert.equal(classifyFile(pdf("shot.jpg", 10, "image/jpeg")).contentType, "image/jpeg");
  assert.equal(classifyFile(pdf("shot.jpg", 10, "image/jpg")).contentType, "image/jpeg");
  assert.equal(classifyFile(pdf("site.dwg", 10, "application/octet-stream")).ok, true);
  assert.equal(classifyFile(pdf("site.DXF", 10, "")).ok, true);
  assert.equal(classifyFile(pdf("notes.txt", 10, "application/octet-stream")).reason, "type-not-allowed");
  assert.equal(classifyFile(pdf("run.exe", 10, "application/octet-stream")).reason, "type-not-allowed");
  assert.equal(classifyFile(pdf("empty.pdf", 0)).reason, "empty-file");
  assert.equal(classifyFile(pdf("big.pdf", DOC_MAX_BYTES + 1)).reason, "too-large");
  assert.equal(classifyFile(pdf("edge.pdf", DOC_MAX_BYTES)).ok, true);
});

test("an upload is stored under the company and job, crew-visible unless marked office", () => {
  const plan = planDocumentUpload({
    companyId: "acme", jobId: "job1", uid: "sup1", uploaderName: "Sue",
    file: pdf("Level 1.pdf"), displayName: "  Ground floor  ", docId: "dGroundFloor1",
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.path, "tenants/acme/jobs/job1/documents/dGroundFloor1");
  assert.equal(plan.visibility, "crew");
  assert.equal(plan.firestore.name, "Ground floor");
  assert.equal(plan.firestore.companyId, "acme");
  assert.equal(plan.firestore.tenantId, "acme");
  assert.equal(plan.metadata.purpose, "job-document");
  assert.equal(plan.metadata.visibility, "crew");
  const office = planDocumentUpload({
    companyId: "heartwood", jobId: "hw1", uid: "alex", uploaderName: "Alex",
    file: pdf("quote.pdf"), visibility: "office", docId: "dQuoteFile1234",
  });
  assert.equal(office.firestore.visibility, "office");
  assert.equal(office.path.startsWith("tenants/heartwood/jobs/hw1/documents/"), true);
  assert.equal(planDocumentUpload({ companyId: "", jobId: "job1", uid: "sup1", file: pdf() }).reason, "not-allowed");
});

test("crew only see documents marked for them", () => {
  const docs = [
    { id: "a", name: "Plan", visibility: "crew", createdAt: "2026-11-01" },
    { id: "b", name: "Quote 440", visibility: "office", createdAt: "2026-11-02" },
  ];
  assert.deepEqual(visibleDocuments(docs, "operator").map(d => d.name), ["Plan"]);
  assert.deepEqual(visibleDocuments(docs, "labourer").map(d => d.name), ["Plan"]);
  assert.deepEqual(visibleDocuments(docs, "supervisor").map(d => d.name), ["Quote 440", "Plan"]);
  assert.deepEqual(visibleDocuments(docs, "manager").map(d => d.id), ["b", "a"]);
});

test("the section shows name, type, size, uploader and date, and hides prices from crew", () => {
  const docs = [
    { id: "a", name: "Site plan", fileName: "plan.pdf", contentType: "application/pdf", size: 2400, visibility: "crew", uploaderName: "Sue", createdAt: "2026-11-02T00:00:00.000Z" },
    { id: "b", name: "Invoice 12", fileName: "inv.pdf", contentType: "application/pdf", size: 900, visibility: "office", uploaderName: "Alex", createdAt: "2026-11-03T00:00:00.000Z" },
  ];
  const office = documentsSectionHtml({ jobId: "job1", role: "supervisor", docs });
  assert.match(office, /Documents/);
  assert.match(office, /Add documents/);
  assert.match(office, /Take photo/);
  assert.match(office, new RegExp(PRICE_HINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(office, /Site plan/);
  assert.match(office, /Invoice 12/);
  assert.match(office, /Sue/);
  assert.match(office, /Alex/);
  assert.match(office, /PDF/);
  assert.match(office, new RegExp(formatBytes(2400)));
  assert.match(office, /Office only/);
  assert.match(office, /Crew can see/);
  assert.match(office, /Delete/);
  assert.match(office, /Rename/);
  assert.match(office, /data-doc-open="b"/);
  const crew = documentsSectionHtml({ jobId: "job1", role: "labourer", docs, queued: [{ id: "q1", name: "Levels", jobId: "job1" }] });
  assert.doesNotMatch(crew, /Invoice 12/);
  assert.doesNotMatch(crew, /Add documents/);
  assert.doesNotMatch(crew, /Take photo/);
  assert.doesNotMatch(crew, /Delete/);
  assert.match(crew, /Site plan/);
  assert.match(crew, /data-doc-open="a"/);
  assert.equal(documentKind("application/octet-stream", "slab.dwg").icon, "DWG");
  const offline = documentsSectionHtml({ jobId: "job1", role: "admin", docs: [], offline: true });
  assert.match(offline, new RegExp(OFFLINE_COPY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("a failed upload is queued when the phone is offline and dropped when the rules refuse it", async () => {
  assert.equal(shouldQueueUpload({ online: false }), true);
  assert.equal(shouldQueueUpload({ online: true, error: { code: "storage/retry-limit-exceeded" } }), true);
  assert.equal(shouldQueueUpload({ online: true, error: { message: "Failed to fetch" } }), true);
  assert.equal(shouldQueueUpload({ online: true, error: { code: "storage/unauthorized" } }), false);
  const queue = memoryQueue();
  const planned = planDocumentUpload({
    companyId: "heartwood", jobId: "hw1", uid: "sup1", uploaderName: "Sue",
    file: pdf(), docId: "dQueuedFile1234",
  });
  await queue.put(queueRow(planned, pdf(), "sup1"));
  const held = await flushDocumentQueue({
    queue, uid: "sup1", online: false, upload: async () => { throw new Error("should not run"); }, writeDoc: async () => {},
  });
  assert.equal(held.uploaded, 0);
  assert.equal(held.kept, 1);
  let writes = 0;
  const sent = await flushDocumentQueue({
    queue, uid: "sup1", online: true,
    upload: async () => {},
    writeDoc: async () => { writes += 1; },
  });
  assert.equal(sent.uploaded, 1);
  assert.equal(writes, 1);
  assert.equal((await queue.list("sup1")).length, 0);
  await queue.put(queueRow(planned, pdf(), "sup1"));
  const refused = await flushDocumentQueue({
    queue, uid: "sup1", online: true,
    upload: async () => { const err = new Error("no"); err.code = "storage/unauthorized"; throw err; },
    writeDoc: async () => {},
  });
  assert.equal(refused.uploaded, 0);
  assert.equal((await queue.list("sup1")).length, 0);
  assert.match(OFFLINE_FAIL_COPY, /not uploaded/);
});

test("production and emulator document rules match, and the shell cache includes them", () => {
  const prod = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const slice = text => text.slice(text.indexOf("// BEGIN JOB DOCUMENT RULES"), text.indexOf("// END JOB DOCUMENT RULES"));
  assert.equal(slice(prod), slice(emu));
  assert.match(prod, /company == "heartwood" \|\| companyNotPaused\(company\)/);
  assert.match(prod, /actor\.role in \["admin", "manager", "supervisor"\]/);
  assert.match(prod, /actor\.role in \["operator", "labourer"\]/);
  const storageProd = readFileSync(new URL("../production/storage.rules", import.meta.url));
  const storageEmu = readFileSync(new URL("../emulator/storage.rules", import.meta.url));
  assert.equal(storageProd.equals(storageEmu), true);
  assert.match(storageProd.toString(), /purpose == "job-document"/);
  assert.match(storageProd.toString(), /25 \* 1024 \* 1024/);
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v164/);
  assert.match(sw, /features\/job-documents\.js/);
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.match(app, /data-job-docs/);
  assert.match(app, /uploadBytesResumable/);
});
