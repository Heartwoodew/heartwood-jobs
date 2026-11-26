// Measures cloud/firestore.production.rules. Does not call the production Rules API.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Measured on main before the scope-tree shrink, with cloud/scripts/rules-complexity.py.
// matches is the current ruleset (inbound forward added config, mail, drafts, routes, seen).
// rootFunctions: helpers on the database match, inherited by every collection.
// scopeWeight: sum over matches of functions visible there (the compiler's scope tree).
// maxCallDepth: longest helper call chain.
const BEFORE = {
  bytes: 163877,
  functions: 306,
  rootFunctions: 303,
  matches: 81,
  maxMatchNesting: 2,
  maxCallDepth: 8,
  scopeWeight: 22879,
  maxFunctionsVisible: 303,
};

function measure() {
  const script = fileURLToPath(new URL("../scripts/rules-complexity.py", import.meta.url));
  const rules = fileURLToPath(new URL("../firestore.production.rules", import.meta.url));
  const run = spawnSync("python3", [script, rules], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}

test("production rules are a smaller scope tree than the file that 503s", () => {
  const after = measure();
  const lines = [
    "metric                before     after",
    `bytes                 ${BEFORE.bytes}    ${after.bytes}`,
    `functions             ${BEFORE.functions}       ${after.functions}`,
    `database-scope fns    ${BEFORE.rootFunctions}       ${after.rootFunctions}`,
    `matches               ${BEFORE.matches}        ${after.matches}`,
    `max match nesting     ${BEFORE.maxMatchNesting}         ${after.maxMatchNesting}`,
    `max call depth        ${BEFORE.maxCallDepth}         ${after.maxCallDepth}`,
    `scope weight          ${BEFORE.scopeWeight}     ${after.scopeWeight}`,
    `widest scope          ${BEFORE.maxFunctionsVisible}       ${after.maxFunctionsVisible}`,
  ];
  console.log(lines.join("\n"));

  assert.deepEqual(after.dead, []);
  // locationNotices is the GPS reminder the person reads. supportTickets is the raise-ticket collection.
  // clientErrors is the phone error log. clockOnReminders has no client match.
  // Firestore denies it, and a deny match would widen the scope tree.
  assert.equal(after.matches, BEFORE.matches + 3);
  assert.equal(after.maxMatchNesting, BEFORE.maxMatchNesting);
  // Shared helpers live on the database match so each copy is compiled once.
  // 80 is still far under the 303-function ruleset that 503s the compiler.
  assert.ok(after.rootFunctions < 80, `database scope still has ${after.rootFunctions} functions`);
  // Each new match sees the shared helpers. clientErrors is one more. 6500 is still under a third of the 22879 ruleset that 503s.
  assert.ok(after.scopeWeight < 6500, `scope weight ${after.scopeWeight}`);
  assert.ok(after.maxFunctionsVisible < 100, `widest scope sees ${after.maxFunctionsVisible}`);
  assert.ok(after.maxCallDepth < BEFORE.maxCallDepth);
  assert.ok(after.bytes < 245000, "rules source must stay under ~245000 bytes");
  assert.ok(after.bytes < 256 * 1024, "rules must stay under the 256KB ruleset limit");
});

test("money and crew privacy text is unchanged", () => {
  const rules = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  assert.match(rules, /function jobMoneyKeys\(\) \{ return \["poAmount", "poAmountBasis", "poAmountSource", "quoteAmount", "poLookupCandidates", "invoiceAmount", "xeroCheck"\]; \}/);
  assert.match(rules, /function syncDeniedJobKeys\(\) \{ return \["invoiceAmount", "xeroCheck"\]; \}/);
  assert.match(rules, /!veoliaPaidPersonally\(request\.resource\.data\)/);
  assert.match(rules, /Crew \(operators, staff\) never read it/);
  assert.match(rules, /\["status", "log", "loads", "startedAt", "completedAt", "completedBy", "completedByName",\s*"photos", "photosEmailedAt", "photosEmailedCount", "updatedAt", "updatedBy"\]/);
  assert.match(rules, /function companyOpen\(companyId\)/);
  assert.match(rules, /return companyId == "heartwood" \|\| companyNotPaused\(companyId\)/);
});
