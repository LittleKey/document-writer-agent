// Install orchestration: plan / install / uninstall / rollback / verify.
//
// Guarantees (tested in test/install.test.mjs):
// - additive: only manifest-listed paths and the two managed overlay keys are
//   touched; every non-overlay file is preserved byte-for-byte, and unrelated
//   semantic values inside the overlay JSON survive the structured merge (the
//   overlay is re-serialized — original byte layout is not, see merge.mjs);
// - idempotent: re-running an unchanged install is a no-op (exit 0);
// - conflict-safe: pre-existing unmanaged files stop the install (exit 2)
//   before any write, unless --force (which records byte-exact backups);
// - write-safe around links: every write is a same-dir temp file + rename, so
//   external hard-link twins are never written through (the managed path moves
//   to a fresh inode; the link relationship itself is not preserved or
//   restored — rollback restores recorded bytes, not inode topology);
// - reversible within its records: rollback restores the pre-install bytes of
//   the content it backed up; uninstall reverses only managed content and
//   intentionally preserves everything else (later user edits, schema/config
//   values, now-empty dirs) — neither is an exact whole-filesystem reversal.

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, rmdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { probeExecutable } from "./detect.mjs";
import { renderPlan, sha256, MANIFEST_NAME } from "./render.mjs";
import { mergeOverlay, unmergeOverlay, stringifyJson, MANAGED_AGENT_KEYS } from "./merge.mjs";
import { atomicWriteFileSync, isSymlinkPath } from "./atomic.mjs";
import * as manifestMod from "./manifest.mjs";

const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
export const BASELINE = "3504f153fd4f09ae5b282bd223e19fc504ec2dfa";

export class ConflictError extends Error {
  constructor(report) {
    super(`install conflicts (nothing was written):\n${report.join("\n")}`);
    this.name = "ConflictError";
    this.report = report;
    this.code = 2;
  }
}

function toAbs(target, rel) {
  return join(target, ...rel.split("/"));
}

function backupDirAbs(target, stamp) {
  return join(target, ".opencode", "document-writer-backup", stamp);
}

function recordBackup(target, stamp, rel, abs) {
  const dest = join(backupDirAbs(target, stamp), ...rel.split("/"));
  mkdirSync(dirname(dest), { recursive: true });
  const bytes = readFileSync(abs);
  writeFileSync(dest, bytes);
  return {
    backup: `.opencode/document-writer-backup/${stamp}/${rel}`,
    sha256Before: sha256(bytes),
  };
}

function readJsonIfExists(absPath) {
  if (!existsSync(absPath)) return { exists: false };
  const text = readFileSync(absPath, "utf8");
  try {
    return { exists: true, value: JSON.parse(text) };
  } catch (err) {
    return { exists: true, error: err.message };
  }
}

