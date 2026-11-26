// Patrick's clock on, 26 Nov 2026: the live-location timer used SHARE_MIN_MS without importing it,
// so every clock on threw a ReferenceError. These checks keep the clock-on path from throwing or waiting forever.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as acorn from "acorn";
import * as walk from "acorn-walk";

const src = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
const ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module" });

function fnBody(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name + " exists");
  const open = src.indexOf(") {", start) + 2;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced " + name);
}

test("every constant-style name app.js uses is imported or declared", () => {
  const declared = new Set();
  for (const node of ast.body) {
    if (node.type === "ImportDeclaration") for (const s of node.specifiers) declared.add(s.local.name);
  }
  walk.full(ast, node => {
    if (node.type === "VariableDeclarator") walk.full(node.id, n => { if (n.type === "Identifier") declared.add(n.name); });
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) declared.add(node.id.name);
  });
  const globals = new Set(["URL", "JSON", "NaN", "URLSearchParams", "PDFLib", "CSS"]);
  const used = new Set();
  walk.full(ast, node => {
    if (node.type === "Identifier" && /^[A-Z][A-Z0-9_]{2,}$/.test(node.name)) used.add(node.name);
  });
  // Object keys and member names (obj.FOO, { FOO: 1 }) are not variable reads.
  const notReads = new Set();
  walk.full(ast, node => {
    if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") notReads.add(node.property);
    if (node.type === "Property" && !node.computed && node.key.type === "Identifier" && !node.shorthand) notReads.add(node.key);
  });
  const reads = new Set();
  walk.full(ast, node => {
    if (node.type === "Identifier" && /^[A-Z][A-Z0-9_]{2,}$/.test(node.name) && !notReads.has(node)) reads.add(node.name);
  });
  const missing = [...reads].filter(n => !declared.has(n) && !globals.has(n));
  assert.deepEqual(missing, [], "used but never imported or declared: " + missing.join(", "));
  assert.ok(used.has("SHARE_MIN_MS"));
});

test("SHARE_MIN_MS comes from live-location.js", () => {
  const imp = ast.body.find(n => n.type === "ImportDeclaration" && n.source.value === "./features/live-location.js");
  assert.ok(imp.specifiers.some(s => s.local.name === "SHARE_MIN_MS"));
});

test("live sharing can never break a clock punch", () => {
  const start = fnBody("liveShareStart");
  assert.match(start, /try \{\s*if \(firstFix\) considerShareFix\(firstFix\);\s*armShareWatch\(\);\s*\} catch/);
  const punch = fnBody("tsPunch");
  assert.match(punch, /try \{ liveShareStart\(id, ws, fix\); \} catch/);
  // The shift id is kept before live sharing starts, so the machine question still follows a clock on.
  assert.ok(punch.indexOf("ui.tsMachineShift = id;") < punch.indexOf("liveShareStart(id, ws, fix)"));
});

test("a clock punch read has a deadline and then uses this phone's copy", () => {
  const load = fnBody("tsLoad");
  assert.match(src, /const TS_PUNCH_READ_MS = 6000;/);
  assert.match(load, /opts\.offlineOk\s*\?\s*await withTimeout\(getDoc\(ref\), TS_PUNCH_READ_MS/);
  assert.match(load, /getDocFromCache\(ref\)/);
});

test("the machine question takes one tap, cannot wait forever, and always clears", () => {
  const pick = fnBody("tsChooseMachine");
  assert.match(pick, /ui\.tsMachineBusy\) return;/);
  assert.match(pick, /tsLoad\(ws, \{ offlineOk: true \}\)/);
  assert.match(pick, /queueWrite\(write,/);
  assert.match(pick, /finally \{\s*ui\.tsMachineBusy = false;\s*tsRerender\(\);/);
  assert.doesNotMatch(pick, /await updateDoc\(/);
});
