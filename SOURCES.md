# Sources

This repository was assembled on 2026-09-19 from the maintainer's live OpenCode configuration, resynced on 2026-09-25 after a live "promptopt" rewrite (prompts, agent descriptions/orchestrator prompts, skill grants; `document-review-evidence` deleted upstream), and resynced on 2026-09-26 after live updates: `document-writer.md` restructured into Shared/WRITE/REVIEW with a full review contract, `oracle_append.md` and `orchestrator_append.md` extended (board review records, SHA-256 binding, rereview dispositions, fresh-session rule, user-facing synthesis), new `fixer_append.md`, and the live config's `document-writer` `description`/`orchestratorPrompt` rewritten. Copied items are byte-identical verbatim copies (`diff -r` verified); generated items are listed with their derivation. Statements about omo-slim behavior were verified against the installed oh-my-opencode-slim **2.2.21** source (`dist/index.js`, `oh-my-opencode-slim.schema.json` in the OpenCode plugin cache).

## Copied verbatim

| Repo path | Source |
|---|---|
| `prompts/document-writer.md` | `~/.config/opencode/oh-my-opencode-slim/document-writer.md` |
| `prompts/lark-operator.md` | `~/.config/opencode/oh-my-opencode-slim/lark-operator.md` |
| `prompts/oracle_append.md` | `~/.config/opencode/oh-my-opencode-slim/oracle_append.md` |
| `prompts/council_append.md` | `~/.config/opencode/oh-my-opencode-slim/council_append.md` |
| `prompts/orchestrator_append.md` | `~/.config/opencode/oh-my-opencode-slim/orchestrator_append.md` |
| `prompts/fixer_append.md` | `~/.config/opencode/oh-my-opencode-slim/fixer_append.md` (new in the 2026-09-26 live setup) |
| `skills/maintaining-product-engineering-docs/` | `~/.agents/skills/maintaining-product-engineering-docs/` |
| `skills/humanizer/` | `~/.agents/skills/humanizer/` |
| `skills/writing-plans/` | `~/.config/opencode/skills/writing-plans/` |
| `skills/domain-modeling/` | `~/.config/opencode/skills/domain-modeling/` |

Note on `humanizer`: identical copies existed in both `~/.agents/skills/` and `~/.config/opencode/skills/` (`diff -rq` verified byte-identical); the `~/.agents/skills/` copy is shipped.

## Generated

| Repo path | Derivation |
|---|---|
| `oh-my-opencode-slim.json` | Additive agents-only overlay derived from `~/.config/opencode/oh-my-opencode-slim.json`. Agent `description`, `orchestratorPrompt`, and `permission` blocks verbatim; see design below. |
| `README.md`, `INSTALL.md`, `SOURCES.md`, `.gitignore` | Written for this repository. |

## Overlay design (all syntax verified against omo-slim 2.2.21 source)

