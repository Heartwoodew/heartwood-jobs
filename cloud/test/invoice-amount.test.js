// 12 Nov 2026: the invoice price (invoiceAmount) is office-only job money (jobMoney/{jobId}), off the crew-readable job.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JOB_MONEY_KEYS, splitJobMoney, mergeJobMoney, stripJobMoney, jobMoneyDoc } from "../../app/features/job-money.js";
import { planInvoiceAmount, planOfficeMoney, parseInvoiceArgs, migrateInvoiceAmount } from "../scripts/migrate-office-money.mjs";
import { planJobMoney } from "../scripts/migrate-job-money.mjs";
import { adminReader } from "../functions/helper/reader.js";

const read = rel => readFileSync(new URL(rel, import.meta.url), "utf8");

test("invoiceAmount is a job money key: split off the job, merged for the office, stripped for crew", () => {
  assert.ok(JOB_MONEY_KEYS.includes("invoiceAmount"));
  const sp = splitJobMoney({ invoiceAmount: 640, invoiceDescription: "Spoil", updatedBy: "u" }, () => "DELETE");
  assert.deepEqual(sp.money, { invoiceAmount: 640 });
  assert.deepEqual(sp.job, { invoiceAmount: "DELETE", invoiceDescription: "Spoil", updatedBy: "u" });
  assert.equal(splitJobMoney({ invoiceAmount: null }).money.invoiceAmount, null);
  assert.equal(mergeJobMoney({ id: "a", invoiceAmount: 1 }, { invoiceAmount: 2 }).invoiceAmount, 2);
  assert.equal(mergeJobMoney({ id: "a", invoiceAmount: 1 }, { poAmount: 3 }).invoiceAmount, 1, "legacy copy is the fallback");
  assert.equal("invoiceAmount" in stripJobMoney({ id: "a", invoiceAmount: 1 }), false);
  assert.deepEqual(jobMoneyDoc("j1", "heartwood", { invoiceAmount: 5 }), { jobId: "j1", companyId: "heartwood", invoiceAmount: 5 });
});

test("the old job-money migration leaves invoiceAmount to its own script", () => {
  const p = planJobMoney("j1", { invoiceAmount: 99, poAmount: 1 });
  assert.deepEqual(p.remove, ["poAmount"]);
  assert.equal(p.money.invoiceAmount, undefined);
});

test("planInvoiceAmount: copy, remove-only, conflict, skip; never overwrites jobMoney", () => {
  assert.equal(planInvoiceAmount("a", { po: "1" }).action, "skip");
  const c = planInvoiceAmount("a", { invoiceAmount: 700, companyId: "heartwood" }, { poAmount: 650 });
  assert.equal(c.action, "copy-and-remove");
  assert.deepEqual(c.money, { jobId: "a", companyId: "heartwood", invoiceAmount: 700 });
  assert.deepEqual(planInvoiceAmount("b", { invoiceAmount: 5, companyId: "bravo", tenantId: "bravo" }).money, { jobId: "b", companyId: "bravo", tenantId: "bravo", invoiceAmount: 5 });
  assert.equal(planInvoiceAmount("a", { invoiceAmount: 700 }, { invoiceAmount: 700 }).action, "remove");
  assert.equal(planInvoiceAmount("a", { invoiceAmount: 700 }, { invoiceAmount: 800 }).action, "conflict");
  assert.equal(planInvoiceAmount("a", { invoiceAmount: "abc" }).action, "conflict");
  assert.equal(planInvoiceAmount("a", { invoiceAmount: "12.5" }).money.invoiceAmount, 12.5);
  assert.equal(planInvoiceAmount("a", { invoiceAmount: null }).money.invoiceAmount, null);
});

