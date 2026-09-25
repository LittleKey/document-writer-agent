# Install

Manual, adaptive steps only — no installer script exists and none is needed. Every step can be executed by an agent (e.g., the Orchestrator) or by hand. The overlay is **additive**: it defines the two custom agents and removes skills from the Orchestrator — it never switches the preset, replaces models, or overwrites existing skills/MCPs. The repository vendors no Lark skills: the `lark-operator` agent ships capability-less and is populated only from skills independently installed on the target (section 6).

## 1. Verify prerequisites

1. Confirm OpenCode is installed: run `opencode --version` and record the version.
2. Confirm oh-my-opencode-slim is installed and loaded: check the OpenCode `plugin` list for an `oh-my-opencode-slim@...` entry.
3. Record the installed omo-slim version (from its `package.json` in the plugin cache, or the version pinned in `opencode.json`).

Lark integration is optional (section 6): this repo bundles no Lark skills and no lark-cli.

Tested compatibility: oh-my-opencode-slim 2.2.21 with OpenCode 1.18.31. Treat this as a tested baseline only; other versions likely work but are unverified.

## 2. Detect the effective configuration layers

oh-my-opencode-slim resolves its config in layers (verified against the 2.2.21 source). Determine each of the following before writing anything:

1. **Config directories** — the plugin considers two dirs and uses the first one that actually contains a user plugin config: the custom dir `$OPENCODE_CONFIG_DIR` when set and non-empty, and the default dir (`$XDG_CONFIG_HOME/opencode` if `XDG_CONFIG_HOME` is set, else `~/.config/opencode`). A custom dir does not replace the default — when it holds no plugin config, the default dir's is used. Check the shell environment/profile that actually launches OpenCode for both variables.
2. **User plugin config** — within each dir: `oh-my-opencode-slim.jsonc` if it exists, otherwise `oh-my-opencode-slim.json` (`.jsonc` wins when both exist). Across the two dirs, the custom dir is searched first; the first existing config wins.
3. **Project plugin config** — in the target project: `.opencode/oh-my-opencode-slim.jsonc` if it exists, otherwise `.opencode/oh-my-opencode-slim.json`.
4. **Merge order** — user config loads first, then the project config merges over it: project scalar keys (e.g. `preset`) override user values; `agents` and `presets` deep-merge (per-key). Both layers stay active.
5. **Preset selection** — the effective `preset` key (project wins over user) selects a member of `presets`; the environment variable `OH_MY_OPENCODE_SLIM_PRESET` overrides both when set. If the named preset does not exist, omo-slim warns and continues with the plain `agents` — this overlay's agent additions are preset-independent and work in every case.
6. **Prompt search order** (first existing `<file>.md` wins; the project base dir precedes the user config preset dirs, and the two config dirs are searched custom-first; a missing dir or preset subdir is skipped without stopping the search):
   `<project>/.opencode/oh-my-opencode-slim/<active-preset-name>/<file>.md` →
   `<project>/.opencode/oh-my-opencode-slim/<file>.md` →
   `<custom-config-dir>/oh-my-opencode-slim/<active-preset-name>/<file>.md` →
   `<default-config-dir>/oh-my-opencode-slim/<active-preset-name>/<file>.md` →
   `<custom-config-dir>/oh-my-opencode-slim/<file>.md` →
   `<default-config-dir>/oh-my-opencode-slim/<file>.md`.
   `<file>_append.md` files (e.g. `oracle_append.md`) resolve through the same order.
