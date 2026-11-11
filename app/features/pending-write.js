// Firestore keeps a write on the phone when there is no signal, but the promise only settles once the
// server answers. A form that awaits it stays open, so people tap Save again and make a second record.
// settleOrQueue waits a short time, then reports the write as queued so the form can close.

export function settleOrQueue(write, ms = 4000) {
  let timer;
  const wait = new Promise(resolve => { timer = setTimeout(() => resolve({ queued: true }), ms); });
  const done = Promise.resolve(write).then(value => ({ queued: false, value }));
  return Promise.race([done, wait]).finally(() => clearTimeout(timer));
}

// One save at a time per form. Returns false while a save is running.
export function saveGuard() {
  let busy = false;
  return {
    get busy() { return busy; },
    start() { if (busy) return false; busy = true; return true; },
    end() { busy = false; },
  };
}
