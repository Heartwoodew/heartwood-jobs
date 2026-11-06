// Clearly named stub. There is no Gmail client in this branch.
// Calling it is a bug. The photo intake worker does not import this file.
export function fetchGmailAttachment() {
  const err = new Error("gmail-stub: Gmail rights are not enabled and no Gmail client is configured");
  err.code = "gmail-rights-not-enabled";
  throw err;
}
