// Forwarded job email: signature, supervisor match, builder parse, drafts.
// Addresses are callup932+...@gmail.com only. No network and no secrets.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  collectSupervisorEmails,
  decideInbound,
  forwardScreenHtml,
  inboundAddress,
  inboundToken,
  jobFromDraft,
  normalizeSupervisorEmail,
  recipientLocalParts,
  stripPrices,
} from "../../app/features/inbound-forward.js";
import { handleInboundWebhook, resendSignatureFor } from "../functions/inbound-email.js";

const TODAY = "2026-11-22";
const SECRET = "whsec_" + Buffer.from("inbound-test-secret-key-32b!!").toString("base64");
const ORBIT = "callup932+orbit@gmail.com";
const OFFICE = "callup932+office@gmail.com";
const STRANGER = "callup932+stranger@gmail.com";
const SUPERS = { emails: [ORBIT, "callup932+torsion@gmail.com", "callup932+silkwood@gmail.com"], remembered: { Orbit: { email: ORBIT, name: "Sam" } } };

function signed(event, now, secret = SECRET) {
  const raw = JSON.stringify(event);
  const id = "msg_test_1";
  const timestamp = String(Math.floor(now / 1000));
  const sig = resendSignatureFor({ id, timestamp, rawBody: raw, secret });
  return { rawBody: raw, headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${sig}` } };
}

const spoil = `---------- Forwarded message ---------
From: Sam Orbit <${ORBIT}>
Date: Tue, 18 Nov 2026
Subject: Orbit spoil
To: ${OFFICE}

Orbit Homes purchase order.
Lot 45, 12 Wattle Street, Springfield Lakes QLD 4300
PO JOB/900/02
Spoil removal
Required date: 14/11/2026
Supervisor: Sam Orbit ${ORBIT}
Notes: Spoil is piled on the nature strip. The price is $450 ex GST.
`;

test("a company address is the slug, a random token, and the inbound domain", () => {
  const token = inboundToken(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
  assert.equal(token.length, 8);
  assert.match(inboundAddress("acme-earth", token), new RegExp(`^acme-earth-${token}@inbound\\.callupapp\\.com\\.au$`));
  assert.equal(inboundAddress("Bad_Id", token), "");
  assert.deepEqual(recipientLocalParts([`Acme <acme-earth-${token}@inbound.callupapp.com.au>`, "other@example.com"]), [`acme-earth-${token}`]);
});

test("saved supervisor emails include the explicit list and the older maps", () => {
  assert.deepEqual(collectSupervisorEmails(SUPERS).sort(), [ORBIT, "callup932+silkwood@gmail.com", "callup932+torsion@gmail.com"]);
  assert.equal(normalizeSupervisorEmail("  Sam <Callup932+Orbit@gmail.com> "), ORBIT);
  assert.equal(normalizeSupervisorEmail("not an email"), "");
});

test("a forwarded Orbit, Torsion or Silkwood email becomes a draft with no price", () => {
  const orbit = decideInbound({
    companyId: "acme",
    messageId: "email_orbit_1",
    from: `Office <${OFFICE}>`,
    subject: "Fwd: Orbit spoil",
    text: spoil,
    rfcMessageId: "<orbit-1@mail>",
    supervisors: SUPERS,
    receivedAt: "2026-11-18T01:00:00.000Z",
    today: TODAY,
  });
  assert.equal(orbit.kind, "draft");
  assert.equal(orbit.matchedEmail, ORBIT);
  assert.equal(orbit.draft.client, "Orbit Homes (Qld) Pty Ltd");
  assert.equal(orbit.draft.type, "spoil");
  assert.equal(orbit.draft.po, "JOB/900/02");
  assert.equal(orbit.draft.address, "Lot 45, 12 Wattle St, Springfield Lakes");
  assert.equal(orbit.draft.supervisorEmail, ORBIT);
  assert.doesNotMatch(orbit.draft.notes, /\$|450/);
  assert.match(orbit.draft.notes, /price removed/);
  for (const key of ["poAmount", "quoteAmount", "invoiceAmount", "totalEx", "amountInc"]) {
    assert.equal(key in orbit.draft, false);
    assert.equal(key in orbit.mail, false);
  }

  const torsion = decideInbound({
    companyId: "acme", messageId: "email_torsion_1", from: `Office <${OFFICE}>`,
    subject: "Fwd: Torsion call up",
    text: `---------- Forwarded message ---------\nFrom: Jo Torsion <callup932+torsion@gmail.com>\n\nTorsion Built call-up. Lot 2, 9 River Road, Ipswich. Required date 20/11/2026. PO TB100.`,
    supervisors: SUPERS, today: TODAY,
  });
  assert.equal(torsion.kind, "draft");
  assert.equal(torsion.draft.client, "Torsion Built Pty Ltd");
  assert.equal(torsion.matchedEmail, "callup932+torsion@gmail.com");

  const silk = decideInbound({
    companyId: "acme", messageId: "email_silk_1", from: `Office <${OFFICE}>`,
    subject: "Fwd: Silkwood",
    text: `---------- Forwarded message ---------\nFrom: Ana Silk <callup932+silkwood@gmail.com>\n\nSilkwood Homes site clean. Lot 7, 4 Cedar Street, Ripley. Required date 21/11/2026.`,
    supervisors: SUPERS, today: TODAY,
  });
  assert.equal(silk.kind, "draft");
  assert.equal(silk.draft.client, "Silkwood Homes");
});

test("an unmatched sender is logged and is not a draft", () => {
  const logs = [];
  const decision = decideInbound({
    companyId: "acme", messageId: "email_stranger", from: `Nope <${STRANGER}>`,
    subject: "Orbit spoil Lot 1, 2 Smith Street, Ipswich", text: "Please book this.",
    supervisors: SUPERS, today: TODAY,
  });
  assert.equal(decision.kind, "ignored");
  assert.equal(decision.reason, "unmatched-sender");
  assert.equal(decision.draft, null);
  assert.equal(decision.bodyText, "");
  logs.push(decision.mail);
  assert.equal(JSON.stringify(logs).includes(SECRET), false);
  assert.doesNotMatch(decision.mail.textPreview, /Please book/);
});

test("a Gmail forwarding confirmation is shown to the admin and is not a job", () => {
  const decision = decideInbound({
    companyId: "acme",
    messageId: "email_verify",
    from: "Gmail Team <forwarding-noreply@google.com>",
    subject: `(#847291) Gmail Forwarding Confirmation - Receive Mail from ${OFFICE}`,
    text: `${OFFICE} has requested to automatically forward mail to acme-abcd2345@inbound.callupapp.com.au.\nConfirmation code: 847291\nhttps://mail-settings.google.com/mail/vf-abc`,
    supervisors: SUPERS,
    today: TODAY,
  });
  assert.equal(decision.kind, "verification");
  assert.equal(decision.draft, null);
  assert.equal(decision.mail.verificationCode, "847291");
  assert.match(decision.mail.verificationUrl, /^https:\/\/mail-settings\.google\.com\//);
  const html = forwardScreenHtml({
    address: "acme-abcd2345@inbound.callupapp.com.au",
    emails: [ORBIT],
    canEditSupervisors: true,
    canApprove: true,
    verifications: [{ id: "email_verify", ...decision.mail }],
    drafts: [],
    ignored: [],
  });
  assert.match(html, /id="fwdcopy"/);
  assert.match(html, /Gmail/);
  assert.match(html, /Outlook/);
  assert.match(html, /847291/);
  assert.match(html, new RegExp(ORBIT.replace("+", "\\+")));
  assert.doesNotMatch(html, /\$450/);
});

