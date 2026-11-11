// Collection group queries need an index with collection group scope. Firestore does not keep one by default,
// and the emulator does not check, so a missing one only fails in production.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const idx = JSON.parse(readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"));

test("push tokens can be found by company across users (collection group index)", () => {
  const o = (idx.fieldOverrides || []).find(x => x.collectionGroup === "fcmTokens" && x.fieldPath === "companyId");
  assert.ok(o, "fieldOverrides entry for fcmTokens.companyId");
  assert.ok(o.indexes.some(i => i.queryScope === "COLLECTION_GROUP" && i.order === "ASCENDING"));
  // An override replaces the automatic collection-scope indexes for that field, so keep them.
  assert.ok(o.indexes.some(i => i.queryScope === "COLLECTION" && i.order === "ASCENDING"));
  assert.ok(o.indexes.some(i => i.queryScope === "COLLECTION" && i.order === "DESCENDING"));
});
