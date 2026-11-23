// Boot must leave the loading skeleton if Firestore or auth never answers.
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bootStallHtml, bootWatchdog, readOrCache, trackRead, withTimeout } from "../app/features/boot-guard.js";

const APP = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const SW = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");

function useTimers(t) {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

test("withTimeout rejects a stalled read and passes a real failure through", async (t) => {
  useTimers(t);
  const hung = withTimeout(new Promise(() => {}), 8000, "users/uid");
  mock.timers.tick(7999);
  await flush();
  let settled = false;
  hung.then(() => { settled = true; }, () => { settled = true; });
  await flush();
  assert.equal(settled, false);
  mock.timers.tick(1);
  await assert.rejects(hung, err => err && err.code === "boot-timeout" && err.label === "users/uid");

  assert.equal(await withTimeout(Promise.resolve("ok"), 8000, "users/uid"), "ok");
  mock.timers.tick(8000);
  await assert.rejects(
    withTimeout(Promise.reject(Object.assign(new Error("no"), { code: "permission-denied" })), 8000, "users/uid"),
    err => err.code === "permission-denied",
  );
});

test("a timed read is dropped so a retry asks the server again", async (t) => {
  useTimers(t);
  const reads = new Map();
  let calls = 0;
  const hang = () => { calls += 1; return new Promise(() => {}); };
  const first = trackRead(reads, "users/u", hang, 8000, "users/u");
  assert.equal(reads.size, 1);
  assert.equal(calls, 1);
  const shared = trackRead(reads, "users/u", hang, 0);
  assert.equal(calls, 1, "an in-flight read is shared until it times out");
  mock.timers.tick(8000);
  await assert.rejects(first, err => err.code === "boot-timeout" && err.label === "users/u");
  assert.equal(reads.has("users/u"), false);
  const second = trackRead(reads, "users/u", hang, 8000, "users/u");
  assert.equal(calls, 2);
  assert.equal(reads.size, 1);
  mock.timers.tick(8000);
  await assert.rejects(second, err => err.code === "boot-timeout");
  assert.equal(reads.has("users/u"), false);
  void shared;
});

test("watchdog done() cancels the card", async (t) => {
  useTimers(t);
  let card = "";
  const dog = bootWatchdog({
    ms: 12000,
    onStall(stage) { card = bootStallHtml(stage); },
  });
  dog.stage("auth");
  dog.stage("profile");
  dog.done();
  dog.stage("company");
  mock.timers.tick(12000);
  await flush();
  assert.equal(card, "");
});

test("a getDoc that never settles uses the cache at 8s and the card at 12s", async (t) => {
  useTimers(t);
  const events = [];
  let card = "";
  const dog = bootWatchdog({
    ms: 12000,
    onStall(stage) { card = bootStallHtml(stage); events.push("card:" + stage); },
  });
  dog.stage("auth");
  const profile = readOrCache(
    () => { events.push("server"); return new Promise(() => {}); },
    () => { events.push("cache"); return Promise.resolve({ name: "Sam", role: "operator" }); },
    8000,
    "users/uid",
  );
  mock.timers.tick(7999);
  await flush();
  assert.deepEqual(events, ["server"]);
  mock.timers.tick(1);
  assert.deepEqual(await profile, { name: "Sam", role: "operator" });
  assert.deepEqual(events, ["server", "cache"]);
  assert.equal(card, "");
  dog.stage("profile");
  // A later boot read is still open, so nothing has called done().
  const company = readOrCache(
    () => new Promise(() => {}),
    () => Promise.resolve(null),
    8000,
    "companies/acme",
  );
  mock.timers.tick(4000);
  await flush();
  assert.match(card, /<h2>Still connecting…<\/h2>/);
  assert.match(card, /If you've just changed network or VPN, tap Retry\./);
  assert.match(card, /id="bootretry"[^>]*>Retry</);
  assert.match(card, /id="bootreload"[^>]*>Reload</);
  assert.match(card, /id="bootsignout"[^>]*>Sign out</);
  assert.match(card, /class="big primary"/);
  assert.match(card, /class="ghost sm"/);
  assert.match(card, /Stuck at: profile/);
  assert.doesNotMatch(card, /\$/);
  assert.deepEqual(events.filter(e => e.startsWith("card")), ["card:profile"]);
  mock.timers.tick(4000);
  assert.equal(await company, null);
  // A real first paint cancels any later card and the screen replaces it.
  dog.done();
  const again = card;
  mock.timers.tick(12000);
  await flush();
  assert.equal(card, again);
});

test("a platform session write that never settles does not block the first paint", async (t) => {
  useTimers(t);
  let painted = false;
  const write = new Promise(() => {});
  const boot = (async () => {
    let companyViewClearFailed = false;
    try {
      await withTimeout(write, 5000, "platformSessions");
    } catch (e) {
      // Same path as a failed clear: keep going and paint.
      companyViewClearFailed = true;
      assert.equal(e && e.code, "boot-timeout");
      assert.equal(e.label, "platformSessions");
    }
    painted = true;
    return companyViewClearFailed;
  })();
  mock.timers.tick(4999);
  await flush();
  assert.equal(painted, false, "boot is still waiting on the server at 4.9s");
  mock.timers.tick(1);
  assert.equal(await boot, true);
  assert.equal(painted, true, "first paint runs at 5s while setDoc is still pending");
});

test("the app bounds boot, shows the recovery card, and does not force long polling", () => {
  const boot = APP.slice(APP.indexOf("async function bootSignedIn"), APP.indexOf("function startBootWatch"));
  assert.match(boot, /bootGuard\.stage\("auth"\)/);
  assert.match(boot, /bootGuard\.stage\("profile"\)/);
  assert.match(boot, /bootGuard\.stage\("company"\)/);
  assert.match(boot, /cachedGetDoc\(userRef, 8000, "users\/" \+ user\.uid\)/);
  assert.match(boot, /getDocFromCache\(userRef\)/);
  assert.match(boot, /readOrCache\(\s*\(\) => getDocs\(usersQ\),\s*\(\) => getDocsFromCache\(usersQ\),\s*8000,\s*"users",\s*\)/);
  assert.match(boot, /readOrCache\(\s*\(\) => getDoc\(sessRef\),\s*\(\) => getDocFromCache\(sessRef\),\s*8000,\s*"platformSessions\/" \+ user\.uid,\s*\)/);
  assert.match(boot, /withTimeout\(user\.getIdTokenResult\(\), 6000, "id-token"\)/);
  assert.match(boot, /withTimeout\(setDoc\(doc\(db, "platformSessions", user\.uid\), clearedCompanySession\(\)\), 5000, "platformSessions"\)/);
  assert.match(boot, /companyViewClearFailed = true/);
  assert.match(boot, /renderOfflineSignedIn\(user\)/);
  assert.match(boot, /renderNoAccess\(user\)/);
  assert.match(APP, /cachedGetDoc\(companyRef, 8000, "companies\/" \+ id\)/);
  assert.match(APP, /err\.code === "boot-timeout"/);
  assert.match(APP, /getDocFromCache\(companyRef\)/);
  assert.match(APP, /bootWatchdog\(\{\s*ms: 12000/);
  assert.match(APP, /bootGuard = startBootWatch\(\)/);
  assert.match(APP, /bootGuard\.stage\("first paint"\)/);
  assert.match(APP, /bootGuard\.done\(\)/);
  assert.match(APP, /console\.warn\("Stuck at: " \+ where\)/);
  assert.match(APP, /root\.innerHTML = bootStallHtml\(where\)/);
  assert.match(APP, /docReads\.clear\(\)/);
  assert.match(APP, /await disableNetwork\(db\)/);
  assert.match(APP, /await enableNetwork\(db\)/);
  assert.match(APP, /bootSignedIn\(auth\.currentUser \|\| null\)/);
  assert.match(APP, /location\.reload\(\)/);
  assert.match(APP, /addEventListener\("online"/);
  assert.match(APP, /visibilitychange/);
  assert.match(APP, /visibilityState === "visible"/);
  assert.match(APP, /persistentLocalCache\(\{ tabManager: persistentMultipleTabManager\(\) \}\)/);
  assert.doesNotMatch(APP, /experimentalForceLongPolling/);
  assert.doesNotMatch(APP, /persistentSingleTabManager/);
  assert.match(APP, /return trackRead\(docReads, key, \(\) => getDoc\(ref\), ms, label \|\| key\)/);
  assert.match(SW, /callup-shell-v150-help-video-5/);
  assert.match(SW, /features\/boot-guard\.js/);
  const card = bootStallHtml("profile");
  assert.match(card, /Still connecting…/);
  assert.match(card, /Stuck at: profile/);
  assert.doesNotMatch(card, /\$/);
});
