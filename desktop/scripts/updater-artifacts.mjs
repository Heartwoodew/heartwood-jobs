// Turn Tauri updater signatures on only when the signing key is present.
// A checkout without TAURI_SIGNING_PRIVATE_KEY still builds the Windows installer.
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const conf = JSON.parse(readFileSync(path, "utf8"));
const enabled = typeof process.env.TAURI_SIGNING_PRIVATE_KEY === "string"
  && process.env.TAURI_SIGNING_PRIVATE_KEY.trim().length > 0;
conf.bundle.createUpdaterArtifacts = enabled;
writeFileSync(path, JSON.stringify(conf, null, 2) + "\n");
console.log(`createUpdaterArtifacts=${enabled}`);
