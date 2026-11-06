// CallUp Pro only. Not part of Base, and not part of the default cloud deploy.
// Heartwood's existing xeroQueue and the desktop worker are unchanged.
// This file is not imported by functions/index.js.
// It does not call Xero unless a separate admin sets CALLUP_PLAN=pro and
// XERO_PROCESSING_ENABLED=true. Even then the default transport is the stub,
// which performs no network I/O.

export const PRO_ONLY = true;
export const BASE_INCLUDES_XERO = false;

export function handleXeroQueue(items, env = {}, transport = null) {
  const plan = env.CALLUP_PLAN || "base";
  if (plan !== "pro" || env.XERO_PROCESSING_ENABLED !== "true") {
    return {
      ran: false,
      reason: "pro-plan-not-enabled",
      plan,
      transportCalls: 0,
      writes: [],
      note: "CallUp Base has no Xero interoperability or invoicing. Heartwood's current queue is left for the existing worker.",
    };
  }
  const call = transport || (async () => {
    throw new Error("xero-stub: no live Xero client is configured");
  });
  const writes = [];
  let transportCalls = 0;
  for (const item of items || []) {
    if (!item || item.status !== "queued") continue;
    transportCalls += 1;
    writes.push({ queueId: item.id || null, outcome: "stub-refused-live-xero" });
    void call;
  }
  return {
    ran: true,
    reason: null,
    plan: "pro",
    transportCalls: 0,
    writes,
    liveXero: false,
  };
}