/** Build a plan (no writes). Throws ConflictError on blocking conflicts. */
export async function plan({
  packageRoot,
  target,
  host,
  opencode,
  force = false,
  now = new Date().toISOString(),
}) {
  target = resolve(target);

  let detection;
  if (host) {
    if (opencode) {
      // Explicit flavor AND a detection executable: probe and require agreement
      // before rendering anything for the requested flavor.
      const probe = await probeExecutable(opencode);
      if (!probe.ok) {
        const err = new Error(`--host ${host} given but the detection executable could not be verified: ${probe.reason}`);
        err.code = 3;
        throw err;
      }
      if (probe.flavor !== host) {
        const err = new Error(
          `--host ${host} given but ${JSON.stringify(opencode)} reports ${probe.version} (${probe.flavor}); refusing to render ${host}-format files for a ${probe.flavor} executable`,
        );
        err.code = 3;
        throw err;
      }
      detection = { ...probe, explicit: true };
    } else {
      // Offline format generation: the flavor is trusted, the version is not.
      detection = {
        ok: true,
        flavor: host,
        version: null,
        executable: null,
        explicit: true,
        runtimeTested: false,
        note: "host flavor set explicitly; no executable probed — host version not verified (offline format generation only)",
      };
    }
  } else {
    detection = await probeExecutable(opencode ?? "opencode");
    if (!detection.ok) {
      const err = new Error(detection.reason);
      err.code = 3;
      throw err;
    }
  }

  const overlay = JSON.parse(readFileSync(join(packageRoot, "oh-my-opencode-slim.json"), "utf8"));
  const rendered = renderPlan({ packageRoot, host: detection.flavor, overlay });

  const existingManifest = manifestMod.readManifest(target);
  if (existingManifest && existingManifest.host.flavor !== detection.flavor) {
    throw new ConflictError([
      `target ${target} holds a ${existingManifest.host.flavor} install (manifest ${MANIFEST_NAME}) but this run resolved host flavor ${detection.flavor}.`,
      `Run \`dw-install uninstall --target ${target}\` first, then install for the new host.`,
    ]);
  }

  const report = [];
  const entries = [];
  for (const file of rendered.files) {
    const abs = toAbs(target, file.path);
    if (isSymlinkPath(abs)) {
      // a symlink here is an owner-managed boundary (e.g. a path linked into
      // dotfiles); the installer never replaces links with regular files
      report.push(
        `symlink at managed path: ${file.path} — the installer never rewrites link boundaries; reconcile this path manually`,
      );
      entries.push({ ...file, action: "conflict" });
      continue;
    }
    const exists = existsSync(abs);
    let action = "create";
    let managed = existingManifest?.files.find((f) => f.path === file.path) ?? null;
    if (exists) {
      const currentHash = sha256(readFileSync(abs));
      if (!managed) {
        action = force ? "replace" : "conflict";
        if (!force) report.push(`unmanaged file exists: ${file.path}`);
      } else if (currentHash !== managed.sha256Installed) {
        action = force ? "replace" : "conflict";
        if (!force) report.push(`managed file changed since install: ${file.path} (run verify, reconcile, or pass --force)`);
      } else {
        action = "refresh";
      }
    }
    entries.push({ ...file, action });
  }

  // project overlay (.opencode/oh-my-opencode-slim.json)
  const overlayRel = rendered.overlayProject;
  const overlayAbs = toAbs(target, overlayRel);
  const jsoncAbs = toAbs(target, ".opencode/oh-my-opencode-slim.jsonc");
  const existingJson = readJsonIfExists(overlayAbs);
  let overlayAction;
  if (isSymlinkPath(overlayAbs)) {
    report.push(
      `symlink at managed path: ${overlayRel} — the installer never rewrites link boundaries; reconcile this path manually`,
    );
    overlayAction = "conflict";
  } else if (existsSync(jsoncAbs)) {
    // .jsonc wins over .json in the plugin's resolution order on both hosts;
    // maintaining a shadowed .json would silently no-op
    report.push(
      `project oh-my-opencode-slim.jsonc exists; .jsonc wins over .json in the plugin's config resolution, so an additive .json install would be shadowed. Merge the shipped fragment into the .jsonc manually.`,
    );
    overlayAction = "conflict";
  } else if (existingJson.exists && existingJson.error) {
    report.push(`project overlay ${overlayRel} is not valid JSON: ${existingJson.error}`);
    overlayAction = "conflict";
  } else if (!existingJson.exists) {
    overlayAction = "create";
  } else {
    const managesAny = MANAGED_AGENT_KEYS.some(
      (k) => existingJson.value?.agents?.[k] !== undefined,
    );
    const managedByUs = existingManifest?.overlay?.path === overlayRel;
    if (managesAny && !managedByUs) {
      if (!force) {
        report.push(
          `overlay ${overlayRel} already defines ${MANAGED_AGENT_KEYS.filter((k) => existingJson.value?.agents?.[k] !== undefined).join(", ")} but is not managed by this installer's manifest; refusing to take over. Reconcile manually or pass --force (backs up and merges).`,
        );
      }
      overlayAction = force ? "merge" : "conflict";
    } else if (managedByUs) {
      overlayAction = "remerge";
    } else {
      overlayAction = force || !managesAny ? "merge" : "conflict";
    }
    // idempotence: if merging would not change a single byte, mark unchanged
    if (overlayAction === "merge" || overlayAction === "remerge") {
      const mergedPreview = stringifyJson(mergeOverlay(existingJson.value, rendered.overlay));
      if (readFileSync(overlayAbs, "utf8") === mergedPreview) overlayAction = "unchanged";
    }
  }

  if (report.length > 0 || overlayAction === "conflict") throw new ConflictError(report);

  return {
    target,
    packageRoot: resolve(packageRoot),
    host: detection,
    package: { name: PKG.name, version: PKG.version, baseline: BASELINE },
    rendered,
    entries,
    overlay: {
      path: overlayRel,
      action: overlayAction,
      existing: existingJson.exists ? existingJson.value : null,
      managedByUs: existingManifest?.overlay?.path === overlayRel,
    },
    existingManifest,
    stamp: now.replace(/[:.]/g, "-"),
  };
}

