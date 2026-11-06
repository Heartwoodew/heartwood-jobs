import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Config } = require("firebase-tools/lib/config");
const { filterTargets } = require("firebase-tools/lib/filterTargets");
const { VALID_DEPLOY_TARGETS } = require("firebase-tools/lib/commands/deploy");
const { loadRC } = require("firebase-tools/lib/rc");

const repo = fileURLToPath(new URL("../../", import.meta.url));
const cli = fileURLToPath(new URL("../node_modules/.bin/firebase", import.meta.url));
const config = "cloud/production/firebase.json";
const reviewed = `firebase deploy --only storage --config ${config} --project heartwood-9f37f --non-interactive`;

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

function runFirebase(args) {
  return spawnSync(cli, args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  });
}

test("production config is storage-only and rules match the emulator file", () => {
  const json = JSON.parse(read("../production/firebase.json"));
  assert.deepEqual(Object.keys(json), ["storage"]);
  assert.equal(json.storage.rules, "storage.rules");
  assert.equal(json.storage.predeploy, undefined);
  assert.equal("firestore" in json, false);
  assert.equal("functions" in json, false);
  assert.equal("hosting" in json, false);
  const prod = readFileSync(new URL("../production/storage.rules", import.meta.url));
  const emu = readFileSync(new URL("../emulator/storage.rules", import.meta.url));
  assert.equal(prod.equals(emu), true);
  const rc = JSON.parse(read("../production/.firebaserc"));
  assert.equal(rc.projects.default, "demo-heartwood");
  assert.equal(JSON.stringify(rc).includes("heartwood-9f37f"), false);
  assert.match(reviewed, /--only storage/);
  assert.match(reviewed, /--config cloud\/production\/firebase\.json/);
  assert.match(reviewed, /--project heartwood-9f37f/);
  assert.doesNotMatch(reviewed, /firestore|functions|hosting/);
});

test("capture config still refuses deploy and does not schedule retention", () => {
  const capture = JSON.parse(read("../firebase.json"));
  assert.deepEqual(capture.storage.predeploy, ["node scripts/refuse-live-deploy.js"]);
  assert.deepEqual(capture.functions.predeploy, ["node scripts/refuse-live-deploy.js"]);
  assert.match(read("../../app/features/cloud-retention.js"), /export const SCHEDULING_APPROVED = false/);
  const refused = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/refuse-live-deploy.js", import.meta.url))], { encoding: "utf8" });
  assert.equal(refused.status, 1);
});

test("firestore and functions targets do not match the production config", () => {
  for (const only of ["firestore", "functions"]) {
    const result = runFirebase([
      "deploy", "--only", only, "--config", config, "--project", "demo-heartwood", "--dry-run", "--non-interactive",
    ]);
    const text = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, text);
    assert.match(text, new RegExp(`No targets in firebase\\.json match '--only ${only}'`));
    assert.doesNotMatch(text, /Deploy complete|released rules|Dry run complete/);
  }
});

test("storage target parses locally and a demo dry-run stops before any release", () => {
  const options = { cwd: repo, configPath: config, only: "storage" };
  options.config = Config.load(options);
  assert.deepEqual(filterTargets(options, VALID_DEPLOY_TARGETS), ["storage"]);
  const rulesPath = options.config.path(options.config.get("storage.rules"));
  assert.match(rulesPath, /cloud\/production\/storage\.rules$/);
  options.only = "storage,firestore";
  assert.deepEqual(filterTargets(options, VALID_DEPLOY_TARGETS), ["storage"]);
  const rc = loadRC({ cwd: repo, configPath: config });
  assert.equal(rc.path.endsWith("cloud/production/.firebaserc"), true);
  assert.equal(rc.resolveAlias("default"), "demo-heartwood");

  const result = runFirebase([
    "deploy", "--only", "storage", "--config", config, "--project", "demo-heartwood", "--dry-run", "--non-interactive",
  ]);
  const text = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(text, /Failed to authenticate/);
  assert.doesNotMatch(text, /released rules|Deploy complete|Dry run complete|heartwood-9f37f/);
});
