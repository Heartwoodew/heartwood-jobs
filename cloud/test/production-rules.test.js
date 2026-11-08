import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(name) {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

test("every live match path is in the production rules", () => {
  const snap = read("../production/live-snapshot-20261108.rules");
  const rules = read("../firestore.production.rules");
  const paths = [...snap.matchAll(/^\s*match\s+(\S+)\s*\{/gm)].map(m => m[1]);
  assert.ok(paths.includes("/jobs/{jobId}"));
  assert.ok(paths.includes("/clients/{cid}"));
  assert.ok(paths.includes("/ownerSettings/{id}"));
  assert.ok(paths.includes("/poLookups/{docId}"));
  assert.ok(paths.includes("/reimbursements/{id}"));
  assert.ok(paths.includes("/swmsChunks/{cid}"));
  assert.ok(paths.includes("/meta/profitHistory"));
  assert.ok(paths.includes("/{document=**}"));
  const missing = paths.filter(path => !rules.includes(`match ${path}`));
  assert.deepEqual(missing, []);
  assert.match(rules, /A missing companyId means heartwood/);
  assert.match(rules, /live ruleset f6f1fb5c/);
});