/** Apply a plan: write files, merge overlay, write the manifest. */
export function apply(planResult, { now = new Date().toISOString() } = {}) {
  const { target, rendered, packageRoot } = planResult;
  const stamp = planResult.stamp;
  const files = [];
  const backups = [];

  for (const entry of planResult.entries) {
    const abs = toAbs(target, entry.path);
    if (
      entry.action === "refresh" &&
      existsSync(abs) &&
      sha256(readFileSync(abs)) === entry.sha256
    ) {
      files.push({ path: entry.path, action: "unchanged", kind: entry.kind, role: entry.role, skill: entry.skill, sha256Installed: entry.sha256, sha256Before: entry.sha256, backup: null });
      continue;
    }
    let backup = null;
    let sha256Before = null;
    if (existsSync(abs) && entry.action !== "refresh") {
      const rec = recordBackup(target, stamp, entry.path, abs);
      backup = rec.backup;
      sha256Before = rec.sha256Before;
      backups.push(rec.backup);
    }
    if (isSymlinkPath(abs)) {
      throw new Error(`refusing to write through symlink at ${entry.path} (changed between plan and apply)`);
    }
    mkdirSync(dirname(abs), { recursive: true });
    if (entry.content !== undefined) {
      atomicWriteFileSync(abs, entry.content);
    } else {
      atomicWriteFileSync(abs, readFileSync(join(packageRoot, entry.source)));
    }
    files.push({
      path: entry.path,
      action: entry.action === "refresh" ? "refreshed" : entry.action,
      kind: entry.kind,
      role: entry.role,
      skill: entry.skill,
      sha256Installed: sha256(readFileSync(abs)),
      sha256Before,
      backup,
    });
  }

  // overlay
  const overlayAbs = toAbs(target, rendered.overlayProject);
  const shipped = planResult.rendered.overlay;
  let overlayRecord;
  if (planResult.overlay.action === "unchanged") {
    overlayRecord = {
      path: rendered.overlayProject,
      action: "unchanged",
      managedKeys: Object.keys(shipped.agents ?? {}),
      backup: null,
      sha256Installed: sha256(readFileSync(overlayAbs)),
    };
  } else if (planResult.overlay.action === "create") {
    const content = stringifyJson(shipped);
    atomicWriteFileSync(overlayAbs, content);
    overlayRecord = {
      path: rendered.overlayProject,
      action: "create",
      managedKeys: Object.keys(shipped.agents ?? {}),
      backup: null,
      sha256Installed: sha256(Buffer.from(content)),
    };
  } else {
    let backup = null;
    let sha256Before = null;
    if (existsSync(overlayAbs)) {
      const rec = recordBackup(target, stamp, rendered.overlayProject, overlayAbs);
      backup = rec.backup;
      sha256Before = rec.sha256Before;
      backups.push(rec.backup);
    }
    const merged = mergeOverlay(planResult.overlay.existing, shipped);
    const content = stringifyJson(merged);
    atomicWriteFileSync(overlayAbs, content);
    overlayRecord = {
      path: rendered.overlayProject,
      action: planResult.overlay.managedByUs ? "remerge" : "merge",
      managedKeys: Object.keys(shipped.agents ?? {}),
      backup,
      sha256Before,
      sha256Installed: sha256(Buffer.from(content)),
    };
  }

  const manifest = {
    schemaVersion: manifestMod.SCHEMA_VERSION,
    package: planResult.package,
    host: planResult.host,
    installedAt: now,
    backupRoot: `.opencode/document-writer-backup/${stamp}`,
    files,
    overlay: overlayRecord,
    promptAuthority: Object.fromEntries(
      planResult.entries.filter((e) => e.kind === "role-agent").map((e) => [e.role, e.path]),
    ),
    skills: rendered.skillIds,
  };
  manifestMod.writeManifest(target, manifest);
  return { manifest, backups };
}