test("approving a draft builds a job with no money fields", () => {
  const decision = decideInbound({
    companyId: "acme", messageId: "email_orbit_1", from: `Office <${OFFICE}>`,
    subject: "Fwd: Orbit spoil", text: spoil, supervisors: SUPERS, today: TODAY,
  });
  const built = jobFromDraft({ ...decision.draft, id: decision.draftId }, { companyId: "acme", uid: "admin1" });
  assert.equal(built.ok, true);
  assert.equal(built.job.companyId, "acme");
  assert.equal(built.job.source, "inbound-forward");
  assert.equal(built.job.status, "Scheduled");
  assert.deepEqual(built.job.assigned, []);
  for (const key of ["poAmount", "quoteAmount", "invoiceAmount", "totalEx", "gst", "amountInc", "lines", "priceOverrides"]) {
    assert.equal(key in built.job, false);
  }
  assert.equal(stripPrices("$450").includes("450"), false);
});

test("the webhook verifies the signature, dedupes, and does not keep unmatched mail", async () => {
  const now = Date.parse("2026-11-22T03:00:00Z");
  const local = "acme-abcd2345";
  const store = {
    mail: new Map(),
    drafts: new Map(),
    seen: new Set(),
    logs: [],
  };
  const deps = {
    now,
    secret: SECRET,
    findRoute: async id => id === local ? { companyId: "acme", address: `${local}@inbound.callupapp.com.au` } : null,
    loadSupervisors: async () => SUPERS,
    today: TODAY,
    log: (message, fields) => store.logs.push({ message, fields }),
    saveResult: async decision => {
      const key = decision.mail.messageId;
      if (store.mail.has(key) || (decision.seenId && store.seen.has(decision.seenId))) return { duplicate: true };
      if (decision.seenId) store.seen.add(decision.seenId);
      store.mail.set(key, decision.mail);
      if (decision.draft) store.drafts.set(decision.draftId, decision.draft);
      return { duplicate: false };
    },
  };
  const event = {
    type: "email.received",
    data: {
      email_id: "email_orbit_1",
      from: `Office <${OFFICE}>`,
      to: [`${local}@inbound.callupapp.com.au`],
      subject: "Fwd: Orbit spoil",
      text: spoil,
      message_id: "<orbit-1@mail>",
      created_at: "2026-11-18T01:00:00.000Z",
    },
  };
  const bad = await handleInboundWebhook({ ...deps, ...signed(event, now, "whsec_" + Buffer.from("other-test-secret-value-xxxxx").toString("base64")) });
  assert.equal(bad.status, 401);
  const stale = signed(event, now - 10 * 60 * 1000);
  assert.equal((await handleInboundWebhook({ ...deps, ...stale, now })).status, 401);
  const first = await handleInboundWebhook({ ...deps, ...signed(event, now) });
  assert.equal(first.status, 200);
  assert.equal(first.body.kind, "draft");
  assert.equal(store.drafts.size, 1);
  const again = await handleInboundWebhook({ ...deps, ...signed(event, now) });
  assert.equal(again.body.kind, "duplicate");
  assert.equal(store.drafts.size, 1);
  const otherId = { ...event, data: { ...event.data, email_id: "email_orbit_2", message_id: "<orbit-1@mail>" } };
  const sameRfc = await handleInboundWebhook({ ...deps, ...signed(otherId, now) });
  assert.equal(sameRfc.body.kind, "duplicate");
  assert.equal(store.drafts.size, 1);

  const stranger = {
    type: "email.received",
    data: { email_id: "email_stranger", from: STRANGER, to: [`${local}@inbound.callupapp.com.au`], subject: "Hello", text: "Not a supervisor. Secret body." },
  };
  const ignored = await handleInboundWebhook({ ...deps, ...signed(stranger, now) });
  assert.equal(ignored.body.kind, "ignored");
  assert.equal(store.drafts.size, 1);
  assert.equal(store.mail.get("email_stranger").kind, "ignored");
  const dumped = JSON.stringify(store.logs);
  assert.equal(dumped.includes(SECRET), false);
  assert.equal(dumped.includes("Secret body"), false);
  assert.match(dumped, /unmatched-sender/);

  const unknown = await handleInboundWebhook({
    ...deps,
    ...signed({ type: "email.received", data: { email_id: "email_nowhere", to: ["nobody@example.com"], subject: "x", text: "y" } }, now),
  });
  assert.equal(unknown.body.skipped, "unknown-recipient");
  assert.equal(store.mail.has("email_nowhere"), false);
});

test("the app module and the function module stay the same file", () => {
  const app = readFileSync(new URL("../../app/features/inbound-forward.js", import.meta.url));
  const fn = readFileSync(new URL("../functions/shared/inbound-forward.js", import.meta.url));
  const parser = readFileSync(new URL("../../app/features/inbox-import.js", import.meta.url));
  const parserCopy = readFileSync(new URL("../functions/shared/inbox-import.js", import.meta.url));
  assert.equal(app.equals(fn), true);
  assert.equal(parser.equals(parserCopy), true);
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  const fragment = readFileSync(new URL("../production/firestore.inbound.rules", import.meta.url), "utf8");
  assert.match(index, /inboundEmailWebhook/);
  assert.match(index, /RESEND_INBOUND_WEBHOOK_SECRET/);
  assert.match(index, /NODE_TEST_CONTEXT/);
  assert.equal(index.includes("whsec_"), false);
  assert.equal(rules.includes(fragment.trim()), true);
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v159-help-videos/);
  assert.match(sw, /features\/inbound-forward\.js/);
  assert.equal(createHash("sha256").update(app).digest("hex").length, 64);
});
