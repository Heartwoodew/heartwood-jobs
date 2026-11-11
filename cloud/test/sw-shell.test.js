// The service worker must precache every file the app imports, so a phone that picked up an update online
// can still open the app with no signal. Runtime-cached copies are deleted with the old cache on update.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "../../app");
const sw = readFileSync(join(APP, "sw.js"), "utf8");

function swList(name) {
  const m = sw.match(new RegExp("const " + name + " = (\\[[\\s\\S]*?\\])(;|\\.map)"));
  assert.ok(m, name + " list in sw.js");
  return m[1];
}
const SHELL = new Set(JSON.parse(swList("SHELL")));

function importsOf(file) {
  const src = readFileSync(join(APP, file), "utf8");
  const out = new Set();
  for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)) out.add(m[1]);
  return out;
}

test("every local module the app imports is in the service worker shell", () => {
  const seen = new Set(), queue = ["app.js"];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      if (!spec.startsWith(".")) continue;
      const rel = relative(APP, normalize(join(APP, dirname(file), spec))).replace(/\\/g, "/");
      assert.ok(existsSync(join(APP, rel)), rel + " exists");
      queue.push(rel);
    }
  }
  const missing = [...seen].filter(f => !SHELL.has(f));
  assert.deepEqual(missing, [], "missing from SHELL in app/sw.js");
});

test("every Firebase SDK file the page imports is precached", () => {
  const sdk = new Set();
  for (const file of ["app.js", ...[...SHELL].filter(f => f.startsWith("features/"))]) {
    if (!existsSync(join(APP, file))) continue;
    for (const spec of importsOf(file)) if (spec.startsWith("https://www.gstatic.com/firebasejs/")) sdk.add(spec);
  }
  const m = sw.match(/const SDK = \[([^\]]*)\]\.map\(n => "([^"]+)" \+ n \+ "([^"]+)"\)/);
  assert.ok(m, "SDK list in sw.js");
  const cached = new Set(JSON.parse("[" + m[1] + "]").map(n => m[2] + n + m[3]));
  assert.deepEqual([...sdk].filter(u => !cached.has(u)), [], "SDK files missing from the SDK list in app/sw.js");
  assert.match(sw, /addAll\(\[\.\.\.SHELL, \.\.\.SDK\]\)/);
});

test("offline, only a page load falls back to index.html", () => {
  assert.match(sw, /e\.request\.mode === "navigate" \? caches\.match\("index\.html"\) : Response\.error\(\)/);
});