- **`inheritModelFrom: "session"`** on both custom agents — enum `session | orchestrator` per the 2.2.21 schema; the resolver deletes the agent's model so it inherits the session/primary model (`dist/index.js` model-inheritance code). No model IDs are pinned; a fresh target instantiates the agents without model errors.
- **No `agents.oracle` override** — the live 2026-09-25 config drops it: the `document-review-evidence` skill was deleted upstream and the new `oracle_append.md` carries the review contract (PASS/REJECT/BLOCKED verdicts bound to the inspected revision) directly, so no Oracle skill grant is needed. Any agent override carrying `skills_add`/`skills_remove` is folded at config load: the resolver computes effective `skills` from that entry's own `skills`/`skills_add`/`skills_remove` (removals and explicit `"!"` exclusions win; additions filtered by both).
- **`agents.orchestrator.skills_remove: [32 names]`** — same fold-in; removals become effective exclusions even when the base list is `["*"]` (each removed name gains a `!name` token). This mirrors the live setup's orchestrator exclusions (no direct `lark-*` use; plus `humanizer`, `use-modern-go`, `lark-worklog`, `managing-lark-project-folder`) additively, without touching the target's existing lists — the live preset expresses the same exclusions as `"!"` tokens inside its `skills` array; `skills_remove` is the preset-independent equivalent. The `lark-*` names are retained deliberately: as removals they are harmless no-ops while those skills are absent and remain guardrails if they are installed later. INSTALL §6.3 extends this list dynamically with discovered platform-document skill names outside it, using the same precedence-safe winning-array procedure.
- **Layer array semantics** — config layers merge with wholesale array replacement (`skills`, `skills_add`, `skills_remove` never concatenate across user→project or preset→`agents`): the effective value of each directive key is the highest-priority layer's array, and an empty array shadows lower layers like any other value. INSTALL §4 therefore appends only the extension's entries to the effective pre-install winning array and never unions shadowed lower-priority values; `skills_add` cannot re-enable a skill excluded via `"!"` tokens or `skills_remove`.
- **`agents.document-writer.skills` reduced from live** — the live 2026-09-26 config grants the writer the Lark body-editing set (`lark-doc`, `lark-markdown`, `lark-sheets`, `lark-base`, `lark-slides`, `lark-drive`, `lark-wiki`, `lark-whiteboard`, `lark-shared`) plus `yogo-products`; this overlay keeps only the three bundled grants (`maintaining-product-engineering-docs`, `domain-modeling`, `humanizer`). The Lark set is re-granted on targets only via the explicit opt-in in INSTALL §6.1 step 4; `yogo-products` is excluded by policy.
- **`$schema` stays `@latest`** — the live config pins `oh-my-opencode-slim@2.2.15`'s schema URL; the portable overlay keeps `@latest` because it pins no version-specific features beyond `inheritModelFrom` (verified against 2.2.21).
- **No `preset`/`presets`, no `model`/`variant`, no MCP grants, no `council`** — the live config's preset members, provider model IDs (`openai/*`, `newapi/*`), council endpoints, and MCP grants (`gh_grep`, `context7`) are environment-specific and are excluded; both custom agents carry `"mcps": []`, which grants nothing. Per-agent permission denials for `gh_grep_*`/`context7_*` are preserved verbatim.
- **No `lark-*` skills vendored; `lark-operator` ships `"skills": []`** — its Lark capability is populated on the target only from skills discovered after an official `lark-cli` install/update, each vetted for role fit, stated prerequisites, available CLI/auth, and least-privilege boundaries before granting (INSTALL §6.1). `lark-openapi-explorer` is never grantable to an agent denying WebFetch: it stays ungranted with the limitation recorded, and permissions are never widened or shell-bypassed to make a skill fit (the same vetting governs other cloud-document CLIs, INSTALL §6.2). Formal Lark document-body editing routes to `document-writer` only under explicit user opt-in with compatible granted skills (INSTALL §6.1 step 4, §9); the writer's result contract (content location plus retrievable revision or retained snapshot and hash) applies, with Oracle review when requested or impact-gated; without the opt-in it is unavailable and never routed through `lark-operator`, which remains forbidden from formal document bodies. The formerly vendored `lark-openapi-explorer` copy was removed with the rest of the `lark-*` set.
- **Config-layer facts documented in INSTALL.md**, verified in `dist/index.js`: user plugin config = first existing `oh-my-opencode-slim.jsonc`/`.json` (`.jsonc` preferred within a dir) across the custom dir (`$OPENCODE_CONFIG_DIR`) and the default dir (`$XDG_CONFIG_HOME/opencode` else `~/.config/opencode`), searched custom-first — a custom dir with no plugin config falls through to the default dir; project config at `.opencode/oh-my-opencode-slim[.jsonc|.json]` merges over user (scalars override, `agents`/`presets` deep-merge); `OH_MY_OPENCODE_SLIM_PRESET` overrides the `preset` key; prompts resolve first-match-winner in the order project preset-dir → project base dir → custom-dir preset-dir → default-dir preset-dir → custom-dir base dir → default-dir base dir, and `agents.<name>.prompt` inline keys override the `<name>.md` file prompt (warning only; `<name>_append.md` still appended).

## Not vendored

No `lark-*` skill ships in this repository (24 directories removed by scope decision); see INSTALL §6.1 for the conditional integration path. `document-review-evidence` was vendored until the 2026-09-25 resync and is now gone — it was deleted from the live setup and nothing references it anymore. Four further skills referenced by the source setup have no copy here at all: `yogo-products` (excluded by policy; no local source found), `designing-work-loops`, `lark-worklog`, `managing-lark-project-folder` (no local source found). None is required — the local-only installation state needs none of them.

## Known non-portable content

- `skills/maintaining-product-engineering-docs/references/design-rationale.md` records the maintainer's original install path (`/home/littlekey/...`) as an installation note. Informational only; portable targets use their own skill location.

## Tested compatibility

- oh-my-opencode-slim **2.2.21** (installed via `oh-my-opencode-slim@latest`)
- OpenCode **1.18.31**

Recorded as a tested baseline, not a requirement.

## Excluded by policy

Personal skills not required by the two agents or the Oracle loop (paseo-\*, use-modern-go, simplify, find-code-simplifications, and the rest of `~/.config/opencode/skills/`), all `lark-*` skills (de-vendored by scope; see "Not vendored" above), user/project configs, model/provider endpoints, and caches. No credentials are embedded; the skill set was scanned for secrets and user-identifying content (one informational absolute path noted above).
