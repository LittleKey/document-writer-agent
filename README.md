# document-writer

A portable, manually installed extension for any [OpenCode](https://opencode.ai) project that has the [oh-my-opencode-slim](https://www.npmjs.com/package/oh-my-opencode-slim) plugin. It adds a two-agent document workflow with an Oracle evidence-review loop:

- **document-writer** — bounded creation and editing of formal product and engineering documents (PRDs, technical solutions, architecture/interface designs, delivery documents, ADRs). Returns an `ORACLE_REVIEW_EVIDENCE` manifest for every substantive edit; never issues the final delivery verdict.
- **lark-operator** — all Feishu/Lark reads and operations except formal document bodies: writer-side Lark body editing happens only in document-writer under explicit user opt-in with compatible granted skills, and is unavailable otherwise — never through lark-operator. High-risk or external actions require explicit user authorization plus Oracle review. Optional integration: it ships capability-less and is populated only from `lark-*` skills independently installed on the target (none are vendored here).
- **Oracle boundaries** — `prompts/oracle_append.md` gives Oracle fail-closed document-review boundaries and makes it load the `document-review-evidence` skill, which validates supplied evidence and issues `ready | blocked | insufficient-evidence` verdicts. Oracle never fetches evidence and never authorizes publication.

The review loop is: document-writer writes and rereads → Oracle reviews the supplied evidence snapshot → findings return to the same document-writer → the same Oracle rereviews before completion.

## Additive by design

The config overlay (`oh-my-opencode-slim.json`) touches only the `agents` section and never switches the preset, pins models, or overwrites a target's existing skills or MCPs:

- Both custom agents set `"inheritModelFrom": "session"` (supported in omo-slim 2.2.21), so they run on the session's model on any fresh target.
- Oracle's grant is added via `agents.oracle.skills_add: ["document-review-evidence"]` — folded into whatever skill list the active preset resolves, with no preset switch.
- Orchestrator restrictions are added via `agents.orchestrator.skills_remove` (all `lark-*` names plus `document-review-evidence`), which resolve into effective exclusions even for `["*"]` lists — the Orchestrator cannot invoke Lark skills directly or review evidence itself. The `lark-*` removal names are deliberate guardrails: harmless no-ops while the skills are absent, still effective if they are installed later.
- **No Lark skills are vendored.** `lark-operator` ships with `"skills": []`; INSTALL §6.1 populates it only from skills discovered on the target after an official `lark-cli` install/update, and only after per-skill vetting (role fit, stated prerequisites, available CLI/auth, least-privilege boundaries). An incompatible skill such as `lark-openapi-explorer` (needs WebFetch, which `lark-operator` denies) stays ungranted with the limitation recorded; permissions are never widened and no shell bypass is used to make a skill fit. Other installed cloud-document CLIs are inventoried and wired to matching agents by the same vetted, precedence-safe, reversible procedure — never into `lark-operator` by document-topic affinity. Every discovered platform-document skill name outside the overlay's static list is also added to the Orchestrator's `skills_remove` (INSTALL §6.3), closing wildcard access to newly discovered names.

## Layout

```
oh-my-opencode-slim.json   Additive agents-only overlay (no preset, no model IDs, no MCPs)
prompts/
  document-writer.md       document-writer agent prompt
  lark-operator.md         lark-operator agent prompt
  oracle_append.md         Boundaries appended to the Oracle role
skills/                    4 complete skill directories copied verbatim; no lark-* skills are vendored
README.md / INSTALL.md / SOURCES.md / .gitignore
```

## Requirements

- OpenCode with the oh-my-opencode-slim plugin installed and loaded.
- Lark features are optional: when requested, install or update `lark-cli` by its official method and grant only the skills it actually exposes (INSTALL §6.1). Local document-writer→Oracle verification works without any cloud-document CLI.

Manual installation only — no installer scripts. [INSTALL.md](INSTALL.md) covers effective-config-layer detection, backup/reversal records, adaptive steps, and split local vs conditional-Lark verification. Every file's origin is recorded in [SOURCES.md](SOURCES.md).

Tested compatibility: oh-my-opencode-slim 2.2.21 on OpenCode 1.18.31. This is a tested baseline, not a hard requirement.