/** install = plan + apply; planning conflicts abort before any write. */
export async function install(opts) {
  const planResult = await plan(opts);
  const { manifest, backups } = apply(planResult, { now: opts.now });
  return { plan: planResult, manifest, backups };
}

function removeEmptyDirsUp(target, relDir, stopRel) {
  let cur = relDir;
  while (cur !== stopRel && cur !== "." && cur !== "/" && cur.length > 1) {
    const abs = toAbs(target, cur);
    try {
      if (readdirSync(abs).length > 0) break;
      rmdirSync(abs);
    } catch {
      break;
    }
    cur = dirname(cur).split("\\").join("/");
  }
}

/**
 * Uninstall: reverse the managed content and preserve everything else — later
 * user edits are kept and reported, and non-managed values (schema/config
 * fields, now-empty dirs) intentionally survive. This is a managed-content
 * reversal, not an exact whole-filesystem reversal of the install.
 */
export function uninstall({ target }) {
  target = resolve(target);
  const manifest = manifestMod.readManifest(target);
  if (!manifest) {
    const err = new Error(`no ${MANIFEST_NAME} under ${join(target, ".opencode")} — nothing to uninstall`);
    err.code = 4;
    throw err;
  }
  const removed = [];
  const kept = [];
  const restored = [];

  for (const file of manifest.files) {
    const abs = toAbs(target, file.path);
    if (!existsSync(abs)) {
      // nothing left to reverse — a missing file must not block a clean uninstall
      removed.push(file.path);
      continue;
    }
    if (isSymlinkPath(abs)) {
      // owner replaced the managed file with a link; leave the boundary alone
      kept.push({ path: file.path, reason: "now a symlink; left for owner reconciliation" });
      continue;
    }
    const currentHash = sha256(readFileSync(abs));
    if (currentHash !== file.sha256Installed) {
      kept.push({ path: file.path, reason: "changed after install; left for owner reconciliation" });
      continue;
    }
    rmSync(abs);
    if (file.action === "replace" && file.backup && existsSync(toAbs(target, file.backup))) {
      atomicWriteFileSync(abs, readFileSync(toAbs(target, file.backup)));
      restored.push(file.path);
    } else {
      removed.push(file.path);
      if (file.kind === "skill") {
        removeEmptyDirsUp(target, dirname(file.path).split("\\").join("/"), ".opencode");
      }
    }
  }

  const overlayPath = manifest.overlay?.path;
  if (overlayPath) {
    const overlayAbs = toAbs(target, overlayPath);
    if (isSymlinkPath(overlayAbs)) {
      kept.push({ path: overlayPath, reason: "now a symlink; left for owner reconciliation" });
    } else if (existsSync(overlayAbs)) {
      const parsed = readJsonIfExists(overlayAbs);
      if (parsed.exists && !parsed.error) {
        const { next, removed: didRemove } = unmergeOverlay(parsed.value);
        if (didRemove) {
          if (next === null) {
            if (manifest.overlay.action === "create") {
              if (sha256(readFileSync(overlayAbs)) === manifest.overlay.sha256Installed) {
                rmSync(overlayAbs);
                removed.push(overlayPath);
              } else {
                kept.push({ path: overlayPath, reason: "changed after install; left for owner reconciliation" });
              }
            } else if (manifest.overlay.backup && existsSync(toAbs(target, manifest.overlay.backup))) {
              atomicWriteFileSync(overlayAbs, readFileSync(toAbs(target, manifest.overlay.backup)));
              restored.push(overlayPath);
            }
          } else {
            atomicWriteFileSync(overlayAbs, stringifyJson(next));
            restored.push(`${overlayPath} (managed keys removed)`);
          }
        }
      } else {
        kept.push({ path: overlayPath, reason: "unparseable; left for owner reconciliation" });
      }
    }
  }

  const result = { target, removed, restored, kept, host: manifest.host.flavor };
  if (kept.length === 0) {
    if (manifest.backupRoot && existsSync(toAbs(target, manifest.backupRoot))) {
      rmSync(toAbs(target, manifest.backupRoot), { recursive: true, force: true });
    }
    manifestMod.removeManifest(target);
    result.manifestRemoved = true;
  } else {
    manifest.lastUninstall = { at: new Date().toISOString(), kept };
    manifestMod.writeManifest(target, manifest);
    result.manifestRemoved = false;
  }
  return result;
}

