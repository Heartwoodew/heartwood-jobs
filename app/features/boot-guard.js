// Startup must not wait forever on a half-open connection. A read that never
// settles used to leave the loading skeleton up. These helpers are pure: the
// app decides what to paint when they fire.

export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject({ code: "boot-timeout", label }), ms);
  });
  return Promise.race([
    Promise.resolve(promise).then(value => value, err => { throw err; }),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

// One in-flight read per key. A boot timeout drops that entry so Retry starts
// a new server read instead of joining the stalled one.
export function trackRead(reads, key, startRead, ms = 0, label = "") {
  let pending = reads.get(key);
  if (!pending) {
    const read = typeof startRead === "function" ? startRead() : startRead;
    pending = Promise.resolve(read).then(snap => snap, err => {
      if (reads.get(key) === pending) reads.delete(key);
      throw err;
    });
    reads.set(key, pending);
  }
  if (!ms) return pending;
  return withTimeout(pending, ms, label || key).then(snap => snap, err => {
    if (err && err.code === "boot-timeout" && reads.get(key) === pending) reads.delete(key);
    throw err;
  });
}

// Server read first. On a boot timeout, the saved copy. Any other failure is
// left for the caller, which already has its own fallback.
export async function readOrCache(serverRead, cacheRead, ms, label) {
  try {
    const pending = typeof serverRead === "function" ? serverRead() : serverRead;
    return await withTimeout(pending, ms, label);
  } catch (err) {
    if (!err || err.code !== "boot-timeout") throw err;
    try { return typeof cacheRead === "function" ? await cacheRead() : await cacheRead; }
    catch { return null; }
  }
}

export function bootWatchdog({ ms = 12000, onStall } = {}) {
  let stageName = "start";
  let finished = false;
  const timer = setTimeout(() => {
    if (finished) return;
    if (typeof onStall === "function") onStall(stageName);
  }, ms);
  return {
    stage(name) {
      if (name != null && name !== "") stageName = String(name);
      return stageName;
    },
    done() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
    },
  };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function bootStallHtml(stage) {
  const where = stage == null || stage === "" ? "start" : String(stage);
  return `<form class="card login" id="bootstall">
    <h2>Still connecting…</h2>
    <p>CallUp is taking longer than usual to reach the server. If you've just changed network or VPN, tap Retry.</p>
    <button class="big primary" type="button" id="bootretry">Retry</button>
    <button class="big ghost" type="button" id="bootreload">Reload</button>
    <button class="ghost sm" type="button" id="bootsignout">Sign out</button>
    <p class="sub">Stuck at: ${esc(where)}</p>
  </form>`;
}
