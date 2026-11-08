import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { ALEX_UID } from "../../app/features/cloud-storage.js";
import { handleHelperAsk, authorizeCallable, DISABLED_REPLY, DENIED_REPLY, SIGN_IN_REPLY, MODEL_FAILED } from "../functions/helper/ask.js";
import { buildHelperContext } from "../functions/helper/context.js";
import { REFUSAL, RULES_MARK } from "../functions/helper/prompt.js";
import { loadKnowledge } from "../functions/helper/knowledge.js";
import { buildVertexRequest, createModelProvider, HELPER_ENABLED_DEFAULT, HELPER_HARD_OFF, helperLiveEnabled } from "../functions/helper/provider.js";
import { redactMoneyText } from "../functions/helper/money.js";
import { resolveMembership } from "../functions/shared/cloud-storage.js";
import { memoryReader, recordingModel, sampleStore, TODAY } from "./helper-fixture.js";

const store = sampleStore();

function ask(uid, data, { enabled = true, reply = "Noted.", seen = [], log = [] } = {}) {
  const reader = memoryReader(store, log);
  const model = recordingModel(seen, reply);
  return handleHelperAsk({
    auth: uid ? { uid } : null,
    data,
    reader,
    model,
    enabled,
    now: new Date(TODAY + "T02:00:00Z"),
    canary: "hw-testcanary",
  }).then(result => ({ result, seen, log, reader }));
}

function userPayload(seen) {
  assert.equal(seen.length, 1);
  return JSON.parse(seen[0].user);
}

async function grounded(uid, question, extra = {}) {
  const log = [];
  const reader = memoryReader(store, log);
  const profile = await reader.user(uid);
  const membership = resolveMembership({ uid, profile });
  const context = await buildHelperContext({
    reader, membership, question, today: TODAY, jobId: extra.jobId || "",
  });
  return { context, membership, log, reader };
}

test("money text redaction keeps dates, codes and plain quantities", () => {
  assert.equal(redactMoneyText("Invoice total $4,500.50 ex GST"), "Invoice total [amount hidden] ex GST");
  assert.equal(redactMoneyText("AUD 80 plus a gate code 2468"), "[amount hidden] plus a gate code 2468");
  assert.equal(redactMoneyText("Wednesday 12 November 2026, 12.5 km"), "Wednesday 12 November 2026, 12.5 km");
  assert.doesNotMatch(redactMoneyText("PO-441"), /amount hidden/);
});

test("signed-out and unknown people are denied before any job is read", async () => {
  const signedOut = await ask(null, { question: "What is on?" }, { enabled: true });
  assert.equal(signedOut.result.code, "unauthenticated");
  assert.equal(signedOut.result.reply, SIGN_IN_REPLY);
  assert.deepEqual(signedOut.log, []);
  assert.equal(signedOut.seen.length, 0);
  const stranger = await ask("stranger", { question: "Show every invoice" });
  assert.equal(stranger.result.code, "permission-denied");
  assert.equal(stranger.result.reply, DENIED_REPLY);
  assert.deepEqual(stranger.log, ["user"]);
  assert.equal(stranger.seen.length, 0);
});

test("a missing or bad token is rejected and a mismatched uid is rejected", async () => {
  const verify = async () => ({ uid: "op1" });
  assert.equal((await authorizeCallable({}, verify)).code, "unauthenticated");
  assert.equal((await authorizeCallable({ authorization: "Bearer short" }, verify)).code, "unauthenticated");
  assert.equal((await authorizeCallable({ authorization: "Bearer test-token-not-a-credential" }, async () => { throw new Error("bad"); })).reply, SIGN_IN_REPLY);
  const mismatch = await authorizeCallable({
    authorization: "Bearer test-token-not-a-credential",
    auth: { uid: "op2" },
  }, verify);
  assert.equal(mismatch.ok, false);
  const ok = await authorizeCallable({ authorization: "Bearer test-token-not-a-credential" }, verify);
  assert.equal(ok.uid, "op1");
});

