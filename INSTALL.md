# Install (2.0.0 — dual-host installer)

The repository ships `bin/dw-install.mjs`, a host-aware additive installer. One command installs the two role agents and the four bundled skills into an OpenCode project on either host flavor, records a machine-readable manifest, and reverses its own writes — `uninstall` reverses managed content while intentionally preserving everything else, and `rollback` restores the recorded pre-install bytes of backed-up content; neither is an exact whole-filesystem reversal (§4). It never switches the preset, pins models, overwrites unrelated configuration, or writes through hard links.

Supported hosts, by what was actually run — keep the records distinct:

| Host flavor | Supported | Installer-level runtime checks ran on | Notes |
| --- | --- | --- | --- |
| v1 | stable OpenCode ≥ 1.18.29 within major 1 | 1.18.33 | dual plugin entrypoints require ≥ 1.18.29; older v1 is rejected |
| v2 | stable OpenCode ≥ 2.0.20 within major 2 | 2.0.20 | 2.0.19 and below sit below the initial v2 installation floor; other stable ≥ 2.0.20 versions are a supported configuration whose installer-level runtime checks have not been run here |

Unknown major versions and pre-release versions are rejected outright and never silently counted as supported. A version that merely matches the "ran on" column is evidence of installer-level checks only (role registration, prompt body, effective permissions, install/verify/uninstall loop — §7); it is **not** a claim of full release acceptance.

- Historical end-to-end baseline: oh-my-opencode-slim **2.2.21** on OpenCode **1.18.31** (full manual e2e run at that time).
- Portable load test (2026-09-30): oh-my-opencode-slim **2.2.25** / OpenCode **1.18.33**, overlay loaded in a fresh configuration with zero model calls (`/tmp/opencode/orchestration-refresh/live/portable-final/PASS.json`; overlay SHA-256 `bb1ab25827469fc6e6963b2219f69a69da24ad1f6fa63d56496d02e30d19ce08`). That was the pre-installer overlay; not a full install–uninstall exercise.
- Installer-level runtime checks for this installer (2026-09-30): see §7.

## 1. What the installer writes

For host flavor **v1** (agent dir `.opencode/agent/`, skill dir `.opencode/skill/`) or **v2** (`.opencode/agents/`, `.opencode/skills/`):

1. **Role agents** — `document-writer.md` and `lark-operator.md` as host-native agent files. The body after frontmatter is byte-identical to `prompts/document-writer.md` / `prompts/lark-operator.md` (prompt authority; the renderer owns frontmatter). Permissions are rendered in each host's native vocabulary, validated on the installer-level runtime-tested hosts:
   - v1: grouped frontmatter `permission:` map (`bash`, `task`, `edit`, …).
   - v2: ordered `permissions:` array of `{action, resource, effect}` with the 2.0 action names (`task`→`subagent`, `bash`→`shell`; `read`/`edit`/`write`/`glob`/`grep`/`question`/`webfetch`/`websearch` pass through; MCP tools assert as `<server>_<tool>` patterns).
   - document-writer denies delegation, question, webfetch, websearch, and research MCP tools; lark-operator allows read/glob/grep/webfetch/shell and denies edit, write, delegation, question, websearch, patch tools, and research MCP tools.