test("parseInvoiceArgs: dry run by default, --apply writes, production needs --project and a backup", () => {
  assert.deepEqual(parseInvoiceArgs([], { FIRESTORE_EMULATOR_HOST: "x" }).mode, "dry-run");
  assert.equal(parseInvoiceArgs(["--apply"], { FIRESTORE_EMULATOR_HOST: "x" }).apply, true);
  assert.equal(parseInvoiceArgs([], {}).reason, "emulator-required");
  assert.equal(parseInvoiceArgs([], { GCLOUD_PROJECT: "heartwood-9f37f" }).reason, "explicit-project");
  assert.equal(parseInvoiceArgs(["--project", "heartwood-9f37f"], { FIRESTORE_EMULATOR_HOST: "x" }).reason, "emulator-host");
  const live = parseInvoiceArgs(["--project", "heartwood-9f37f"], {});
  assert.equal(live.ok, true); assert.equal(live.live, true); assert.equal(live.apply, false);
  assert.equal(parseInvoiceArgs(["--project", "heartwood-9f37f", "--apply"], {}).reason, "backup-required");
  assert.equal(parseInvoiceArgs(["--project", "heartwood-9f37f", "--apply", "--backup", "/tmp/b.json"], {}).ok, true);
  assert.equal(parseInvoiceArgs(["--commit"], { FIRESTORE_EMULATOR_HOST: "x" }).ok, false);
});

function fakeStore(jobs, money) {
  const J = new Map(Object.entries(structuredClone(jobs))), M = new Map(Object.entries(structuredClone(money)));
  const log = [];
  return { J, M, log, store: {
    async jobs() { return [...J].map(([id, data]) => ({ id, data: structuredClone(data) })); },
    async money(id) { return M.has(id) ? structuredClone(M.get(id)) : null; },
    async job(id) { return J.has(id) ? structuredClone(J.get(id)) : null; },
    async setMoney(id, d) { log.push("money:" + id); M.set(id, { ...(M.get(id) || {}), ...d }); },
    async updateJob(id, d) { log.push("job:" + id); const cur = { ...J.get(id) }; for (const [k, v] of Object.entries(d)) { if (v === "DEL") delete cur[k]; else cur[k] = v; } J.set(id, cur); },
    removeField: () => "DEL", now: () => "2026-11-12T00:00:00.000Z",
  } };
}

test("migrateInvoiceAmount: dry run writes nothing and reports no amounts; apply backs up first, moves, verifies", async () => {
  const jobs = { a: { companyId: "heartwood", status: "Done", invoiceAmount: 1234.5, assigned: ["op"], invoiced: true }, b: { status: "Done", invoiceAmount: 77 },
    c: { status: "Done", invoiceAmount: 88 }, d: { status: "Scheduled" } };
  const money = { b: { jobId: "b", companyId: "heartwood", invoiceAmount: 77 }, c: { jobId: "c", companyId: "heartwood", invoiceAmount: 99 } };
  const f = fakeStore(jobs, money);
  const dry = await migrateInvoiceAmount(null, { store: f.store });
  assert.equal(f.log.length, 0);
  assert.deepEqual([dry.scanned, dry.withInvoiceAmount, dry.copyAndRemove, dry.removeOnly, dry.crewAssigned, dry.done, dry.invoiced], [4, 3, 1, 1, 1, 3, 1]);
  assert.deepEqual(dry.conflicts, ["jobs/c"]);
  assert.doesNotMatch(JSON.stringify(dry), /1234|77|88|99/);
  let backup = null;
  const rep = await migrateInvoiceAmount(null, { apply: true, store: f.store, writeBackup: async b => { assert.equal(f.log.length, 0, "backup before any write"); backup = b; } });
  assert.equal(backup.rows.length, 2);
  assert.deepEqual(backup.rows.find(r => r.path === "jobs/a"), { path: "jobs/a", companyId: "heartwood", job: { invoiceAmount: 1234.5 },
    jobMoneyBefore: { invoiceAmount: "(missing)" }, actions: { invoiceAmount: "copy-and-remove" } });
  assert.deepEqual(f.log, ["money:a", "job:a", "job:b"], "jobMoney is written before the job loses the field; conflict c untouched");
  assert.equal(rep.verified, 2); assert.deepEqual(rep.verifyFailed, []);
  assert.equal("invoiceAmount" in f.J.get("a"), false); assert.equal(f.M.get("a").invoiceAmount, 1234.5);
  assert.equal(f.J.get("c").invoiceAmount, 88); assert.equal(f.M.get("c").invoiceAmount, 99);
  const again = await migrateInvoiceAmount(null, { store: f.store });
  assert.equal(again.copyAndRemove + again.removeOnly, 0);
});

