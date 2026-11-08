// Loads the CallUp how-to pack when it exists.
// docs/knowledge/callup-knowledge.md is written by a separate docs change.
// Until that file is in the tree, the bundled placeholder is used.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const KNOWLEDGE_CAP = 10000;
const PLACEHOLDER_MARK = "helper-knowledge: placeholder";

export const INLINE_PLACEHOLDER = `<!-- ${PLACEHOLDER_MARK} -->
# CallUp helper knowledge (placeholder)

This is not the source-verified pack. Do not invent CallUp steps that are not written here.

Helper only looks things up. It cannot create a job, change a job, send a message, send an email, or send anything to Xero.
An operator sees jobs assigned to them. Prices stay off that login.
A supervisor or admin sees prices only when their profile already allows it.
One business never sees another business's jobs.
If a fact is not in these notes or in the job data, say you don't have it.
`;

function finish(text, source) {
  const body = String(text || "");
  const capped = body.length > KNOWLEDGE_CAP ? body.slice(0, KNOWLEDGE_CAP) : body;
  return {
    text: capped,
    source,
    truncated: body.length > KNOWLEDGE_CAP,
  };
}

export function loadKnowledge({ env = process.env, exists = existsSync, read = readFileSync } = {}) {
  const explicit = env.HELPER_KNOWLEDGE_PATH;
  const pack = join(here, "../../../docs/knowledge/callup-knowledge.md");
  const bundled = join(here, "../knowledge/callup-knowledge.md");
  if (explicit && exists(explicit)) {
    const text = read(explicit, "utf8");
    return finish(text, text.includes(PLACEHOLDER_MARK) ? "placeholder" : "pack");
  }
  if (exists(pack)) return finish(read(pack, "utf8"), "pack");
  if (exists(bundled)) return finish(read(bundled, "utf8"), "placeholder");
  return finish(INLINE_PLACEHOLDER, "placeholder");
}
