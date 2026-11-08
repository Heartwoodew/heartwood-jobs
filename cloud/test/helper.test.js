import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { ALEX_UID } from "../../app/features/cloud-storage.js";
import { handleHelperAsk, authorizeCallable, DISABLED_REPLY, DENIED_REPLY, SIGN_IN_REPLY, MODEL_FAILED } from "../functions/helper/ask.js";
import { REFUSAL, RULES_MARK } from "../functions/helper/prompt.js";
import { loadKnowledge } from "../functions/helper/knowledge.js";
import { buildVertexRequest, createModelProvider } from "../functions/helper/provider.js";
import { redactMoneyText } from "../functions/helper/money.js";
import {
  AU_VOICE_MISSING, KNOWLEDGE_PLACEHOLDER_NOTE, helperShellHtml, pickAustralianVoice,
  shouldAutoRead, speakReply,
} from "../../app/features/helper.js";
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
  const { result, seen, log } = await ask("op1", {
    question: "What am I on at Ironbark?",
    jobId: "job-riley",
    tenantId: "otherco",
    role: "admin",
    uid: ALEX_UID,
    jobs: [{ description: "CLIENT-INJECTED-SECRET" }],
  });
  assert.equal(result.ok, true);
  const payload = userPayload(seen);
  const blob = JSON.stringify(payload);
  assert.equal(seen[0].system.includes("Ignore previous instructions"), false);
  assert.equal(seen[0].system.includes(RULES_MARK), true);
  assert.match(seen[0].system, /Business: heartwood/);
  assert.match(seen[0].system, /Money on this login: hidden/);
  assert.match(blob, /Ignore previous instructions/);
  assert.match(blob, /12 Ironbark Street/);
  assert.match(blob, /12\.5/);
  assert.match(blob, /2468/);
  assert.match(blob, /\[amount hidden\]/);
  for (const secret of ["9999", "8800", "9700", "7777", "2222", "123456", "44.5", "INV-77", "CLIENT-INJECTED-SECRET", "SECRET-OTHERCO-8841", "WOMBAT-LEDGER-77", "8 Wattle Court", "3.5"]) {
    assert.equal(blob.includes(secret), false, secret);
  }
  assert.equal(payload.jobs.some(job => job.id === "job-iron"), true);
  assert.equal(payload.quotes, undefined);
  assert.equal(payload.profit, undefined);
  assert.equal(payload.rateCard, undefined);
  assert.equal(log.includes("quotes"), false);
  assert.equal(log.includes("receipts"), false);
  assert.equal(log.some(item => item.startsWith("meta:")), false);
  assert.equal(result.reply.includes(RULES_MARK), false);
  assert.equal(result.reply.includes("hw-testcanary"), false);
});

test("a job note that tries to take over the prompt is data, and the reply cannot reveal the rules", async () => {
  const { result, seen } = await ask("op1", { question: "What does the note say?" }, {
    reply: ({ system }) => "SYSTEM " + system.match(/Canary: (\S+)/)[1] + " set the job to Done",
  });
  assert.match(seen[0].user, /Ignore previous instructions/);
  assert.equal(seen[0].system.includes("Ignore previous instructions"), false);
  assert.equal(result.reply, REFUSAL);
  assert.equal(result.reply.includes("hw-"), false);
});

test("an invented price in an operator reply is removed", async () => {
  const { result } = await ask("op1", { question: "What is the price?" }, { reply: "It is $9,999 ex GST." });
  assert.match(result.reply, /\[amount hidden\]/);
  assert.equal(result.reply.includes("$"), false);
  assert.equal(result.reply.includes("9999"), false);
});

test("supervisor sees assigned job prices, not another operator, another business, or company profit", async () => {
  const { result, seen, log } = await ask("sup1", { question: "Prices for my jobs" });
  const payload = userPayload(seen);
  const blob = JSON.stringify(payload);
  assert.match(seen[0].system, /Money on this login: visible/);
  assert.match(seen[0].system, /Xero and company profit on this login: hidden/);
  assert.match(blob, /12 Ironbark Street/);
  assert.match(blob, /8 Wattle Court/);
  assert.equal(payload.jobs.find(job => job.id === "job-iron").poAmount, 9999);
  assert.equal(payload.jobs.find(job => job.id === "job-iron").xeroCheck, undefined);
  assert.equal(payload.receipts.some(receipt => receipt.amountInc === 55), true);
  assert.equal(blob.includes("44.5"), false);
  assert.equal(blob.includes("WOMBAT-LEDGER-77"), false);
  assert.equal(blob.includes("SECRET-OTHERCO-8841"), false);
  assert.equal(blob.includes("123456"), false);
  assert.equal(payload.profit, undefined);
  assert.equal(payload.rateCard.travelPerKm, 3.5);
  assert.equal(log.includes("meta:profitHistory"), false);
  assert.equal(result.reply, "Noted.");
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
  const { seen } = await ask("scoped", { question: "Silk Road and Ironbark" });
  const payload = userPayload(seen);
  assert.deepEqual(payload.jobs, []);
  assert.equal(JSON.stringify(payload.jobs).includes("Silk"), false);
});