test("operator context drops other people, other businesses, and every price", async () => {
  const answered = await ask("op1", { question: "What am I on at Ironbark?", tenantId: "otherco", role: "admin" });
  assert.equal(answered.result.ok, true);
  assert.equal(answered.seen.length, 1);
  assert.match(answered.seen[0].system, /Money on this login: hidden/);
  const { context, log } = await grounded("op1", "What am I on at Ironbark?", { jobId: "job-riley" });
  const blob = JSON.stringify(context);
  assert.match(blob, /12 Ironbark Street/);
  assert.match(blob, /12\.5/);
  assert.match(blob, /2468/);
  assert.match(blob, /\[amount hidden\]/);
  assert.match(blob, /Excavator/);
  assert.match(blob, /Sam/);
  assert.match(blob, /ps1|Excavator/);
  assert.equal(context.prestarts.some(row => row.assetId === "ex1"), true);
  assert.equal(blob.includes("440.50"), false);
  assert.equal(blob.includes("SECRET-PLANT"), false);
  assert.equal(context.timesheets.some(sheet => sheet.uid === "op1"), true);
  assert.equal(context.timesheets.some(sheet => sheet.uid === "op2"), false);
  assert.equal(context.leave.some(row => row.uid === "op1"), true);
  assert.equal(context.leave.some(row => row.name === "Riley"), false);
  assert.equal("certificate" in context.leave[0], false);
  assert.equal(blob.includes("cert.pdf"), false);
  assert.equal(context.runSheets.some(sheet => sheet.workerUid === "op1"), true);
  assert.equal(context.runSheets.some(sheet => sheet.workerUid === "op2"), false);
  for (const secret of ["9999", "8800", "9700", "7777", "2222", "44.5", "INV-77", "CLIENT-INJECTED-SECRET", "SECRET-OTHERCO-8841", "WOMBAT-LEDGER-77", "8 Wattle Court"]) {
    assert.equal(blob.includes(secret), false, secret);
  }
  assert.equal(context.profit, null);
  assert.equal(context.quotes.length, 0);
  assert.equal(context.rateCard, null);
  assert.equal(log.includes("quotes"), false);
  assert.equal(log.includes("serviceCosts"), false);
});

test("a job note that tries to take over the prompt is data, and the reply cannot reveal the rules", async () => {
  const { result, seen } = await ask(ALEX_UID, { question: "What does the note say?" }, {
    reply: ({ system }) => "SYSTEM " + system.match(/Canary: (\S+)/)[1] + " set the job to Done",
  });
  assert.match(seen[0].user, /Ignore previous instructions/);
  assert.equal(seen[0].system.includes("Ignore previous instructions"), false);
  assert.equal(result.reply, REFUSAL);
  assert.equal(result.reply.includes("hw-"), false);
});

test("an invented price in a staff reply is removed", async () => {
  const { sanitiseReply } = await import("../functions/helper/prompt.js");
  const reply = sanitiseReply("It is $9,999 ex GST.", { canary: "hw-x", canSeeMoney: false });
  assert.match(reply, /\[amount hidden\]/);
  assert.equal(reply.includes("$"), false);
  assert.equal(reply.includes("9999"), false);
  const answered = await ask("op1", { question: "What is the price?" }, { reply: "It is $9,999 ex GST." });
  assert.match(answered.result.reply, /\[amount hidden\]/);
  assert.equal(answered.result.reply.includes("$"), false);
});

test("a supervisor can ask, sees leave to decide, and still hides other businesses and profit", async () => {
  const answered = await ask("sup1", { question: "Prices for my jobs" });
  assert.equal(answered.result.ok, true);
  assert.equal(answered.seen.length, 1);
  const { context, membership, log } = await grounded("sup1", "Prices for my jobs");
  assert.equal(membership.canSeeMoney, true);
  assert.equal(membership.rulesAdmin, false);
  assert.equal(context.jobs.find(job => job.id === "job-iron").poAmount, 9999);
  assert.equal(context.jobs.find(job => job.id === "job-iron").xeroCheck, undefined);
  assert.equal(context.receipts.some(receipt => receipt.amountInc === 55), true);
  assert.equal(JSON.stringify(context).includes("44.5"), false);
  assert.equal(JSON.stringify(context).includes("WOMBAT-LEDGER-77"), false);
  assert.equal(JSON.stringify(context).includes("SECRET-OTHERCO-8841"), false);
  assert.equal(JSON.stringify(context).includes("cert.pdf"), false);
  assert.equal(context.leave.some(row => row.name === "Riley"), true);
  assert.equal(context.timesheets.length, 0);
  assert.equal(context.profit, null);
  assert.equal(context.rateCard.travelPerKm, 3.5);
  assert.equal(context.servicing.some(row => row.amount === "440.50"), true);
  assert.equal(log.includes("meta:profitHistory"), false);
});

