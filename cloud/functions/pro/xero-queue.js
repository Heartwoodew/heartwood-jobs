// Not a CallUp product feature, and not imported by functions/index.js.
// Customer companies do not connect to Xero. Heartwood's xeroQueue and the
// desktop worker (tools/xero_queue.py) are unchanged and are not started here.
// This function never calls a transport.

export const PRODUCT_INCLUDES_XERO = false;

export function handleXeroQueue(items, env = {}, transport = null) {
  void items;
  void env;
  void transport;
  return {
    ran: false,
    reason: "not-a-product-feature",
    plan: "callup",
    transportCalls: 0,
    writes: [],
    liveXero: false,
    note: "CallUp does not connect customer companies to Xero. Heartwood's queue is left for the existing worker.",
  };
}
