// Machine-readable install manifest: <target>/.opencode/omo-coworkers-install.json
// Consumed by uninstall/rollback/verify and by downstream personal deployment.
//
// Scope: project manifests live under <target>/.opencode/, global manifests
// directly under the OpenCode config directory (<configDir>/). The manifest
// itself records `"scope": "project" | "global"`; an ABSENT scope field reads
// as project so manifests written before scopes existed stay valid.

import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST_NAME, sha256 } from "./render.mjs";
import { atomicWriteFileSync } from "./atomic.mjs";

export const SCHEMA_VERSION = 1;

export function normalizeScope(scope) {
  return scope === "global" ? "global" : "project";
}

export function manifestPath(target, scope = "project") {
  return normalizeScope(scope) === "global"
    ? join(target, MANIFEST_NAME)
    : join(target, ".opencode", MANIFEST_NAME);
}

export function readManifest(target, scope = "project") {
  const p = manifestPath(target, scope);
  if (!existsSync(p)) return null;
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`unsupported manifest schemaVersion ${parsed.schemaVersion} in ${p}`);
  }
  return parsed;
}

export function writeManifest(target, manifest, scope = "project") {
  manifest.schemaVersion = SCHEMA_VERSION;
  manifest.scope = normalizeScope(scope);
  atomicWriteFileSync(manifestPath(target, scope), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function removeManifest(target, scope = "project") {
  const p = manifestPath(target, scope);
  if (existsSync(p)) rmSync(p);
}

export function hashFile(absPath) {
  return sha256(readFileSync(absPath));
}