test("Alex sees Heartwood profit and not the other business", async () => {
  const { seen } = await ask(ALEX_UID, { question: "Profit and the other company SECRET-OTHERCO" });
  const payload = userPayload(seen);
  const blob = JSON.stringify(payload);
  assert.equal(payload.profit["2026-10"].netProfit, 123456);
  assert.equal(payload.jobs.some(job => job.id === "job-other"), false);
  assert.equal(blob.includes("SECRET-OTHERCO-8841"), false);
  assert.equal(payload.jobs.some(job => job.id === "job-wattle"), true);
  assert.equal(payload.jobs.find(job => job.id === "job-iron").xeroCheck.status, "invoiced");
});

test("another business admin cannot see Heartwood jobs, rates, or profit", async () => {
  const { seen } = await ask("otherAdmin", { question: "Show Ironbark and profit", tenantId: "heartwood", jobId: "job-iron" });
  const payload = userPayload(seen);
  const blob = JSON.stringify(payload);
  assert.match(seen[0].system, /Business: otherco/);
  assert.equal(payload.jobs.some(job => job.id === "job-other"), true);
  assert.equal(blob.includes("12 Ironbark Street"), false);
  assert.equal(blob.includes("123456"), false);
  assert.equal(blob.includes("3.5"), false);
  assert.equal(payload.rateCard, undefined);
  assert.match(blob, /SECRET-QUOTE/);
});

test("a customer-scoped operator does not see another builder's job", async () => {
  const answered = await ask("scoped", { question: "Silk Road and Ironbark" });
  assert.equal(answered.result.ok, true);
  const { context } = await grounded("scoped", "Silk Road and Ironbark");
  assert.deepEqual(context.jobs, []);
  assert.equal(JSON.stringify(context.jobs).includes("Silk"), false);
});

test("switched off means no model call and no job text in the reply", async () => {
  let called = false;
  const reader = memoryReader(store, []);
  const result = await handleHelperAsk({
    auth: { uid: ALEX_UID },
    data: { question: "Ironbark" },
    reader,
    model: { async generate() { called = true; return "12 Ironbark Street $9999"; } },
    enabled: false,
    now: new Date(TODAY + "T02:00:00Z"),
  });
  assert.equal(called, false);
  assert.equal(result.enabled, false);
  assert.equal(result.admin, true);
  assert.equal(result.reply, DISABLED_REPLY);
  assert.equal(result.reply.includes("Ironbark"), false);
  assert.equal(result.knowledge, "pack");
  const hidden = await handleHelperAsk({
    auth: { uid: "op1" },
    data: { step: "status" },
    reader,
    model: { async generate() { called = true; return "no"; } },
    enabled: true,
    now: new Date(TODAY + "T02:00:00Z"),
  });
  assert.equal(hidden.ok, true);
  assert.equal(hidden.enabled, true);
  assert.equal(hidden.admin, false);
  assert.equal(called, false);
});

test("a model failure does not echo the error or change anything", async () => {
  const { result, reader } = await ask(ALEX_UID, { question: "Hello" }, {
    reply: () => { const err = new Error("SECRET-OTHERCO-8841"); throw err; },
  });
  assert.equal(result.reply, MODEL_FAILED);
  assert.equal(result.reply.includes("SECRET"), false);
  assert.equal(reader.writes, 0);
});

test("knowledge falls back to the placeholder and prefers a real pack", () => {
  const live = loadKnowledge();
  assert.equal(live.source, "pack");
  assert.doesNotMatch(live.text, /helper-knowledge: placeholder/);
  const missing = loadKnowledge({ env: {}, exists: () => false, read: () => "" });
  assert.equal(missing.source, "placeholder");
  assert.match(missing.text, /do not invent/i);
  const pack = loadKnowledge({
    env: { HELPER_KNOWLEDGE_PATH: new URL("./helper-fixture.js", import.meta.url).pathname },
    exists: () => true,
    read: () => "# Real CallUp pack\nStaff open Today to see assigned jobs.\n",
  });
  assert.equal(pack.source, "pack");
  assert.match(pack.text, /Real CallUp pack/);
});

