// Company A cannot read company B's forwarded mail or drafts. Crew cannot read
// mail, drafts, or the stored body. Fake data only. Does not touch production.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const SYNC = "38SU5waAy4f9UI9N6JTqDMaYpQg2";
const RULES = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
const STORAGE = readFileSync(new URL("../production/storage.rules", import.meta.url), "utf8");

let env;

function db(uid) { return env.authenticatedContext(uid).firestore(); }
function storage(uid) { return env.authenticatedContext(uid).storage(); }

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-heartwood",
    firestore: { rules: RULES },
    storage: { rules: STORAGE },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    const open = { name: "Co", status: "active", plan: "trial", isTest: true, ownerPaused: false };
    await setDoc(doc(d, "companies/acme"), { ...open, name: "Acme" });
    await setDoc(doc(d, "companies/bravo"), { ...open, name: "Bravo" });
    await setDoc(doc(d, "companies/cedar"), { ...open, name: "Cedar" });
    const people = [
      ["acmeAdm", "admin", "acme"],
      ["acmeSup", "supervisor", "acme"],
      ["acmeOp", "operator", "acme"],
      ["acmeLab", "labourer", "acme"],
      ["bravoAdm", "admin", "bravo"],
      ["cedarAdm", "admin", "cedar"],
    ];
    for (const [uid, role, companyId] of people) {
      await setDoc(doc(d, "users", uid), { name: uid, role, email: "callup932+" + uid + "@gmail.com", companyId, tenantId: companyId });
    }
    const draft = {
      companyId: "acme", status: "pending", source: "inbound-forward", messageId: "email_orbit_1",
      client: "Orbit Homes (Qld) Pty Ltd", address: "Lot 45, 12 Wattle St, Springfield Lakes",
      type: "spoil", po: "JOB/900/02", description: "Spoil removal", notes: "Nature strip", date: "2026-11-14",
    };
    await setDoc(doc(d, "companies/acme/jobDrafts/fwdemailorbit1"), draft);
    await setDoc(doc(d, "companies/bravo/jobDrafts/fwdemailbravo1"), { ...draft, companyId: "bravo", client: "Bravo secret", notes: "Bravo only" });
    await setDoc(doc(d, "companies/acme/inboundMail/email_orbit_1"), {
      companyId: "acme", messageId: "email_orbit_1", kind: "draft", subject: "Fwd: Orbit spoil", fromEmail: "callup932+orbit@gmail.com",
    });
    await setDoc(doc(d, "companies/acme/inboundMail/email_verify"), {
      companyId: "acme", kind: "verification", subject: "Gmail Forwarding Confirmation", verificationCode: "847291",
    });
    await setDoc(doc(d, "companies/bravo/inboundMail/email_bravo"), {
      companyId: "bravo", kind: "draft", subject: "Bravo secret mail", fromEmail: "callup932+bravo@gmail.com",
    });
    await setDoc(doc(d, "companies/acme/inbound/config"), {
      companyId: "acme", address: "acme-abcd2345@inbound.callupapp.com.au", localPart: "acme-abcd2345", domain: "inbound.callupapp.com.au",
    });
    await setDoc(doc(d, "companies/heartwood/inboundMail/email_hw"), {
      companyId: "heartwood", kind: "verification", subject: "Heartwood confirmation", verificationCode: "111111",
    });
    await setDoc(doc(d, "inboundRoutes/acme-abcd2345"), { companyId: "acme", address: "acme-abcd2345@inbound.callupapp.com.au" });
    await setDoc(doc(d, "inboundSeen/abc"), { companyId: "acme", messageId: "email_orbit_1" });
    await setDoc(doc(d, "jobMoney/acmeJob"), { companyId: "acme", poAmount: 450 });
    await setDoc(doc(d, "jobs/acmeJob"), { companyId: "acme", tenantId: "acme", client: "Orbit", address: "1 Creek Rd", assigned: ["acmeOp"], status: "Scheduled" });
    const body = new TextEncoder().encode("Acme mail body. Not for Bravo.");
    const other = new TextEncoder().encode("Bravo mail body.");
    await uploadBytes(ref(ctx.storage(), "companies/acme/inbound/email_orbit_1/body.txt"), body, { contentType: "text/plain" });
    await uploadBytes(ref(ctx.storage(), "companies/bravo/inbound/email_bravo/body.txt"), other, { contentType: "text/plain" });
  });
});

test.after(async () => { if (env) await env.cleanup(); });

