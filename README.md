# document-writer

A portable, manually installed extension for any [OpenCode](https://opencode.ai) project that has the [oh-my-opencode-slim](https://www.npmjs.com/package/oh-my-opencode-slim) plugin. It adds a two-agent document workflow with an Oracle evidence-review loop:

- **document-writer** — bounded creation and editing of formal product and engineering documents (PRDs, technical solutions, architecture/interface designs, delivery documents, ADRs). Returns a result with the content location and a retrievable revision (or readable retained snapshot) plus its hash for every substantive edit; a plain `DONE` excludes independent review and publication.
- **lark-operator** — all Feishu/Lark reads and operations except formal document bodies: writer-side Lark body editing happens only in document-writer under explicit user opt-in with compatible granted skills, and is unavailable otherwise — never through lark-operator. Every write or external effect requires explicit user authorization (otherwise `NEEDS_AUTHORIZATION`); Oracle approval applies additionally when requested or for impact-gated categories — security/privacy/permissions, breaking contracts, irreversible/high-loss actions, formal approvals, external legal/commercial/SLA commitments (missing approval → `NEEDS_REVIEW`). Platform or API choice alone does not trigger review. Optional integration: it ships capability-less and is populated only from `lark-*` skills independently installed on the target (none are vendored here).
- **Oracle boundaries** — `prompts/oracle_append.md` makes Oracle review dispatched documents for correctness, consistency, feasibility, acceptance fit, and audience fit, and answer `PASS | REJECT | BLOCKED` with findings bound to the inspected revision. Oracle never issues publication or execution authorization on its own.
- **Council and Orchestrator prompts** — `prompts/council_append.md` adds evidence-and-disagreement judgment to the Council synthesis agent (judge claims by traceable current-version evidence, attribute reported checks to their seats, retain material dissent; in omo-slim 2.2.21 the append reaches the synthesis agent, not automatically every generated councillor seat); `prompts/orchestrator_append.md` adds the document/review gating policy and mixed-task routing guidance (ordinary document work is accepted after the writer's final full-document self-check — `DONE` excludes independent review and publication; Oracle review is required when requested or for impact-gated categories; route each part of a mixed request by its own needs and stage delegation when specialization gains outweigh handoff costs).

Shared-document writes carry a **pre-write gate**: authorization for the exact target/scope, plus any required Oracle approval of the current revision — without it the writer works only in an authorized draft location. Ordinary document work then completes on the writer's final full-document self-check. When post-write review is requested or impact-gated (security/privacy/permissions, breaking contracts, irreversible/high-loss actions, formal approvals, external legal/commercial/SLA commitments), the loop is: document-writer writes and rereads → Oracle reviews the revision the writer returned → findings return to the same document-writer → the same Oracle rereviews previous findings plus the full delta. Post-write review never substitutes for the pre-write approval gate.

## Additive by design

The config overlay (`oh-my-opencode-slim.json`) touches only the `agents` section and never switches the preset, pins models, or overwrites a target's existing skills or MCPs:

- Both custom agents set `"inheritModelFrom": "session"` (supported in omo-slim 2.2.21), so they run on the session's model on any fresh target.
- Orchestrator restrictions are added via `agents.orchestrator.skills_remove` (the `lark-*` names plus `humanizer`, `use-modern-go`, and `managing-lark-project-folder`), which resolve into effective exclusions even for `["*"]` lists — the Orchestrator cannot invoke Lark skills directly. The removal names are deliberate guardrails: harmless no-ops while the skills are absent, still effective if they are installed later.
- **No Lark skills are vendored.** `lark-operator` ships with `"skills": []`; INSTALL §6.1 populates it only from skills discovered on the target after an official `lark-cli` install/update, and only after per-skill vetting (role fit, stated prerequisites, available CLI/auth, least-privilege boundaries). An incompatible skill such as `lark-openapi-explorer` (needs WebFetch, which `lark-operator` denies) stays ungranted with the limitation recorded; permissions are never widened and no shell bypass is used to make a skill fit. Other installed cloud-document CLIs are inventoried and wired to matching agents by the same vetted, precedence-safe, reversible procedure — never into `lark-operator` by document-topic affinity. Every discovered platform-document skill name outside the overlay's static list is also added to the Orchestrator's `skills_remove` (INSTALL §6.3), closing wildcard access to newly discovered names.

## Layout

```
oh-my-opencode-slim.json   Additive agents-only overlay (no preset, no model IDs, no MCP grants — both agents carry empty `mcps` lists)
prompts/
  document-writer.md       document-writer agent prompt
  lark-operator.md         lark-operator agent prompt
  oracle_append.md         Document-review contract appended to the Oracle role
  council_append.md        Evidence-and-disagreement guidance for the Council synthesis agent
  orchestrator_append.md   Document/review gating + mixed-task routing for the Orchestrator
skills/                    4 complete skill directories copied verbatim; no lark-* skills are vendored
README.md / INSTALL.md / SOURCES.md / .gitignore
```

## Requirements

- OpenCode with the oh-my-opencode-slim plugin installed and loaded.
- Lark features are optional: when requested, install or update `lark-cli` by its official method and grant only the skills it actually exposes (INSTALL §6.1). Local document-writer→Oracle verification works without any cloud-document CLI.

Manual installation only — no installer scripts. [INSTALL.md](INSTALL.md) covers effective-config-layer detection, backup/reversal records, adaptive steps, and split local vs conditional-Lark verification. Every file's origin is recorded in [SOURCES.md](SOURCES.md).

Tested compatibility: oh-my-opencode-slim 2.2.21 on OpenCode 1.18.31. This is a tested baseline, not a hard requirement.