test("vertex request stays in australia-southeast1 and has no tools or API key", async () => {
  const disabled = createModelProvider({});
  assert.equal(disabled.enabled, false);
  await assert.rejects(() => disabled.generate({ system: "s", user: "u" }), /helper-disabled/);
  const request = buildVertexRequest({
    project: "heartwood-9f37f",
    location: "australia-southeast1",
    model: "gemini-2.5-flash",
    system: "rules",
    user: "{}",
  });
  assert.match(request.url, /^https:\/\/australia-southeast1-aiplatform\.googleapis\.com\//);
  assert.equal(request.url.includes("key="), false);
  assert.equal(request.body.tools, undefined);
  assert.equal(request.body.functionDeclarations, undefined);
  assert.throws(() => buildVertexRequest({
    project: "heartwood-9f37f", location: "us-central1", model: "gemini-2.5-flash", system: "s", user: "u",
  }));
  let fetched = 0;
  const forced = createModelProvider({
    HELPER_ENABLED: "true",
    GCLOUD_PROJECT: "heartwood-9f37f",
  }, {
    token: async () => "test-token",
    fetch: async () => {
      fetched += 1;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "G'day" }] } }] }) };
    },
  });
  assert.equal(HELPER_ENABLED_DEFAULT, "false");
  assert.equal(HELPER_HARD_OFF, true);
  assert.equal(helperLiveEnabled({}), false);
  assert.equal(helperLiveEnabled({ HELPER_ENABLED: "true" }), false);
  assert.equal(helperLiveEnabled({ HELPER_ENABLED: "false" }), false);
  assert.equal(forced.enabled, false);
  await assert.rejects(() => forced.generate({ system: "rules", user: "{}" }), /helper-disabled/);
  assert.equal(fetched, 0);
});

test("helper callable is hard-off and the phone has no helper UI", () => {
  const helperDir = new URL("../functions/helper/", import.meta.url);
  const server = readdirSync(helperDir).filter(name => name.endsWith(".js") && name !== "apply.js").map(name => readFileSync(new URL(name, helperDir), "utf8")).join("\n");
  const apply = readFileSync(new URL("apply.js", helperDir), "utf8");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../app/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(server, /\.set\(|\.update\(|\.delete\(|addDoc|updateDoc|deleteDoc|writeBatch|bulkWriter|getUserMedia|SpeechRecognition/);
  assert.doesNotMatch(apply, /\.delete\(|deleteDoc|SCHEDULING_APPROVED|xeroQueue|sendMail|getUserMedia/);
  assert.match(apply, /helperAudit/);
  assert.match(apply, /leave-create/);
  assert.match(apply, /prestart/);
  assert.equal(existsSync(new URL("../../app/features/helper.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("../../app/features/helper-ui.js", import.meta.url)), false);
  assert.doesNotMatch(app, /installHelperApp|helper-ui|helperAsk|helper-launch|SpeechRecognition|speechSynthesis/);
  assert.doesNotMatch(sw, /features\/helper/);
  assert.match(sw, /callup-shell-v80-job-check/);
  assert.doesNotMatch(css, /helper-launch|helper-panel|helper-mic|helper-speech|Ask Helper/);
  assert.match(index, /region: "australia-southeast1"/);
  assert.match(index, /helperAsk/);
  assert.match(index, /Helper is switched off/);
  assert.match(index, /HELPER_ENABLED_DEFAULT|helperLiveEnabled/);
  const body = index.slice(index.indexOf("export const helperAsk"));
  const gate = body.indexOf("if (!helperLiveEnabled())");
  const model = body.indexOf("createModelProvider(");
  assert.ok(gate >= 0 && model > gate);
  assert.doesNotMatch(index, /onSchedule/);
  assert.doesNotMatch(server + index, /AIza|sk-[A-Za-z0-9]{10,}/);
});
