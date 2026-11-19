// Compiles cloud/firestore.production.rules in the local emulator.
// Does not call firebaserules.googleapis.com and does not deploy.
import test from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc } from "firebase/firestore";

test("production rules compile and still deny an anonymous job read", async () => {
  const rules = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  const env = await initializeTestEnvironment({
    projectId: "demo-rules-compile",
    firestore: { rules },
  });
  try {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "jobs/compile-check")));
  } finally {
    await env.cleanup();
  }
});