test("office of the company can read mail and drafts; crew and other companies cannot", async () => {
  await assertSucceeds(getDoc(doc(db("acmeAdm"), "companies/acme/inboundMail/email_orbit_1")));
  await assertSucceeds(getDoc(doc(db("acmeSup"), "companies/acme/jobDrafts/fwdemailorbit1")));
  await assertSucceeds(getDoc(doc(db("acmeAdm"), "companies/acme/inbound/config")));
  const acmeBytes = new TextDecoder().decode(await getBytes(ref(storage("acmeSup"), "companies/acme/inbound/email_orbit_1/body.txt")));
  assert.match(acmeBytes, /Acme mail body/);

  await assertFails(getDoc(doc(db("acmeOp"), "companies/acme/inboundMail/email_orbit_1")));
  await assertFails(getDoc(doc(db("acmeLab"), "companies/acme/jobDrafts/fwdemailorbit1")));
  await assertFails(getDoc(doc(db("acmeOp"), "companies/acme/inbound/config")));
  await assertFails(getBytes(ref(storage("acmeOp"), "companies/acme/inbound/email_orbit_1/body.txt")));
  await assertFails(getBytes(ref(storage("acmeLab"), "companies/acme/inbound/email_orbit_1/body.txt")));

  await assertFails(getDoc(doc(db("bravoAdm"), "companies/acme/inboundMail/email_orbit_1")));
  await assertFails(getDoc(doc(db("bravoAdm"), "companies/acme/jobDrafts/fwdemailorbit1")));
  await assertFails(getDoc(doc(db("bravoAdm"), "companies/acme/inbound/config")));
  await assertFails(getDoc(doc(db("acmeAdm"), "companies/bravo/inboundMail/email_bravo")));
  await assertFails(getBytes(ref(storage("bravoAdm"), "companies/acme/inbound/email_orbit_1/body.txt")));
  await assertFails(getBytes(ref(storage("acmeAdm"), "companies/bravo/inbound/email_bravo/body.txt")));

  await assertFails(getDoc(doc(db("acmeAdm"), "inboundRoutes/acme-abcd2345")));
  await assertFails(getDoc(doc(db("bravoAdm"), "inboundRoutes/acme-abcd2345")));
  await assertFails(getDoc(doc(db("acmeAdm"), "inboundSeen/abc")));
  await assertFails(getDoc(doc(db("acmeOp"), "jobMoney/acmeJob")));
});

test("Heartwood office can read Heartwood mail and the sync login cannot", async () => {
  await assertSucceeds(getDoc(doc(db(ALEX), "companies/heartwood/inboundMail/email_hw")));
  await assertFails(getDoc(doc(db(SYNC), "companies/heartwood/inboundMail/email_hw")));
  await assertFails(getDoc(doc(db("bravoAdm"), "companies/heartwood/inboundMail/email_hw")));
  await assertFails(getDoc(doc(db(ALEX), "companies/acme/inboundMail/email_orbit_1")));
});

test("office can approve or discard a draft and cannot put a price on it", async () => {
  await assertFails(updateDoc(doc(db("acmeAdm"), "companies/acme/jobDrafts/fwdemailorbit1"), { poAmount: 450 }));
  await assertFails(updateDoc(doc(db("acmeOp"), "companies/acme/jobDrafts/fwdemailorbit1"), { status: "discarded", discardedBy: "acmeOp", discardedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db("acmeSup"), "companies/acme/jobDrafts/fwdemailorbit1"), {
    status: "approved", jobId: "fwdemailorbit1", approvedBy: "acmeSup", approvedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(db("acmeAdm"), "companies/acme/inboundMail/email_verify"), {
    dismissed: true, dismissedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db("acmeAdm"), "companies/bravo/jobDrafts/fwdemailbravo1"), { notes: "stolen" }));
});

test("an admin mints only their own forwarding address", async () => {
  const address = "cedar-abcd2345@inbound.callupapp.com.au";
  await assertFails(setDoc(doc(db("acmeAdm"), "inboundRoutes/cedar-abcd2345"), {
    companyId: "cedar", address, createdBy: "acmeAdm", createdAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(db("cedarAdm"), "inboundRoutes/cedar-abcd2345"), {
    companyId: "cedar", address, createdBy: "cedarAdm", createdAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(db("cedarAdm"), "companies/cedar/inbound/config"), {
    companyId: "cedar", address, localPart: "cedar-abcd2345", domain: "inbound.callupapp.com.au",
    createdBy: "cedarAdm", createdAt: serverTimestamp(),
  }));
  await assertFails(getDoc(doc(db("acmeAdm"), "companies/cedar/inbound/config")));
  await assertSucceeds(getDoc(doc(db("cedarAdm"), "companies/cedar/inbound/config")));
  await assertFails(setDoc(doc(db("acmeOp"), "companies/acme/jobDrafts/fwdhacked0001"), {
    companyId: "acme", status: "pending", source: "inbound-forward", client: "Secret",
  }));
});