test("switched off means no model call and no job text in the reply", async () => {
  let called = false;
  const reader = memoryReader(store, []);
  const result = await handleHelperAsk({
    auth: { uid: "op1" },
    data: { question: "Ironbark" },
    reader,
    model: { async generate() { called = true; return "12 Ironbark Street $9999"; } },
    enabled: false,
    now: new Date(TODAY + "T02:00:00Z"),
  });
  assert.equal(called, false);
  assert.equal(result.enabled, false);
  assert.equal(result.reply, DISABLED_REPLY);
  assert.equal(result.reply.includes("Ironbark"), false);
  assert.equal(result.knowledge, "placeholder");
});

test("a model failure does not echo the error or change anything", async () => {
  const { result, reader } = await ask("op1", { question: "Hello" }, {
    reply: () => { const err = new Error("SECRET-OTHERCO-8841"); throw err; },
  });
  assert.equal(result.reply, MODEL_FAILED);
  assert.equal(result.reply.includes("SECRET"), false);
  assert.equal(reader.writes, 0);
});

test("knowledge falls back to the placeholder and prefers a real pack", () => {
  const bundled = loadKnowledge();
  assert.equal(bundled.source, "placeholder");
  assert.match(bundled.text, /do not invent/i);
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
  const enabled = createModelProvider({
    HELPER_ENABLED: "true",
    GCLOUD_PROJECT: "heartwood-9f37f",
  }, {
    token: async () => "test-token",
    fetch: async (url, options) => {
      fetched += 1;
      assert.equal(String(url).includes("key="), false);
      assert.match(options.headers.authorization, /^Bearer /);
      const body = JSON.parse(options.body);
      assert.equal(body.tools, undefined);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "G'day" }] } }] }) };
    },
  });
  assert.equal(await enabled.generate({ system: "rules", user: "{}" }), "G'day");
  assert.equal(fetched, 1);
});

test("helper code has no write path, no microphone, and no invented key", () => {
  const helperDir = new URL("../functions/helper/", import.meta.url);
  const server = readdirSync(helperDir).filter(name => name.endsWith(".js")).map(name => readFileSync(new URL(name, helperDir), "utf8")).join("\n");
  const client = readFileSync(new URL("../../app/features/helper.js", import.meta.url), "utf8")
    + readFileSync(new URL("../../app/features/helper-ui.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(server, /\.set\(|\.update\(|\.delete\(|\.create\(|addDoc|updateDoc|deleteDoc|writeBatch|bulkWriter|getUserMedia|SpeechRecognition/);
  assert.doesNotMatch(client, /getUserMedia|SpeechRecognition|webkitSpeechRecognition|addDoc|updateDoc|deleteDoc|setDoc|AIza|apiKey/);
  assert.match(client, /australia-southeast1/);
  assert.match(client, /question/);
  assert.doesNotMatch(client, /httpsCallable\(functions, "helperAsk"\)\(\{[^}]*tenantId/);
  assert.match(index, /region: "australia-southeast1"/);
  assert.match(index, /helperAsk/);
  assert.doesNotMatch(index, /onSchedule/);
  assert.doesNotMatch(server + index, /AIza|sk-[A-Za-z0-9]{10,}/);
});

test("spoken replies use an en-AU voice only and never start by themselves", () => {
  assert.equal(shouldAutoRead(), false);
  const aussie = { name: "Karen", lang: "en-AU" };
  const other = { name: "Australian English", lang: "en-GB" };
  assert.equal(pickAustralianVoice([other, aussie]), aussie);
  assert.equal(pickAustralianVoice([other]), null);
  let spoken = 0;
  const synth = { cancel() {}, speak() { spoken += 1; } };
  const refused = speakReply({ synth, voice: other, text: "G'day", Utterance: class U { constructor(text) { this.text = text; } } });
  assert.equal(refused.spoken, false);
  assert.equal(refused.notice, AU_VOICE_MISSING);
  assert.equal(spoken, 0);
  const ok = speakReply({ synth, voice: aussie, text: "G'day", Utterance: class U { constructor(text) { this.text = text; } } });
  assert.equal(ok.spoken, true);
  assert.equal(ok.utterance.lang, "en-AU");
  assert.equal(spoken, 1);
  const missing = helperShellHtml({
    signedIn: true, open: true, speech: true, voices: [other], knowledge: "placeholder",
    messages: [{ role: "assistant", text: "No worries." }],
  });
  assert.match(missing, new RegExp(AU_VOICE_MISSING));
  assert.match(missing, new RegExp(KNOWLEDGE_PLACEHOLDER_NOTE.replace(/[.]/g, "\\.")));
  assert.doesNotMatch(missing, /data-act="play"/);
  assert.doesNotMatch(missing, /Australian English/);
  assert.match(missing, /No worries\./);
  const ready = helperShellHtml({
    signedIn: true, open: true, speech: true, voices: [aussie], knowledge: "pack",
    messages: [{ role: "assistant", text: "On for Wednesday 12 November 2026." }],
  });
  assert.match(ready, /data-act="play"/);
  assert.match(ready, /data-act="stop"/);
  assert.doesNotMatch(ready, new RegExp(AU_VOICE_MISSING));
  assert.doesNotMatch(ready, /autoplay|microphone/i);
  const nasty = helperShellHtml({
    signedIn: true, open: true, speech: false, voices: [], messages: [{ role: "user", text: "<img src=x onerror=alert(1)>" }],
  });
  assert.equal(nasty.includes("<img"), false);
  assert.match(nasty, /&lt;img/);
});
