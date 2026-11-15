// Paused companies cannot read or write company data. Own profile and the company doc stay readable.
// Loads cloud/firestore.production.rules. Fake data only. Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, Timestamp } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

let env;

function billing(status, customer = null) {
  return { provider: customer ? "stripe" : null, status, stripeCustomerId: customer, stripeSubscriptionId: customer ? "sub_x" : null };
}
function company(extra) {
  return {
    name: "Co", legalName: "Co", abn: "1", signoff: "Co", logoUrl: "", address: "1 St", phone: "",
    email: "office@co.test", accountsEmail: "accounts@co.test", hubdocAddress: "",
    status: "active", plan: "trial", origin: "signup", isTest: false,
    trialEndsAt: Timestamp.fromDate(new Date(NOW + 7 * DAY)),
    billing: billing("not-configured"),
    ...extra,
  };
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-trial-pause",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const past = Timestamp.fromDate(new Date(NOW - 3 * DAY));
    const futureFriend = null;
    await setDoc(doc(db, "companies/paused"), company({ trialEndsAt: past }));
    await setDoc(doc(db, "companies/intrial"), company({}));
    await setDoc(doc(db, "companies/paying"), company({ trialEndsAt: past, plan: "paid", billing: billing("active", "cus_pay") }));
    await setDoc(doc(db, "companies/trialing"), company({ trialEndsAt: past, billing: billing("trialing", "cus_try") }));
    await setDoc(doc(db, "companies/friendco"), company({ plan: "friend", trialEndsAt: null, friendEndsAt: futureFriend }));
    await setDoc(doc(db, "companies/friendend"), company({ plan: "friend", trialEndsAt: null, friendEndsAt: past }));
    await setDoc(doc(db, "companies/yard"), company({ isTest: true, origin: "test", trialEndsAt: null }));
    await setDoc(doc(db, "companies/pastdue"), company({ trialEndsAt: past, billing: billing("past_due", "cus_due") }));
    await setDoc(doc(db, "companies/heartwood"), company({ plan: "paid", trialEndsAt: past, billing: billing("not-configured") }));
    const people = [
      ["pausedAdm", "admin", "paused"], ["pausedOp", "operator", "paused"],
      ["trialAdm", "admin", "intrial"], ["trialOp", "operator", "intrial"],
      ["payAdm", "admin", "paying"], ["tryAdm", "admin", "trialing"],
      ["friendAdm", "admin", "friendco"], ["friendEndAdm", "admin", "friendend"],
      ["yardAdm", "admin", "yard"], ["dueAdm", "admin", "pastdue"],
    ];
    for (const [uid, role, companyId] of people) {
      await setDoc(doc(db, "users", uid), { name: uid, role, email: uid + "@example.com", companyId, tenantId: companyId });
    }
    const jobs = ["paused", "intrial", "paying", "trialing", "friendco", "friendend", "yard", "pastdue"];
    for (const id of jobs) {
      await setDoc(doc(db, "jobs", id + "job"), { companyId: id, client: id + " secret", address: "1 St", status: "Scheduled", assigned: [id === "paused" ? "pausedOp" : id === "intrial" ? "trialOp" : "nobody"] });
      await setDoc(doc(db, "quotes", id + "q"), { companyId: id, client: id + " quote", quoteStatus: "Draft" });
    }
    await setDoc(doc(db, "jobs/hw1"), { companyId: "heartwood", client: "Heartwood job", address: "1 St", status: "Scheduled", assigned: [] });
    await setDoc(doc(db, "timesheets/pausedOp_2026-11-09"), { uid: "pausedOp", name: "pausedOp", companyId: "paused", weekStart: "2026-11-09", totalHrs: 1 });
    await setDoc(doc(db, "timesheets/trialOp_2026-11-09"), { uid: "trialOp", name: "trialOp", companyId: "intrial", weekStart: "2026-11-09", totalHrs: 1 });
  });
});

test.after(async () => { if (env) await env.cleanup(); });

function db(uid) { return env.authenticatedContext(uid).firestore(); }

const job = (id, companyId) => ({ companyId, client: "New", address: "2 St", status: "Scheduled", assigned: [] });

test("a paused company cannot read or write jobs, quotes or timesheets", async () => {
  const admin = db("pausedAdm");
  const op = db("pausedOp");
  await assertFails(getDoc(doc(admin, "jobs/pausedjob")));
  await assertFails(getDoc(doc(op, "jobs/pausedjob")));
  await assertFails(getDoc(doc(admin, "quotes/pausedq")));
  await assertFails(getDoc(doc(op, "timesheets/pausedOp_2026-11-09")));
  await assertFails(setDoc(doc(admin, "jobs/pausednew"), job("pausednew", "paused")));
  await assertFails(updateDoc(doc(admin, "jobs/pausedjob"), { address: "stolen" }));
  const profile = await assertSucceeds(getDoc(doc(op, "users/pausedOp")));
  assert.equal(profile.data().role, "operator");
  const company = await assertSucceeds(getDoc(doc(admin, "companies/paused")));
  assert.equal(company.data().plan, "trial");
  assert.equal(company.data().billing.status, "not-configured");
  await assertSucceeds(getDoc(doc(admin, "users/pausedAdm")));
});

test("active, trialing, friend, test, heartwood and in-trial companies can still write", async () => {
  await assertSucceeds(setDoc(doc(db("trialAdm"), "jobs/trialnew"), job("trialnew", "intrial")));
  await assertSucceeds(getDoc(doc(db("trialOp"), "jobs/intrialjob")));
  await assertSucceeds(getDoc(doc(db("trialOp"), "timesheets/trialOp_2026-11-09")));
  await assertSucceeds(getDoc(doc(db("trialAdm"), "quotes/intrialq")));
  await assertSucceeds(setDoc(doc(db("payAdm"), "jobs/paynew"), job("paynew", "paying")));
  await assertSucceeds(setDoc(doc(db("tryAdm"), "jobs/trynew"), job("trynew", "trialing")));
  await assertSucceeds(setDoc(doc(db("friendAdm"), "jobs/friendnew"), job("friendnew", "friendco")));
  await assertSucceeds(setDoc(doc(db("yardAdm"), "jobs/yardnew"), job("yardnew", "yard")));
  await assertSucceeds(setDoc(doc(db(ALEX), "jobs/hwnew"), { companyId: "heartwood", client: "Still here", address: "1 St", status: "Scheduled", assigned: [] }));
  await assertSucceeds(getDoc(doc(db(ALEX), "jobs/hw1")));
  await assertFails(setDoc(doc(db("friendEndAdm"), "jobs/friendendnew"), job("x", "friendend")));
  await assertFails(getDoc(doc(db("dueAdm"), "jobs/pastduejob")));
  await assertFails(setDoc(doc(db("dueAdm"), "jobs/duenew"), job("duenew", "pastdue")));
});
