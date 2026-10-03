// Machine-readable install manifest: <target>/.opencode/document-writer-install.json
// Consumed by uninstall/rollback/verify and by downstream personal deployment.

import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "./render.mjs";
import { atomicWriteFileSync } from "./atomic.mjs";

export const SCHEMA_VERSION = 1;

export function manifestPath(target) {
  return join(target, ".opencode", "document-writer-install.json");
}

export function readManifest(target) {
  const p = manifestPath(target);
  if (!existsSync(p)) return null;
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`unsupported manifest schemaVersion ${parsed.schemaVersion} in ${p}`);
  }
  return parsed;
}

export function writeManifest(target, manifest) {
  manifest.schemaVersion = SCHEMA_VERSION;
  atomicWriteFileSync(manifestPath(target), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function removeManifest(target) {
  const p = manifestPath(target);
  if (existsSync(p)) rmSync(p);
}

export function hashFile(absPath) {
  return sha256(readFileSync(absPath));
}
