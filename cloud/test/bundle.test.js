import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("functions bundle matches the webpage modules", () => {
  for (const name of ["cloud-storage.js", "cloud-retention.js"]) {
    const web = readFileSync(new URL(`../../app/features/${name}`, import.meta.url));
    const fn = readFileSync(new URL(`../functions/shared/${name}`, import.meta.url));
    assert.equal(fn.equals(web), true, name);
  }
});

test("deploy guard refuses", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/refuse-live-deploy.js", import.meta.url))], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /disabled/);
});