2. **Skills** — the four bundled directories (`maintaining-product-engineering-docs`, `domain-modeling`, `writing-plans`, `humanizer`) copied byte-for-byte into the host-native skill dir. **No `lark-*` skills and no private skills are vendored**; personal model pins and the personal Orchestrator exclusion guardrails are not carried (they live in the owner's dotfiles configuration).
3. **OMO overlay** — `.opencode/oh-my-opencode-slim.json`, additive: the installer manages exactly `agents["document-writer"]` and `agents["lark-operator"]` (OMO-schema vocabulary — `inheritModelFrom: "session"`, skill grants, `orchestratorPrompt` dispatch rules, `permission` map — translated by the plugin per host). Every other **semantic value** of target-managed config is preserved through a structured merge: unknown top-level keys, other agents, presets, and unknown keys inside the two managed entries. The merged overlay is re-serialized (2-space JSON with a trailing newline), so the original byte layout is **not** preserved — only non-overlay files are byte-exact. The overlay carries no `prompt`/system text and no OMO prompt-dir copies are written, so each role's effective prompt is the native agent file (observed on both installer-level runtime-tested hosts **without the OMO plugin loaded**: v1 1.18.33 `debug agent <name>` shows the body as `prompt`; v2 2.0.20 `/api/agent` shows it as `system`; combined native+OMO precedence was not established by these checks).
4. **Manifest** — `.opencode/document-writer-install.json` (schemaVersion 1): package baseline, host flavor + detected version, per-file actions with installed SHA-256s, overlay action + backup pointer, prompt-authority paths, skill list. Consumed by `uninstall`, `rollback`, and `verify`.

The four `prompts/*_append.md` files (oracle/council/orchestrator/fixer contracts — including the 1+2 review budget and the verbatim-handoff rule) are **OMO plugin-layer assets, not installer artifacts**. They are not written by `dw-install`; a target that runs the OMO integration deploys them through that integration's own mechanism.

## 2. Usage

```sh
node bin/dw-install.mjs install                      # auto-detect host from `opencode --version`
node bin/dw-install.mjs install --host v2 --target ~/proj --opencode /path/to/opencode2
node bin/dw-install.mjs plan      [...]              # dry run — prints the artifact plan, writes nothing
node bin/dw-install.mjs verify    --target ~/proj    # manifest vs disk hashes → ok | drift | missing
node bin/dw-install.mjs uninstall --target ~/proj    # reverse everything the install wrote
node bin/dw-install.mjs rollback  --target ~/proj    # restore the exact pre-install state from backups
```

Flags: `--host v1|v2` (skip detection), `--opencode <exe>` (detection executable, default `opencode` on PATH), `--target <dir>` (default cwd), `--force`, `--json`. Exit codes: `0` ok · `1` usage · `2` conflict (nothing written) · `3` host detection failure · `4` no manifest (uninstall/rollback without an install).

Detection parses `semver` from `<exe> --version` (stdout+stderr). Requires Node ≥ 20.

## 3. Conflict and safety rules

- **Nothing is written unless the whole plan is conflict-free.** Any conflict aborts with exit 2 before the first write.
- **Conflicts** (exit 2): an unmanaged file exists at a managed path (`agent/`/`agents/<role>.md`, skill dirs); a project `oh-my-opencode-slim.jsonc` exists (it shadows `.json` in the plugin's resolution, so an additive `.json` install would be inert — merge the fragment into the `.jsonc` manually); the existing overlay already defines a managed agent key; the overlay path is a symlink; the manifest pins a different host flavor than requested.
- **`--force`** takes over conflicting content only after recording byte-exact backups under `.opencode/document-writer-backup/<stamp>/`. Symlinks at managed paths are never replaced — they stay conflicts even with `--force` (link boundaries stay with the owner).
- **Hard-link write-through is impossible by construction**: every write is computed in full, written to a same-directory temp file, and committed with `rename()`, which swaps the directory entry to a fresh inode instead of writing through an existing link (the owner's deployment hard-links global and dotfiles copies of `opencode.json`/`oh-my-opencode-slim.json`). The consequence is intentional: external twins keep their original bytes and inode — never corrupted — while the managed path moves to a fresh inode, breaking the link relationship. The installer safely edits around existing hard links; it does **not** re-create or restore inode relationships (§4). Covered by dedicated regression tests.
- **Drift**: if a managed file changed since install, reinstall aborts (exit 2) without touching it; with `--force` the drifted content is backed up byte-exact and replaced. `verify` reports any drift.

## 4. Reversal

Neither command is an exact whole-filesystem reversal of the install — that is intentional.

- `uninstall` removes only the managed content: the two role files, the four skill dirs (only if unmodified), the two overlay agent entries (empty `agents` collapses), and the manifest. Created skill dirs that become empty are pruned; non-managed values are intentionally preserved — e.g. a created overlay keeps its `$schema` as a lazy file once the managed agents are removed, and an emptied role-agent directory is left in place. Files the owner changed after install are **kept** and reported; the manifest is retained with a pending-reconciliation record until they are removed. `replace` backups taken by `--force` are restored.
- `rollback` restores the recorded pre-install bytes of everything the install backed up (overlay included) and deletes created files; it is blocked (reported, nothing done) for paths that are symlinks or drifted. It restores **bytes, not inode/link topology**: a hard-linked file that was merged comes back with the original bytes on a fresh inode while external twins keep their own untouched copies — the link relationship is not re-created. Rollback covers handled failures during the install run; crash/power-loss recovery is not tested and not claimed.

## 5. Effective-source and OMO-layer notes

Still true and worth checking on any target before installing (the installer refuses most dangerous cases; these concern the *plugin* layer):

1. The plugin resolves user config from `$OPENCODE_CONFIG_DIR` if set, else `~/.config/opencode`; within a dir `.jsonc` wins over `.json`. Project config (`.opencode/oh-my-opencode-slim.json{,c}`) merges over the user layer per-key.
2. A native agent definition (host or project `.opencode` `agent/`/`agents/` file, or the config's native `agent` key) covers its fields for that name regardless of plugin-layer files. This precedence statement describes each source's design; the §7 runtime checks observed the native files registering correctly **without the OMO plugin loaded**, so they do not by themselves prove combined native+OMO precedence — that combined runtime validation is tracked separately by the owner. This installer *writes* native definitions — on a target that already defines `document-writer`/`lark-operator` natively, that file is a conflict, not a shadowed copy; reconcile deliberately (the owner's file is backed up under `--force`).
3. Both agents use `"inheritModelFrom": "session"` (supported in the omo-slim 2.2.x and 3.0.1 sources): they run on the session's model; no model IDs are pinned.
4. `OH_MY_OPENCODE_SLIM_PRESET` and preset selection are untouched; the managed agent entries merge over preset members per-key.

## 6. Optional Lark integration (manual, after install)

The package vendors no Lark skills; `lark-operator` installs capability-less (`"skills": []`) — harmless without integration. When integration is requested: install or update `lark-cli` by its own official method; inventory actually discoverable `lark-*` skills in a fresh session; grant only skills that pass vetting (role fit, stated prerequisites, available CLI/auth, least-privilege boundaries) by appending names to the winning `agents["lark-operator"].skills` array in the appropriate layer, recorded for later reversal. Never widen a permission beyond the prompt's stated boundary (WebFetch = official Feishu/Lark API documentation only), never use a shell bypass. Writer-side Lark body editing stays in document-writer and only under explicit user opt-in plus the pre-write gate. Every external operation still requires user authorization — grants wire capability, not consent.

## 7. Verification — what was actually run (2026-09-30)

Distinguish fixture-unit evidence from real-host evidence:

- **Fixture suite** (`node --test`, 32 tests, isolated temp targets): additivity, idempotent reinstall, conflict aborts with zero writes, `--force` takeover with byte-exact backups, rollback recorded-byte restoration, uninstall reconciliation rules, cross-flavor manifest pinning, `.jsonc` shadow, drift handling, hard-link write-through protection (fixture twins), symlink conflicts, CLI exit codes/`--json`, merge semantics, version-boundary classification, rejected-version matrix (below the v2 floor, unknown majors, pre-releases), and explicit-host probing (`--host` + `--opencode` mismatch and nonzero-exit rejection; `--host` alone reported as version-not-verified offline format generation).
- **Live v1 1.18.33** (`DW_V1_BIN=$(which opencode) node --test`): both agents register (`debug agent <name>`), mode `subagent`, prompt body byte-identical to the source prompt, and the effective permission array shows the rendered map (`task: deny`, `webfetch: deny` for document-writer; `bash: allow`, `edit/write: deny`, `webfetch: allow`, `websearch: deny` for lark-operator).
- **Live v2 2.0.20** (isolated `DW_V2_BIN=… node --test`): the real 2.0.20 host served in a fully isolated environment (own HOME/XDG/DB/plugin-cache; **zero model requests**; production untouched; **no OMO plugin installed**). `GET /api/agent` after session hydration: exactly **one** registration per role in that environment (no duplicate; since the plugin layer was not loaded there, this does not establish combined native+OMO precedence — owner-validated separately), `system` is the verbatim prompt body, and the effective `permissions` array carries the rendered v2 vocabulary (document-writer: `subagent`/`question`/`webfetch`/`websearch`/`gh_grep_*`/`context7_*` deny; lark-operator: `read`/`glob`/`grep`/`webfetch`/`shell` allow, `edit`/`write`/`subagent`/`question`/`websearch`/`apply_patch`/`ast_grep_replace` deny).
- Known environment limit: the v2 CLI subcommand `debug agents` does not terminate in this sandbox (hangs with no output even outside an install), so the v2 live check drives the host server API instead — the same registration path the TUI uses.

Run the same acceptance on your own target and record it here. `uninstall` then `verify` (expect exit 4: no manifest) closes the loop on a disposable target.

## 8. Requirements

- Stable OpenCode v1 ≥ 1.18.29 within major 1, or v2 ≥ 2.0.20 within major 2 (see table above; unknown majors and pre-releases are rejected) with the oh-my-opencode-slim plugin installed and loaded for the OMO overlay to take effect; the native role agents and skills register with the host alone.
- Node ≥ 20 for the installer. Lark features are optional (§6).
