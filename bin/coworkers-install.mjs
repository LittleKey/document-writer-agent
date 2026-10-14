#!/usr/bin/env node
// coworkers-install — host-aware additive installer for the omo-coworkers package.
//
// Usage:
//   coworkers-install install   [--host v1|v2] [--opencode <exe>] [--target <dir>] [--force] [--json]
//   coworkers-install plan      [same flags]                              (dry run)
//   coworkers-install uninstall --target <dir> [--json]
//   coworkers-install rollback  --target <dir> [--json]
//   coworkers-install verify    --target <dir> [--json]
//
// Exit codes: 0 ok · 1 usage · 2 conflict (nothing written) · 3 host detection
// failed · 4 no install manifest found.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { install, plan, uninstall, rollback, verify, ConflictError, BASELINE } from "../installer/install.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

function usage(code = 1, message) {
  const text = `coworkers-install — omo-coworkers ${"3.0.0"} host-aware additive installer

Usage:
  coworkers-install install   [--host v1|v2] [--opencode <exe>] [--target <dir>] [--force] [--json]
  coworkers-install plan      [...]                                  dry run, writes nothing
  coworkers-install uninstall --target <dir> [--json]
  coworkers-install rollback  --target <dir> [--json]
  coworkers-install verify    --target <dir> [--json]

Options:
  --host <v1|v2>     OpenCode host flavor. Omit to auto-detect from
                     <executable> --version. Supported: v1 >= 1.18.29 within
                     major 1, v2 >= 2.0.20 within major 2; unknown majors and
                     pre-release versions are rejected. With --host but no
                     --opencode, files are rendered offline and the host
                     VERSION is not verified; with both flags the executable
                     is probed and a flavor mismatch aborts (exit 3).
  --opencode <exe>   OpenCode executable used for detection
                     (default: "opencode" on PATH).
  --target <dir>     Project directory to install into (default: cwd).
  --force            Take over conflicting files, recording byte-exact backups
                     first. Without it, conflicts abort before any write.
  --json             Machine-readable JSON result (manifest is always written
                     as <target>/.opencode/omo-coworkers-install.json).

Package baseline: ${BASELINE}`;
  if (message) console.error(`error: ${message}`);
  console.error(text);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { command: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host") opts.host = argv[++i];
    else if (a === "--opencode") opts.opencode = argv[++i];
    else if (a === "--target") opts.target = argv[++i];
    else if (a === "--force") opts.force = true;
    else if (a === "--json") opts.json = true;
    else if (a === "-h" || a === "--help") usage(0);
    else usage(1, `unknown argument ${a}`);
  }
  if (opts.host && opts.host !== "v1" && opts.host !== "v2") {
    usage(1, `--host must be "v1" or "v2", got ${JSON.stringify(opts.host)}`);
  }
  return opts;
}

function emit(opts, value) {
  if (opts.json) console.log(JSON.stringify(value, null, 2));
  return opts.json;
}

function fail(code, message) {
  console.error(`error: ${message}`);
  process.exit(code);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = resolve(opts.target ?? process.cwd());

  switch (opts.command) {
    case "install":
    case "plan": {
      const run = opts.command === "install" ? install : plan;
      let result;
      try {
        result = await run({
          packageRoot: PACKAGE_ROOT,
          target,
          host: opts.host,
          opencode: opts.opencode,
          force: opts.force,
        });
      } catch (err) {
        if (err instanceof ConflictError) {
          if (!emit(opts, { ok: false, code: 2, conflicts: err.report })) {
            for (const line of err.report) console.error(`conflict: ${line}`);
            console.error("nothing was written; reconcile or pass --force");
          }
          process.exit(2);
        }
        fail(err.code ?? 1, err.message);
      }
      const summary =
        opts.command === "plan"
          ? {
              ok: true,
              dryRun: true,
              target,
              host: result.host,
              files: result.entries.map((e) => ({ path: e.path, action: e.action, kind: e.kind, role: e.role, skill: e.skill })),
              overlay: { path: result.overlay.path, action: result.overlay.action },
            }
          : {
              ok: true,
              target,
              host: result.manifest.host,
              files: result.manifest.files,
              overlay: result.manifest.overlay,
              manifest: ".opencode/omo-coworkers-install.json",
              skills: result.manifest.skills,
              promptAuthority: result.manifest.promptAuthority,
            };
      if (!emit(opts, summary)) {
        const flavor = summary.host.flavor;
        const version = summary.host.version ? ` ${summary.host.version}` : "";
        let hostLine;
        if (summary.host.explicit && !summary.host.version) {
          hostLine = `host: ${flavor} (explicit --host; version not verified — offline format generation)`;
        } else if (summary.host.runtimeTested) {
          hostLine = `host: ${flavor}${version} (matches the installer-level runtime-tested host; not a claim of full release acceptance)`;
        } else if (summary.host.version) {
          hostLine = `host: ${flavor}${version} (supported configuration; installer-level runtime checks ran only on ${flavor === "v1" ? "1.18.33" : "2.0.20"})`;
        } else {
          hostLine = `host: ${flavor}${version}`;
        }
        console.log(hostLine);
        for (const f of summary.files) {
          console.log(`  ${f.action.padEnd(9)} ${f.path}`);
        }
        console.log(`  ${summary.overlay.action.padEnd(9)} ${summary.overlay.path}`);
        if (opts.command === "install") {
          console.log(`manifest: ${summary.manifest}`);
          console.log(`uninstall: coworkers-install uninstall --target ${target}`);
        }
      }
      break;
    }
    case "uninstall":
    case "rollback":
    case "verify": {
      let result;
      try {
        result = opts.command === "uninstall" ? uninstall({ target }) : opts.command === "rollback" ? rollback({ target }) : verify({ target });
      } catch (err) {
        fail(err.code ?? 1, err.message);
      }
      if (!emit(opts, { ok: true, command: opts.command, ...result })) {
        if (opts.command === "verify") {
          console.log(`ok: ${result.ok.length} · drift: ${result.drift.length} · missing: ${result.missing.length}`);
          for (const d of result.drift) console.log(`  drift   ${d}`);
          for (const m of result.missing) console.log(`  missing ${m}`);
        } else {
          for (const r of result.restored ?? []) console.log(`  restored ${r}`);
          for (const d of result.removed ?? []) console.log(`  removed  ${d}`);
          for (const d of result.deleted ?? []) console.log(`  deleted  ${d}`);
          for (const k of result.kept ?? []) console.log(`  kept     ${k.path} (${k.reason})`);
          for (const b of result.blocked ?? []) console.log(`  blocked  ${b}`);
          for (const w of result.warnings ?? []) console.log(`  warn     ${w}`);
          if (result.manifestRemoved === false) {
            console.log("manifest kept: some entries were left for owner reconciliation");
          }
        }
      }
      break;
    }
    default:
      usage(1, `unknown command ${JSON.stringify(opts.command)}`);
  }
}

main().catch((err) => fail(err.code ?? 1, err.stack ?? String(err)));