/**
 * Rollback: restore the pre-install bytes recorded in the install backups
 * (created files are deleted instead). Byte restoration only — inode/link
 * topology is not re-created: a hard-linked file that was merged comes back
 * with its original bytes on a fresh inode, and external twins keep their own
 * (never-written) copies. Covers handled failures during the install run, not
 * untested crash/power-loss recovery.
 */
export function rollback({ target }) {
  target = resolve(target);
  const manifest = manifestMod.readManifest(target);
  if (!manifest) {
    const err = new Error(`no ${MANIFEST_NAME} under ${join(target, ".opencode")} — nothing to roll back`);
    err.code = 4;
    throw err;
  }
  const restored = [];
  const deleted = [];
  const blocked = [];

  for (const file of manifest.files) {
    const abs = toAbs(target, file.path);
    if (file.backup && existsSync(toAbs(target, file.backup))) {
      if (isSymlinkPath(abs)) {
        blocked.push(file.path);
        continue;
      }
      atomicWriteFileSync(abs, readFileSync(toAbs(target, file.backup)));
      restored.push(file.path);
      continue;
    }
    if (!existsSync(abs) || isSymlinkPath(abs)) continue;
    if (sha256(readFileSync(abs)) !== file.sha256Installed) {
      blocked.push(file.path);
      continue;
    }
    rmSync(abs);
    deleted.push(file.path);
    if (file.kind === "skill") {
      removeEmptyDirsUp(target, dirname(file.path).split("\\").join("/"), ".opencode");
    }
  }

  const overlayPath = manifest.overlay?.path;
  if (overlayPath) {
    const overlayAbs = toAbs(target, overlayPath);
    if (manifest.overlay.backup && existsSync(toAbs(target, manifest.overlay.backup))) {
      if (!isSymlinkPath(overlayAbs)) {
        atomicWriteFileSync(overlayAbs, readFileSync(toAbs(target, manifest.overlay.backup)));
        restored.push(overlayPath);
      } else {
        blocked.push(overlayPath);
      }
    } else if (existsSync(overlayAbs) && !isSymlinkPath(overlayAbs)) {
      if (sha256(readFileSync(overlayAbs)) === manifest.overlay.sha256Installed) {
        rmSync(overlayAbs);
        deleted.push(overlayPath);
      } else {
        blocked.push(overlayPath);
      }
    }
  }

  if (blocked.length === 0) {
    const backupRootAbs = join(target, ".opencode", "document-writer-backup");
    if (existsSync(backupRootAbs)) rmSync(backupRootAbs, { recursive: true, force: true });
    manifestMod.removeManifest(target);
  }
  return { target, restored, deleted, blocked };
}

/** Verify: manifest vs disk hashes. */
export function verify({ target }) {
  target = resolve(target);
  const manifest = manifestMod.readManifest(target);
  if (!manifest) {
    const err = new Error(`no ${MANIFEST_NAME} under ${join(target, ".opencode")}`);
    err.code = 4;
    throw err;
  }
  const drift = [];
  const missing = [];
  const ok = [];
  for (const file of manifest.files) {
    const abs = toAbs(target, file.path);
    if (!existsSync(abs)) {
      missing.push(file.path);
      continue;
    }
    if (sha256(readFileSync(abs)) !== file.sha256Installed) drift.push(file.path);
    else ok.push(file.path);
  }
  return { target, host: manifest.host, ok, drift, missing, package: manifest.package };
}
