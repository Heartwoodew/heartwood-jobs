// Emulator only. Fake documents. Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { migrateCompanyIds } from "../scripts/migrate-company-id.mjs";

let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-heartwood",
    firestore: { rules: readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8") },
  });
});

test.after(async () => { if (env) await env.cleanup(); });

test("dry-run adds nothing, commit only adds companyId, and a second commit is a no-op", async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "jobs/old"), { client: "Orbit", address: "1 Creek Rd", note: "keep me" });
    await setDoc(doc(db, "jobs/other"), { tenantId: "otherco", client: "Other", note: "also keep" });
    await setDoc(doc(db, "users/sam"), { name: "Sam", role: "operator" });
    await setDoc(doc(db, "tenants/heartwood/fleet/tipper"), { name: "Tipper" });
    const dry = await migrateCompanyIds(db, { commit: false, now: new Date("2026-11-08T00:00:00Z") });
    assert.equal(dry.commit, false);
    assert.ok(dry.add.some(row => row.path === "jobs/old" && row.companyId === "heartwood"));
    assert.ok(dry.add.some(row => row.path === "jobs/other" && row.companyId === "otherco"));
    const untouched = await getDoc(doc(db, "jobs/old"));
    assert.equal(untouched.data().companyId, undefined);
    assert.equal(untouched.data().note, "keep me");
    assert.equal((await getDoc(doc(db, "companies/heartwood"))).exists(), false);
    const committed = await migrateCompanyIds(db, { commit: true, now: new Date("2026-11-08T00:00:00Z") });
    assert.equal(committed.company, "create");
    const job = (await getDoc(doc(db, "jobs/old"))).data();
    assert.equal(job.companyId, "heartwood");
    assert.equal(job.note, "keep me");
    assert.equal(job.client, "Orbit");
    assert.equal((await getDoc(doc(db, "jobs/other"))).data().companyId, "otherco");
    assert.equal((await getDoc(doc(db, "users/sam"))).data().companyId, "heartwood");
    assert.equal((await getDoc(doc(db, "tenants/heartwood/fleet/tipper"))).data().companyId, "heartwood");
    const company = (await getDoc(doc(db, "companies/heartwood"))).data();
    assert.equal(company.name, "Heartwood Earthworx");
    assert.equal(company.accountsEmail, "accounts@heartwoodew.com");
    assert.equal(company.plan, "paid");
    assert.equal(company.billing.provider, null);
    assert.equal(company.billing.status, "not-configured");
    const again = await migrateCompanyIds(db, { commit: true, now: new Date("2026-11-09T00:00:00Z") });
    assert.equal(again.add.length, 0);
    assert.equal(again.company, "present");
    const after = (await getDoc(doc(db, "jobs/old"))).data();
    assert.equal(after.note, "keep me");
    assert.equal(Object.keys(after).includes("companyId"), true);
    assert.equal(Object.keys(after).length, Object.keys(job).length);
  });
});
