import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveMembership } from "../../app/features/cloud-storage.js";
import {
  canDeleteMessage, canUseJobChat, canUseTeamChat, chatPhotoPath, formatBadge, headUnread, jobThreadId,
  messagePayload, orderedMessages, planChatPhoto, shouldStickToBottom, threadUnread, unreadCount,
} from "../../app/features/chat.js";
import { SCHEDULING_APPROVED } from "../../app/features/cloud-retention.js";

const heartwood = resolveMembership({ uid: "op1", profile: { role: "operator", name: "Sam" } });
const admin = resolveMembership({ uid: "1JKLsoxkQNfkphBBO0vDz2ziEyj2", profile: null });
const other = resolveMembership({ uid: "op2", profile: { role: "operator", name: "Other", tenantId: "otherco" } });
const scoped = resolveMembership({ uid: "scoped", profile: { role: "operator", name: "Scope", customerIds: ["Orbit Homes (Qld) Pty Ltd"] } });

function rulesSlice(text) {
  const start = text.indexOf("// BEGIN CHAT RULES");
  const end = text.indexOf("// END CHAT RULES");
  assert.ok(start >= 0 && end > start);
  return text.slice(start, end + "// END CHAT RULES".length);
}

test("chat rules fragment matches the emulator block and does not replace other rules", () => {
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const frag = readFileSync(new URL("../production/firestore.chat.rules", import.meta.url), "utf8");
  assert.equal(rulesSlice(emu), rulesSlice(frag));
  assert.match(emu, /match \/receipts\/\{id\}/);
  assert.match(emu, /match \/xeroQueue\/\{id\}/);
  assert.match(rulesSlice(frag), /senderUid == request\.auth\.uid/);
  assert.match(rulesSlice(frag), /createdAt == request\.time/);
  assert.match(rulesSlice(frag), /allow update: if false/);
  assert.doesNotMatch(rulesSlice(frag), /match \/receipts\/|match \/xeroQueue\/|SCHEDULING_APPROVED/);
  assert.equal(SCHEDULING_APPROVED, false);
});

test("storage rules add chat photos without opening receipts, finance, or job-photo delete", () => {
  const storage = readFileSync(new URL("../emulator/storage.rules", import.meta.url), "utf8");
  const prod = readFileSync(new URL("../production/storage.rules", import.meta.url));
  assert.equal(prod.equals(Buffer.from(storage)), true);
  assert.match(storage, /match \/tenants\/\{tenantId\}\/chat\/staff\/photos\/\{file\}/);
  assert.match(storage, /match \/tenants\/\{tenantId\}\/chat\/jobs\/\{jobId\}\/photos\/\{file\}/);
  assert.match(storage, /purpose == "chat-photo"/);
  assert.match(storage, /allow delete: if false/);
  assert.match(storage, /match \/tenants\/\{tenantId\}\/finance\/\{allPaths=\*\*\}/);
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../../app/features/chat-ui.js", import.meta.url), "utf8");
  const logic = readFileSync(new URL("../../app/features/chat.js", import.meta.url), "utf8");
  assert.doesNotMatch(app + ui + logic, /getDownloadURL/);
  assert.doesNotMatch(app, /deleteObject/);
  assert.match(ui, /getBlob/);
});

test("team and job chat payloads stay plain text with a private photo path", () => {
  assert.equal(canUseTeamChat(heartwood), true);
  assert.equal(canUseTeamChat(other), true);
  assert.equal(canUseTeamChat({ ok: false }), false);
  const job = { id: "job1", client: "Orbit Homes (Qld) Pty Ltd", assigned: ["op1"] };
  const silk = { id: "silk", client: "Silkwood Homes", assigned: ["scoped", "op1"] };
  assert.equal(canUseJobChat(heartwood, job), true);
  assert.equal(canUseJobChat(admin, job), true);
  assert.equal(canUseJobChat(scoped, silk), false);
  assert.equal(canUseJobChat(other, job), false);
  assert.equal(jobThreadId("job1"), "job_job1");
  assert.equal(jobThreadId("../finance"), null);
  assert.equal(chatPhotoPath("heartwood", "staff", "c12345678"), "tenants/heartwood/chat/staff/photos/c12345678");
  assert.equal(chatPhotoPath("heartwood", "job_job1", "c12345678"), "tenants/heartwood/chat/jobs/job1/photos/c12345678");
  const text = messagePayload({ uid: "op1", name: "Sam", text: "  Hello  " });
  assert.equal(text.ok, true);
  assert.equal(text.data.text, "Hello");
  assert.equal(text.data.senderUid, "op1");
  assert.equal(messagePayload({ uid: "op1", name: "Sam", text: "   " }).ok, false);
  const photo = planChatPhoto({
    membership: heartwood, threadId: "staff", file: { type: "image/jpeg", size: 20 }, fileId: "c12345678",
  });
  assert.equal(photo.ok, true);
  assert.equal(photo.metadata.purpose, "chat-photo");
  assert.equal(photo.path.includes("/receipts/"), false);
  assert.equal(planChatPhoto({
    membership: scoped, threadId: "job_silk", job: silk, file: { type: "image/jpeg", size: 20 }, fileId: "c12345678",
  }).ok, false);
  assert.equal(planChatPhoto({
    membership: other, threadId: "staff", file: { type: "image/jpeg", size: 20 }, fileId: "c12345678",
  }).path.startsWith("tenants/otherco/"), true);
  assert.equal(canDeleteMessage(heartwood, { senderUid: "op1" }), true);
  assert.equal(canDeleteMessage(heartwood, { senderUid: "idle" }), false);
  assert.equal(canDeleteMessage(admin, { senderUid: "idle" }), true);
});

test("unread counts are per thread and newest messages sort to the bottom", () => {
  const messages = [
    { id: "b", senderUid: "sam", createdAt: 200, text: "later" },
    { id: "a", senderUid: "patrick", createdAt: 100, text: "earlier" },
    { id: "c", senderUid: "sam", createdAt: 300, text: "newest" },
  ];
  assert.deepEqual(orderedMessages(messages).map(m => m.id), ["a", "b", "c"]);
  assert.equal(unreadCount(messages, 150, "patrick"), 2);
  assert.equal(unreadCount(messages, 150, "sam"), 0);
  assert.equal(threadUnread({ loaded: true, messages, seenMillis: 150, myUid: "patrick" }), 2);
  assert.equal(threadUnread({ loaded: false, head: { lastAt: 400, lastSenderUid: "sam" }, seenMillis: 150, myUid: "patrick" }), 1);
  assert.equal(headUnread({ lastAt: 400, lastSenderUid: "patrick" }, 150, "patrick"), 0);
  assert.equal(formatBadge(0), "");
  assert.equal(formatBadge(4), "4");
  assert.equal(formatBadge(12), "9+");
  assert.equal(shouldStickToBottom({ scrollHeight: 800, scrollTop: 700, clientHeight: 120, first: false }), true);
  assert.equal(shouldStickToBottom({ scrollHeight: 800, scrollTop: 100, clientHeight: 120, first: false }), false);
  assert.equal(shouldStickToBottom({ scrollHeight: 800, scrollTop: 0, clientHeight: 120, first: true }), true);
});