7. **Inline prompt overrides** — an `agents.<name>.prompt` key in any effective layer (user config, project config, or the active preset's member for that agent) replaces the `<name>.md` file prompt entirely; the plugin only logs a warning, and `<name>_append.md` files are still appended. Before copying prompts, list every `prompt` key under `agents` in the merged effective config — including the active preset — and reconcile deliberately; while an unreconciled inline override remains, the copied file is not the effective prompt.

**Rule:** write only into files that are actually loaded, and never write a copy that an existing higher-priority file shadows (nor one that silently shadows an existing override). For each of `document-writer.md`, `lark-operator.md`, `oracle_append.md`, `council_append.md`, and `orchestrator_append.md`, walk the prompt search order above and note the first existing hit — that is where that prompt's effective content lives.

## 3. Record backups and an install record (required before any change)

Before modifying anything, create an install record and backups so uninstall is exactly reversible:

1. Create a record file, e.g. `<project>/.opencode/document-writer-install-record.md`, with one entry per intended change, classified as:
   - **ADD** — a path that does not exist yet and will be created by this install (skills, prompts, project config file).
   - **MODIFY** — a pre-existing file whose content will change (config merges, prompt reconciliation), with the exact keys/regions to be added.
2. For every MODIFY target, save a byte-exact backup before touching it — e.g. under `<project>/.opencode/document-writer-backup/<date>/` (keep it out of version control if `.opencode` is committed; if the target files are already committed to the project's VCS, a clean commit may serve as the backup — record which you chose).
3. Never delete or overwrite a pre-existing file without a recorded backup.
4. After the install (sections 4–6) completes, append the exact installed state to the same record: for every ADD path and MODIFY file, its content hash at installation time (e.g. `sha256sum`), or the precise installation diff for config merges. Uninstall (section 10) compares current content against this recorded installed state — not only against the original backup.

## 4. Install the config (additive merge)

Merge this repo's `oh-my-opencode-slim.json` into the effective config file chosen in step 2. Prefer the project-level file (create `.opencode/oh-my-opencode-slim.json` only if neither project file exists — it is additive and merges over the user config). One rule governs the skill-directive merge below:

- **Honor omo-slim precedence first, then append.** Determine the *effective pre-install winning array* for each directive key (`agents.orchestrator.skills_remove`): the single value that survives the user → project merge and the preset-under-`agents` merge — i.e. the array from the highest-priority layer that defines the key (project over user over the preset member). Never union values from lower-priority arrays that a higher-priority array intentionally replaced — an empty winning array (`[]`) means "no removals" and shadows lower layers exactly as a non-empty one does. Then append only this extension's entries (the 32 removal names) to that winning array and write the result into the appropriate effective target layer: the destination file chosen above, or in place if the winning array already lives there.

Three cases:

- **No destination array in any layer** (key undefined everywhere): create the entry with only the extension entries — e.g. `agents.orchestrator` becomes `{ "skills_remove": [<this repo's 32 names>] }`.
- **Winning empty array** (`[]` from the highest-priority layer): the shadowed lower-priority values stay absent. Append the extension entries to the empty winner, so the result holds only those entries; do not resurrect anything from lower layers.
- **Deliberate replacement** (a higher-priority layer defined the array with content that intentionally differs from lower layers): take the winning array as-is — its contents, plus the extension entries, form the destination array. A value a lower layer removed and a higher layer re-exposed stays re-exposed; one the higher layer dropped stays dropped. Record the winning arrays in the install record, so a later uninstall or audit can tell this extension's entries from the target's own decisions.

Merge rules (applying the rule above):

- **Add** `agents["document-writer"]` and `agents["lark-operator"]` verbatim. These are new agents; if the target somehow defines the same name, reconcile deliberately (keep the target's model/variant; prefer this repo's skills/description/prompts/permission unless there is a deliberate reason not to). `lark-operator` ships with `"skills": []` — capability-less; populate it only through the conditional integration steps in section 6.
- **Orchestrator restrictions:** the destination `agents.orchestrator` entry becomes `{ "skills_remove": [<winning skills_remove entries…>, <this repo's 32 names>] }`; leave inherited `skills` untouched. Explicit `"!"` exclusion tokens in an inherited `skills` list are a separate mechanism and persist untouched; `skills_remove` names become effective exclusions even for `["*"]` lists.
- **Do not** add or change the `preset` key, `presets`, any model/variant fields, MCP lists, or any existing agent's `skills` array. If `OH_MY_OPENCODE_SLIM_PRESET` is set in the launcher environment, record that fact in the install record; no config action is needed.

Manual validation scenario (isolated disposable layers — never the target's live user config):

1. Create two disposable dirs outside the target, e.g. `/tmp/omo-dw-test/config` (scratch config dir) and `/tmp/omo-dw-test/project` (test project). Copy the target's `opencode.json` unchanged into the scratch config dir so the omo-slim plugin loads, then write the test *user layer* `oh-my-opencode-slim.json` there with the shadow directive: `agents.orchestrator.skills_remove: ["reflect"]` — `reflect` is a bundled Orchestrator-granted skill and is not in this extension's 32 removals. In the test project create `.opencode/oh-my-opencode-slim.json` — the higher-priority layer — starting as `{ "agents": { "orchestrator": { "skills_remove": [] } } }`.
2. Perform the install (sections 4–6) against the test project: skills into `<test-project>/.opencode/skill/`, prompts into `<test-project>/.opencode/oh-my-opencode-slim/`, config merged into the test project file per this section.
3. Launch OpenCode from the test project with `OPENCODE_CONFIG_DIR=<scratch config dir>` and `XDG_CONFIG_HOME=<scratch dir>/xdg` (so neither the live user config nor the live default skill dir participates), and open a fresh session. Expected: the winning project array replaces the user-layer test value — `agents.orchestrator.skills_remove` resolves to exactly this repo's 32 names (`reflect` still active for the Orchestrator: the shadowed removal stayed inactive; `humanizer` absent — it is bundled via this repo's skills and in the extension's removal list, so its absence shows the removals applied). An installer that had unioned lower-priority values would show `reflect` excluded from the Orchestrator — a failure.
4. Scope: this validates effective config values as resolved at load and, where safe, agent discovery (the Orchestrator skill list in a fresh session). It uses only bundled skills — no Lark auth and no personal/unavailable skill (e.g. `yogo-products`) is required. Delete both disposable dirs afterwards; the live configuration is untouched throughout.

Models: both custom agents use `"inheritModelFrom": "session"` (supported syntax in omo-slim 2.2.21; enum `session | orchestrator`), so they run on the session's model — no model IDs are pinned. To pin instead, add `model`/`variant` per agent for your provider; variant names (`high`/`xhigh`/`max`/`thinking`) are provider-specific.

## 5. Copy the prompts

Copy `prompts/document-writer.md`, `prompts/lark-operator.md`, `prompts/oracle_append.md`, `prompts/council_append.md`, and `prompts/orchestrator_append.md` into the prompt location determined in step 2:

- If a same-named prompt already exists in a higher-priority search dir, that file is the effective one: reconcile it there (diff, back up per step 3, then apply or keep the existing content deliberately). Do not write a lower-priority copy and assume it takes effect.
- Otherwise write into the project dir `<project>/.opencode/oh-my-opencode-slim/` (project-scoped) or the config dir `<config-dir>/oh-my-opencode-slim/` (global), matching where the target's other prompt overrides live.
- Before claiming activation, confirm per step 2.7 that the effective config holds no unreconciled `agents.<name>.prompt` inline override for `document-writer`, `lark-operator`, `oracle`, `council`, or `orchestrator`. An inline override wins over the copied file; reconcile it first, and do not claim the prompts are active while one remains.

`oracle_append.md` is what enables the Oracle document-review contract: it makes Oracle review dispatched documents for correctness, consistency, feasibility, acceptance fit, and audience fit, bind findings to the inspected revision (or a readable retained snapshot with hash), and answer `PASS | REJECT | BLOCKED` — never a bare narrative verdict, and never publication/execution authorization. `council_append.md` adds evidence-and-disagreement judgment to the Council synthesis agent (judge claims by traceable current-version evidence, attribute reported checks to their seats, retain material dissent; in omo-slim 2.2.21 the append reaches the synthesis agent, not automatically every generated councillor seat); `orchestrator_append.md` adds the document/review gating policy (ordinary document work is accepted after the writer's final full-document self-check — `DONE` excludes independent review and publication; Oracle review when requested or impact-gated) and mixed-task routing guidance (route mixed requests by each part's needs; stage delegation when specialization gains outweigh handoff costs).

## 6. Copy the skills and wire optional integrations

Copy each bundled skill directory under `skills/` into the skill location the target resolves. Project-scoped: `<project>/.opencode/skill/<name>/`. Global: `<config-dir>/skill/<name>/`. Match wherever the target's existing skills already load from.

- The directory name matches the skill's frontmatter `name`.
- Copy whole directories — skills may carry `references/` and `scripts/` linked from SKILL.md.
- If a same-named skill exists, compare and keep one deliberate version; do not mix files from both.
- Bundled inventory (4): `maintaining-product-engineering-docs`, `domain-modeling`, `humanizer`, `writing-plans`. Nothing else ships — in particular **no `lark-*` skills**.

### 6.1 Conditional Lark integration

1. **Detect whether Lark integration is requested** (by the user/dispatch). If not, skip this subsection: `lark-operator` remains installed but capability-less (empty grants), which is harmless.
2. If requested, **install or update `lark-cli` by its officially supported method** — its own documented installer/updater, never by copying files from this repo — record the method and version in the install record (and the pre-update version when updating an existing install, so the CLI itself can be reversed via its own supported procedure), then fully restart OpenCode (section 7) so its skills are rescanned.
3. **Inventory actually discoverable `lark-*` Skills** in a fresh session, then **vet every discovered skill before granting**: (a) role fit for the destination agent, (b) the skill's stated prerequisite tools/permissions, (c) whether those tools, the CLI, and auth are actually available on the target, and (d) the target's least-privilege boundaries. Grant **only discovered names that pass vetting** to `lark-operator`: write them into the destination layer's `agents["lark-operator"].skills` using the section 4 procedure (append to the effective pre-install winning array — for a fresh install, this overlay's `[]` — and record the grant and the vetting result). Never grant a name that was not discovered on this target, never copy Lark skills from this repo, and never grant a skill that fails vetting — leave it ungranted and record the limitation. Example: `lark-openapi-explorer` requires WebFetch, which `lark-operator` denies; it is never grantable on this agent — leave it ungranted with the limitation recorded, and never widen a permission denial (e.g. flipping `webfetch` to allow) or use a shell bypass to make a skill work.
4. Optional, only when the user explicitly asks for direct Lark document-body editing by the writer: the discovered names matching the maintainer's writer-side grant set — `lark-doc`, `lark-markdown`, `lark-sheets`, `lark-base`, `lark-slides`, `lark-drive`, `lark-wiki`, `lark-whiteboard`, `lark-shared` — may be granted to `document-writer` via the same vetting-and-grant procedure, recorded as separate MODIFY entries. Without this explicit opt-in plus compatible granted skills and permissions, writer-side Lark body editing is unavailable — do not route it through `lark-operator`, which stays forbidden from formal document bodies. With the opt-in, shared-document writes still carry the pre-write gate — user authorization for the exact target/scope plus any required Oracle approval of the current revision, otherwise an authorized draft location only. The writer's result contract applies: every Lark document edit returns `DONE` with the content location plus a retrievable revision (or readable retained snapshot) and hash; post-write Oracle review applies when requested or impact-gated, performed against that exact revision — it never substitutes for the pre-write approval.
5. Authorization is separate from capability: grants make skills *available*; external document reads/writes still require the user-authorized lark-cli setup and the explicit authorization in section 9. Discovery and granting never authorize external access by themselves.

### 6.2 Other cloud-document CLIs

1. **Inventory other installed cloud-document CLIs** and their discoverable skills in the same fresh-session pass used for section 6.1.
2. **Automatically add applicable skills to an appropriate matching agent** — a dedicated/platform operator the target already defines, or the existing agent whose role matches that CLI — after applying the same per-skill vetting as section 6.1 (role fit, stated prerequisites, available CLI/auth, least-privilege boundaries). Grant only skills that pass; leave the rest ungranted with the limitation recorded, and never widen a permission denial or use a shell bypass. Use the section 4 precedence-safe, reversible grant procedure and record each grant with its vetting result. Do **not** grant non-Lark skills to `lark-operator` merely because they are document-related; preserve least privilege per agent role.
3. The same capability/authorization split applies: automatic detection and addition wire up local capability only; every external document read/write still requires explicit user authorization for that operation.

### 6.3 Reconcile Orchestrator exclusions dynamically

1. Collect **all discovered platform-document skill names** from the section 6.1 and 6.2 inventories — including names that failed vetting or were left ungranted — and subtract the names already in this overlay's static `agents.orchestrator.skills_remove` list.
2. For each remaining discovered name, append it to the effective pre-install winning `agents.orchestrator.skills_remove` array using the section 4 precedence-safe procedure, recorded as separate MODIFY entries. This closes wildcard (`["*"]`) access to newly discovered platform-document skills that the static list predates; excluding a name from the Orchestrator never affects any other agent's explicit grants.
3. Every vetting failure, ungranted name, and dynamic exclusion goes into the install record, so uninstall can reverse exactly the appended entries (section 10).

## 7. Restart OpenCode

Fully quit and relaunch OpenCode. Plugin config, prompts, and skill discovery load at startup; a running session will not pick up changes. This restart is also what makes newly installed `lark-cli` skills discoverable for the section 6.1 inventory.

## 8. Verify — local (required; no Lark dependency)

Run in order; stop at the first failure. None of these needs lark-cli, Lark auth, or a Lark resource — and no cloud-document CLI or skill counts toward this verification: the local-only installation state stands on its own.

1. **Agent discovery** — new session, list agents: `document-writer` and `lark-operator` appear with the overlay descriptions, running on the session model (no model errors on a fresh target).
2. **Skill discovery** — for a clean local-only install, document-writer lists exactly `maintaining-product-engineering-docs`, `domain-modeling`, and `humanizer` (the overlay grants only these three). After optional Lark integration (section 6.1 step 4) or target reconciliation, compare against the baseline three **plus the approved additional grants recorded during installation** — approved additions must not fail this check. `writing-plans` is installed as a skill directory but deliberately not granted to the restricted writer agent — verify it is discoverable as an installed skill, without expecting it in document-writer's grant list.
3. **Writer → Oracle review loop** — dispatch a trivial local document edit to `document-writer`, explicitly requesting independent review (review is requested or impact-gated, not automatic — ordinary `DONE` after the writer's full-document self-check excludes independent review). Confirm: (a) it writes and rereads, (b) it returns a result with the content location, a retrievable revision or readable retained snapshot plus its hash, the change summary, and the actual checks it performed on the full document, (c) the parent forwards the content/revision into the Oracle review dispatch, and Oracle answers `PASS`, `REJECT`, or `BLOCKED` with findings bound to that inspected revision, (d) findings return to the same document-writer and the same Oracle rereviews (previous findings plus the full delta).
4. **Blocked check** — dispatch Oracle with a review request that supplies no current content, no retrievable revision, and no authorized readable source: it must answer `BLOCKED` (insufficient evidence) instead of guessing or reconstructing the material. (With an authorized readable local source, Oracle may inspect it itself; missing Lark material is requested through the Orchestrator, not fetched directly.)
5. **Orchestrator restriction spot-check** — confirm the Orchestrator does not list any `lark-*` skill as allowed (meaningful once Lark skills are installed per section 6.1; while none are installed, confirm the `skills_remove` entries are present in the effective config) and still has its unrelated existing skills.
6. **Dynamic exclusion proof** — if the section 6.1/6.2 inventories found any platform-document skill name outside the shipped 32-name list, pick one actually discovered name and prove it is in the effective Orchestrator exclusion set (fresh session: the Orchestrator does not list it, or the effective config resolves it into `skills_remove`). If no such name exists on this target, the shipped names are still proven by item 5, and mark the dynamic portion explicitly **deferred/conditional** in the install record — it is verified the first time section 6 discovers such a name.

## 9. Verify — Lark (conditional; only with explicit authorization)

Skip this section entirely when the target has no lark-cli setup or no user-authorized Lark test resource — the extension remains validly installed per section 8. Only when the user explicitly provides a test resource and authorizes the read:

- Dispatch one harmless read against that exact resource (e.g., its title). Confirm routing to `lark-operator` (Orchestrator must not call `lark-*` skills itself) and locator-bearing results. Requires lark-cli auth on that machine (lark-cli's own skills, e.g. `lark-shared`, cover login). Run only after the section 6.1 integration steps.
- With the section 6.1 step 4 opt-in grants, the writer-side edit check still requires **separate explicit authorization for the exact test edit** — the resource identity, the bounded change, and the preservation requirements. Never edit a test resource based on read authorization or installation opt-in alone: without that separate authorization, perform the read check above only and mark the write verification **deferred** in the install record. With the pre-write authorization in hand (exact target/scope, plus any required Oracle approval of the current revision before the shared write — see section 6.1 step 4): dispatch the authorized bounded edit to `document-writer` (never `lark-operator`); confirm the writer uses its vetted Lark skill, returns a `DONE` result with the content location plus a retrievable revision (or readable retained snapshot) and hash, and — with review additionally requested or impact-gated — the post-write loop closes through Oracle against that exact revision; confirm `lark-operator` still refuses formal-body edits rather than performing them (routing them back to the Orchestrator/`document-writer`).
- Without the opt-in: confirm the Orchestrator routes no formal Lark body edit at all — the capability is unavailable, and `lark-operator` refuses such dispatches rather than performing them.

## 10. Uninstall (reversible)

Work only from the install record — original backups plus the recorded installed state (step 3.4). For every recorded path, compare its current content against the recorded installed state (hash or diff), then act:

**Scope note:** separately managed prerequisites are not reversed by this procedure. `lark-cli` installed or updated per section 6.1, and other cloud-document CLIs per section 6.2, remain after extension uninstall — this uninstall reverses only what sections 4–6 wrote (config keys, prompts, skills, grants, exclusions). To reverse a CLI itself, use its own supported procedure and the pre-update version recorded in the install record; never delete CLI-managed files as part of this uninstall.

1. **Unchanged since install** (current content exactly matches the recorded installed state): whole-path reversal is safe. Delete ADD paths (skill dirs, prompt files, a project config file created by the install); restore MODIFY files whole from the original backup. For config files, alternatively reverse the patch record: remove exactly the keys this install added (`agents["document-writer"]`, `agents["lark-operator"]`, the folded `skills_remove` in `agents.orchestrator`), restoring any pre-existing values — including reversing any conditionally added Lark or other-CLI skill grants and dynamically appended Orchestrator exclusions recorded from sections 6.1–6.3.
2. **Changed since install** (hash or diff differs): never restore or delete wholesale — that would discard post-install changes, which may be unrelated edits made after installation. Reverse only the extension-owned changes surgically: for config files, remove exactly the keys/entries this install added per the patch record, preserving all other content including later edits; for ADD skill/prompt files, stop and hand the path to the human/agent owner for reconciliation instead of deleting.
3. If a recorded path is missing or unreadable, stop and report instead of guessing.

Never delete a pre-existing file, a pre-existing `agents.orchestrator` object, or any content not owned by this install. Confirm the effective config parses and OpenCode restarts cleanly, then remove the backup and record directories — first exporting any still-needed CLI recovery metadata (the pre-update versions recorded per section 6.1, plus any other CLI metadata if recorded) if the CLIs themselves may need to be reversed later.

Keep no installer scripts — there are none in this repo, and none should be created during install.
