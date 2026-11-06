// Clearly named stub. CallUp Base does not call Xero.
// The Pro executor does not use this unless a later admin wires it, and even then
// this function never opens a network connection.
export async function xeroStubRequest() {
  const err = new Error("xero-stub: no live Xero client is configured");
  err.code = "xero-not-enabled";
  throw err;
}
