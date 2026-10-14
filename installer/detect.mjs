// Host detection for the omo-coworkers portable package.
//
// Supported host configuration (see INSTALL.md "Supported vs runtime-tested"):
//   v1: stable OpenCode >= 1.18.29, major 1 only  (installer-level runtime checks ran on 1.18.33)
//   v2: stable OpenCode >= 2.0.20, major 2 only   (installer-level runtime checks ran on 2.0.20)
// Everything else is rejected: older v1 lacks the dual plugin entrypoints used
// here, 2.0.19 and below are below the initial v2 installation floor, other
// major versions are unknown configurations, and pre-release versions are not
// silently counted as supported. A version that merely matches a tested host is
// NOT a claim of full release acceptance — only of the installer-level checks
// (role registration, prompt body, effective permissions, install/verify/
// uninstall loop) recorded in INSTALL.md §7.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const V1_MIN = "1.18.29";
export const V1_TESTED = "1.18.33";
export const V2_MIN = "2.0.20";
export const V2_TESTED = "2.0.20";

export function parseVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?/.exec(String(text ?? ""));
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], prerelease: m[4] ?? null, raw: m[0] };
}

function compare(a, b) {
  for (const k of ["major", "minor", "patch"]) {
    if ((a?.[k] ?? 0) !== (b?.[k] ?? 0)) return (a?.[k] ?? 0) - (b?.[k] ?? 0);
  }
  return 0;
}

function supportedNote(flavor, raw, tested) {
  return raw === tested
    ? `version matches the host on which installer-level runtime checks ran (role registration, prompt body, effective permissions, install/verify/uninstall loop); this is not a claim of full release acceptance`
    : `supported configuration within major ${flavor === "v1" ? 1 : 2}; installer-level runtime checks have only been run on ${tested}`;
}

export function classify(version) {
  const v = parseVersion(version);
  if (!v) return { ok: false, reason: `cannot parse a semver from: ${JSON.stringify(version)}` };
  if (v.prerelease) {
    return {
      ok: false,
      reason: `OpenCode ${v.raw} is a pre-release version; supported means stable releases within v1 (>= ${V1_MIN}) and v2 (>= ${V2_MIN}) — pre-release versions are not silently counted as supported`,
    };
  }
  if (v.major === 2) {
    if (compare(v, parseVersion(V2_MIN)) < 0) {
      return { ok: false, reason: `OpenCode ${v.raw} is below the initial v2 installation floor ${V2_MIN}; use >= ${V2_MIN} or the v1 flavor` };
    }
    return { ok: true, flavor: "v2", version: v.raw, runtimeTested: v.raw === V2_TESTED, note: supportedNote("v2", v.raw, V2_TESTED) };
  }
  if (v.major === 1) {
    if (compare(v, parseVersion(V1_MIN)) < 0) {
      return { ok: false, reason: `OpenCode ${v.raw} is below the supported v1 lower bound ${V1_MIN} (dual plugin entrypoints require >= ${V1_MIN}); upgrade the host or pin an older package` };
    }
    return { ok: true, flavor: "v1", version: v.raw, runtimeTested: v.raw === V1_TESTED, note: supportedNote("v1", v.raw, V1_TESTED) };
  }
  return { ok: false, reason: `unsupported OpenCode major version ${v.major} (supported: v1 >= ${V1_MIN} within major 1, v2 >= ${V2_MIN} within major 2)` };
}

/** Probe one executable: `<exe> --version`, parse, classify. Never throws. */
export async function probeExecutable(executable) {
  let stdout, stderr;
  try {
    ({ stdout, stderr } = await run(executable, ["--version"], { timeout: 30_000, shell: false }));
  } catch (err) {
    return {
      ok: false,
      reason: `cannot run ${JSON.stringify(executable)} --version: ${err.message}`,
      executable,
    };
  }
  const output = `${stdout ?? ""}\n${stderr ?? ""}`;
  const parsed = parseVersion(output);
  const verdict = classify(parsed?.raw ?? output.trim());
  return { ok: verdict.ok, executable, ...verdict };
}
