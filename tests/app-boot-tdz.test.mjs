// Regression: v132-v134 used $() at module top level before `const $` was declared,
// so app.js threw "Cannot access '$' before initialization" and stuck on Loading… for everyone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const lines = src.split("\n");

test("top-level code does not call $() or $$() before they are declared", () => {
  const declared = lines.findIndex(l => /^const \$ = /.test(l));
  assert.ok(declared > 0, "const $ declaration found");
  const early = [];
  let depth = 0;
  for (let i = 0; i < declared; i++) {
    const line = lines[i];
    if (depth === 0 && /(^|[^\w$.])\$\$?\(/.test(line)) early.push(`${i + 1}: ${line.trim()}`);
    for (const ch of line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")) {
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }
  assert.deepEqual(early, [], "module-level $() before its const declaration throws a TDZ ReferenceError");
});

test("service worker version is bumped for the boot fix", () => {
  const sw = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v141-industries/);
});