test("app: invoice price saves go to jobMoney; numbering moves it in the same transaction", () => {
  const app = read("../../app/app.js");
  const bind = app.slice(app.indexOf("function bindInvoices"), app.indexOf("async function assignNumbers"));
  assert.match(bind, /const save = \(el, field, conv\) => el\.onchange = async \(\) => \{[^}]*await writeJob\(id, \{ \[field\]/);
  assert.doesNotMatch(bind, /updateDoc\(doc\(db, "jobs", id\), \{ \[field\]/);
  const num = app.slice(app.indexOf("async function assignNumbers"), app.indexOf("async function markInvoiced"));
  assert.match(num, /tx\.update\(doc\(db, "jobs", j\.id\), \{ \.\.\.f, invoiceAmount: deleteField\(\) \}\)/);
  assert.match(num, /tx\.set\(doc\(db, JOB_MONEY_COLLECTION, j\.id\), jobMoneyDoc\(j\.id, myCompanyId\(\), \{ invoiceAmount: j\.invoiceAmount \}/);
  assert.doesNotMatch(num.split("const f = {")[1].split("};")[0], /invoiceAmount/);
});

test("rules: invoiceAmount is a job money key, allowed (number) on jobMoney, and even the box can't put it on a job", () => {
  const rules = read("../firestore.production.rules");
  assert.match(rules, /function jobMoneyKeys\(\) \{ return \[[^\]]*"invoiceAmount", "xeroCheck"\]; \}/);
  assert.match(rules, /"splitUndoPoAmount", "poLookupCandidates", "invoiceAmount", "xeroCheck", "migratedAt"/);
  assert.match(rules, /d\.get\("invoiceAmount", null\) == null \|\| d\.invoiceAmount is number/);
  assert.match(rules, /allow create: if \(isSync\(\) && syncJobCreateOk\(\)\)/);
  assert.match(rules, /\(isSync\(\) && syncJobUpdateOk\(\)\)/);
});

test("helper reader merges invoiceAmount from jobMoney for office answers", async () => {
  const docs = { "jobs/j1": { status: "Done", invoiceAmount: 1 }, "jobMoney/j1": { invoiceAmount: 640 } };
  const ref = path => ({ path, async get() { const d = docs[path]; return { id: path.split("/")[1], exists: !!d, data: () => d }; } });
  const db = { collection: c => ({ doc: id => ref(c + "/" + id) }), async getAll(...refs) { return Promise.all(refs.map(r => r.get())); } };
  const job = await adminReader(db).job("j1");
  assert.equal(job.invoiceAmount, 640);
});

test("xeroCheck (Xero match: totalEx, amountDue) is job money too, moved per field", () => {
  assert.ok(JOB_MONEY_KEYS.includes("xeroCheck"));
  const xc = { checkedAt: "2026-11-01T08:00:00+10:00", status: "invoiced", matches: [{ invoiceNumber: "5401", totalEx: 900, amountDue: 0 }] };
  const p = planOfficeMoney("j", { invoiceAmount: 900, xeroCheck: xc }, null);
  assert.deepEqual(p.remove.sort(), ["invoiceAmount", "xeroCheck"]);
  assert.deepEqual(p.money.xeroCheck, xc);
  const q = planOfficeMoney("j", { invoiceAmount: 900, xeroCheck: xc }, { invoiceAmount: 901, xeroCheck: JSON.parse(JSON.stringify(xc)) });
  assert.deepEqual(q.remove, ["xeroCheck"], "same xeroCheck -> remove only");
  assert.deepEqual(q.conflicts, ["invoiceAmount"], "different price -> left on the job");
  assert.equal(q.money, null);
  assert.equal(stripJobMoney({ xeroCheck: xc }).xeroCheck, undefined);
  const rules = read("../firestore.production.rules");
  assert.match(rules, /d\.get\("xeroCheck", null\) == null \|\| d\.xeroCheck is map/);
  assert.match(rules, /function syncDeniedJobKeys\(\) \{ return \["invoiceAmount", "xeroCheck"\]; \}/);
});
