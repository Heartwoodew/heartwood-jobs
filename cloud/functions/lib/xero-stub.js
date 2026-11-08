// Clearly named stub. CallUp does not call Xero for customer companies.
// This function never opens a network connection.
export async function xeroStubRequest() {
  const err = new Error("xero-stub: no live Xero client is configured");
  err.code = "xero-not-enabled";
  throw err;
}
