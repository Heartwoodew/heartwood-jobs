import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(name) {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}
function slice(text, start, end) {
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  assert.ok(i >= 0 && j > i, start);
  return text.slice(i, j + end.length);
}

const BLOCKS = [
  ["../production/firestore.inbox.rules", "// BEGIN INBOX IMPORT RULES", "// END INBOX IMPORT RULES"],
  ["../production/firestore.hours-export.rules", "// BEGIN HOURS EXPORT RULES", "// END HOURS EXPORT RULES"],
  ["../production/firestore.reimbursements.rules", "// BEGIN REIMBURSEMENT CLAIM RULES", "// END REIMBURSEMENT CLAIM RULES"],
  ["../production/firestore.chat.rules", "// BEGIN CHAT RULES", "// END CHAT RULES"],
  ["../production/firestore.swms.rules", "// BEGIN SWMS SIGNATURE RULES", "// END SWMS SIGNATURE RULES"],
  ["../production/firestore.leave.rules", "// BEGIN LEAVE RULES", "// END LEAVE RULES"],
  ["../production/firestore.fleet.rules", "// BEGIN FLEET RULES", "// END FLEET RULES"],
];

test("production rules keep the live blocks and open company-scoped jobs", () => {
  const rules = read("../firestore.production.rules");
  for (const [file, start, end] of BLOCKS) {
    assert.equal(slice(rules, start, end), slice(read(file), start, end), file);
  }
  assert.match(rules, /function docCompany/);
  assert.match(rules, /: "heartwood"/);
  assert.match(rules, /match \/jobs\/\{id\}/);
  assert.match(rules, /match \/quotes\/\{id\}/);
  assert.doesNotMatch(slice(rules, "match /jobs/{id}", "match /receipts/{id}"), /allow write: if false/);
  assert.match(rules, /Missing companyId means heartwood/);
});
