# TASK-020 — Architecture Spike: Packaging the Framework as a Claude Code Plugin (with an MCP seam for later broadening)

## Executive summary

The framework should ship as a **Claude Code plugin** named `hivemind`, distributed via a git-hosted **marketplace** (`.claude-plugin/marketplace.json`) and installed with `/plugin install hivemind@<marketplace>`. The plugin bundles the four subagents (`agents/`), the five existing skills (`skills/`), the CLI entrypoints (`bin/`), the engine modules (`src/`), and a future MCP server (`.mcp.json`). The retargeting problem has a clean answer: the plugin code lives in an immutable cache directory, and **all writes to the user's project must resolve against `${CLAUDE_PROJECT_DIR}`** (the project root Claude Code was launched in), not `process.cwd()` of the plugin's own location and not `import.meta.url`-relative paths. Nearly every `src/` function already takes `repoRoot` as a parameter — the work is confined to the three `bin/` shells (which currently bind `process.cwd()`) and two module-level asset loads (`task-store.js`, `project-md.js`) that read framework-shipped schemas relative to their own file location (those stay valid — the schemas ship inside the plugin). The orchestrator (`CLAUDE.md` RESUME FIRST + First-chat routing) is the one piece that **cannot** ship as-is, because a **plugin-root `CLAUDE.md` is explicitly NOT loaded as project context** (confirmed in the plugins-reference). The recommended activation path is a **bootstrap slash command (`/hivemind:init-project`) that generates a project-level `CLAUDE.md`** (or appends a routing block when one already exists), backed by a thin always-on routing skill. The MCP seam is scoped to the **task store** (`list_ready`, `get_task`, `create_task`, `transition_status`, `append_comment`, `list_todos`) so a non-Claude-Code client can read and mutate tickets — but it will **not** get the orchestrator/subagent loop, which is Claude Code-exclusive. The implementation chain is **7 tickets** (scaffold → retarget → runtime-deps → init-command → orchestrator-activation → MCP-server → E2E+docs). No new tech stack warrants a `.claude/skills/<stack>/` skill.

---

## A. Plugin manifest + layout (AC1)

### A.1 The decision: plugin, not MCP-only

Confirmed against the live docs (cited below): the Agent-tool subagent orchestration — the orchestrator spawning `developer`/`reviewer`/`researcher` in fresh contexts — is a **file-based `.claude/agents/` construct exclusive to Claude Code**. MCP servers expose tools/resources/prompts and cannot install or activate subagents. A plugin is the only vehicle that carries agents + skills + commands + (optionally) an MCP server as one installable unit. ([plugins.md](https://code.claude.com/docs/en/plugins.md), [plugins-reference §Agents](https://code.claude.com/docs/en/plugins-reference), [sub-agents.md](https://code.claude.com/docs/en/sub-agents.md))

### A.2 `.claude-plugin/plugin.json`

Per the [plugins-reference manifest schema](https://code.claude.com/docs/en/plugins-reference#plugin-manifest-schema): `name` is the only required field; the manifest is itself optional (components auto-discover in default locations), but we want one for metadata and to be explicit about the bundled MCP server. Field-by-field, the proposed manifest:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json",
  "name": "hivemind",
  "displayName": "Agentic Software Development Framework",
  "version": "0.1.0",
  "description": "Multi-agent orchestrated dev loop: intake wizard, seeded backlog, orchestrator + developer/reviewer/researcher subagents, portable session state.",
  "author": { "name": "Rafael Matovelle" },
  "license": "MIT",
  "keywords": ["orchestration", "subagents", "workflow", "tasks", "tdd"],
  "mcpServers": "./.mcp.json"
}
```

Field notes (all verified against the reference):

- `name` — **required**, kebab-case, no spaces. Also the **namespace prefix**: skills become `/hivemind:<skill>`, agents appear as `hivemind:<agent>`. This is public-facing (`/plugin install hivemind@<marketplace>`).
- `displayName` — optional, may contain spaces; requires Claude Code v2.1.143+. Falls back to `name`. **Uncertain/version-gated** — include but treat as cosmetic.
- `version` — optional but **recommended to set explicitly** for a published plugin, because if omitted the git commit SHA is used and *every commit* counts as a new version. Trade-off documented in the reference: set it and you must bump it on every release; omit it for fast internal iteration. Recommendation: set `version` once we publish; leave unset (commit-SHA versioning) during the impl chain's active development.
- `author`, `license`, `keywords`, `description` — optional metadata.
- `mcpServers: "./.mcp.json"` — optional path override pointing at the bundled MCP config. We could omit this and rely on the default `.mcp.json` auto-discovery at the plugin root; listing it explicitly is clearer and is a no-op duplicate only if the file is also at the default location (the reference says listing the default path explicitly suppresses the "ignored folder" warning).
- We deliberately do **not** set `agents`, `skills`, or `commands` path overrides — the default `agents/`, `skills/`, `commands/` directories at the plugin root auto-discover. Note from the reference: `agents`/`commands` overrides *replace* the default dir, while `skills` *adds to* it. Relying on defaults avoids that footgun.

### A.3 `.claude-plugin/marketplace.json`

A marketplace is a separate catalog file. For a single-repo distribution where the marketplace and the plugin live in the same git repo, use a relative-path source. Per [plugin-marketplaces §schema](https://code.claude.com/docs/en/plugin-marketplaces):

```json
{
  "$schema": "https://json.schemastore.org/claude-code-marketplace.json",
  "name": "hivemind-marketplace",
  "owner": { "name": "Rafael Matovelle", "email": "srparca@gmail.com" },
  "description": "Distribution marketplace for the Agentic Software Development Framework.",
  "plugins": [
    {
      "name": "hivemind",
      "source": "./",
      "description": "Multi-agent orchestrated development loop as a Claude Code plugin.",
      "version": "0.1.0"
    }
  ]
}
```

Field notes:

- `name` (**required**), `owner` (**required**, `owner.name` required / `owner.email` optional), `plugins[]` (**required**). Each plugin entry needs `name` + `source` at minimum.
- `source: "./"` — **relative path**, must start with `./`, resolved relative to the **marketplace root** (the repo root), not the `.claude-plugin/` dir. `"./"` means "the plugin is at the repo root" — i.e. `plugin.json` lives at `<repo>/.claude-plugin/plugin.json` and `marketplace.json` lives at the same `<repo>/.claude-plugin/marketplace.json`. **This co-location of both manifests in one `.claude-plugin/` dir is valid** and is the simplest single-plugin layout.
- Alternative source forms available if we later split the repo: `{ "source": "github", "repo": "owner/hivemind" }`, `url`, `git-subdir`, `npm`. Documented but not needed for v1.
- **Reserved-name caution:** the docs publish a reserved-marketplace-name list; `hivemind-marketplace` is not on it, but avoid anything resembling `claude-*`/`anthropic-*`.

User-facing install sequence:

```
/plugin marketplace add <git-url-or-./local-path>
/plugin install hivemind@hivemind-marketplace
```

### A.4 Full plugin directory tree

The **hard rule** from the docs: only `plugin.json` (and `marketplace.json` for the same-repo case) go inside `.claude-plugin/`. **Every other component dir must be at the plugin root.** A plugin-root `CLAUDE.md` is *not* loaded as context (this drives §C).

```
hivemind/                         ← plugin root == repo root == marketplace root
├── .claude-plugin/
│   ├── plugin.json                         ← manifest (A.2)
│   └── marketplace.json                    ← catalog (A.3); same-repo single-plugin layout
├── agents/                                 ← MOVED from .claude/agents/ (see note)
│   ├── orchestrator.md
│   ├── developer.md
│   ├── reviewer.md
│   └── researcher.md
├── skills/                                 ← MOVED from .claude/skills/
│   └── tech-training-template/SKILL.md     ← (+ any researcher-authored skills)
├── commands/                               ← NEW (slash commands; see §C, §D)
│   └── init-project.md                     ← /hivemind:init-project bootstrap
├── bin/                                    ← on Bash-tool PATH while plugin enabled
│   ├── init.js
│   ├── new-task.js
│   └── make-template.js
├── src/                                    ← engine modules (lifecycle, task-store, …)
│   └── *.js
├── tasks/
│   └── schema.json                         ← framework-shipped asset (read by task-store.js)
├── state/
│   └── PROJECT.schema.json                 ← framework-shipped asset (read by project-md.js)
├── knowledge/                              ← seed KB entries (copied into user project on init)
├── .mcp.json                               ← NEW (MCP task-store server; §E)
├── package.json                            ← ajv/ajv-formats must move to "dependencies" (§B)
├── CLAUDE.md                               ← present in repo but NOT loaded as context when installed
├── LICENSE
└── CHANGELOG.md
```

**Critical layout note — `agents/` and `skills/` relocation.** Today the agents and skills live under `.claude/agents/` and `.claude/skills/`. The plugin loader expects them at the **plugin root** (`agents/`, `skills/`), NOT under `.claude/`. The `.claude/` convention is for *standalone* per-project config; the plugin convention drops the `.claude/` prefix. So the scaffold ticket must place agent/skill files at the plugin root. (See the "Convert existing configurations to plugins" migration table in plugins.md: `.claude/commands/` → `plugin-name/commands/`.)

**`tasks/schema.json` and `state/PROJECT.schema.json` stay inside the plugin** — they are framework assets read by `src/task-store.js` (line ~52) and `src/project-md.js` (line ~57) via `import.meta.url`-relative resolution. Because they ship inside the plugin and are read (not written), that resolution remains correct after install (the plugin dir is copied wholesale into the cache; intra-plugin relative reads work; only `../`-outside-plugin traversal is blocked). These are NOT the user's task store — see §B for where the *user's* `tasks/` and `state/` live.

---

## B. repoRoot retargeting strategy (AC2 — the meatiest section)

### B.1 The core problem, restated

When installed, the plugin's code lives in an **immutable cache directory** (`~/.claude/plugins/cache/<...>`), copied there at install time. The plugin must operate on the **user's project**, which is wherever the user launched `claude`. Two facts from the docs pin the solution:

1. **`${CLAUDE_PROJECT_DIR}`** = the project root Claude Code was launched in (same value hooks receive as the `CLAUDE_PROJECT_DIR` env var). It is substituted in skill/agent content and exported to hook and MCP/LSP subprocesses. This is the canonical "where is the user's project" handle. ([plugins-reference §Environment variables](https://code.claude.com/docs/en/plugins-reference#environment-variables))
2. **`${CLAUDE_PLUGIN_ROOT}`** = the absolute path to the plugin's *own* install dir (ephemeral; changes on update; do not write state there). Use only to reference bundled scripts/assets.

So the retargeting rule is one sentence: **the framework's `repoRoot` must be bound to `${CLAUDE_PROJECT_DIR}`, never to the plugin's own location.**

### B.2 Audit table — every `src/` + `bin/` location

Legend for "Portable?": **Yes** = already takes `repoRoot` as a param and does all project I/O under it; **Asset** = reads a framework-shipped file relative to its own module location (correct as-is, stays inside the plugin); **No** = binds the project root implicitly and must be retargeted.

| # | Location | Current path assumption | Portable? | Retarget action |
|---|----------|-------------------------|-----------|-----------------|
| 1 | `bin/init.js` (CLI shell, ~L306) | `repoRoot: process.cwd()` | **No** | Bind `repoRoot` to `process.env.CLAUDE_PROJECT_DIR ?? process.cwd()`. `runInit()` itself is already fully `repoRoot`-parameterized — only the shell binding changes. |
| 2 | `bin/new-task.js` (CLI shell, ~L199) | `repoRoot: process.cwd()` | **No** | Same: `CLAUDE_PROJECT_DIR ?? process.cwd()`. `runCli()` is already parameterized. |
| 3 | `bin/make-template.js` (CLI shell, ~L241) | `repoRoot: process.cwd()` | **No** (but see note) | Same fallback. **Note:** make-template is an *upstream template-prep* tool meant to be run on the dev/distribution repo, not on a user's project. It likely should NOT be exposed on the user's PATH at all. Recommendation: keep `make-template.js` out of the shipped `bin/` (it's a publish-time dev script), or guard it behind a `--yes` + explicit-path check. Flagged as an open question (§I). |
| 4 | `src/lifecycle.js` (all of `startSession`/`pause`/`resume`/`end`/`resumeFromPointer`) | Takes `repoRoot`; all bundle paths via `bundleDirFor(repoRoot, …)` | **Yes** | None. Fully portable. |
| 5 | `src/bundle.js` (path helpers, manifest/log IO) | All helpers take `repoRoot` and `join(repoRoot, 'state', 'sessions', …)` | **Yes** | None. |
| 6 | `src/pointer.js` (`readPointer`/`writePointer`) | `pointerFilePath(repoRoot) = join(repoRoot,'state','session.json')` | **Yes** | None. |
| 7 | `src/task-store.js` — **project I/O** (`createTask`/`transitionStatus`/`appendComment`/`listTodos`/`listReady`/`sweepTasksTmpFiles`) | All take `repoRoot`; `tasksDir(repoRoot)` | **Yes** | None for the project-I/O paths. |
| 8 | `src/task-store.js` — **schema asset load** (~L51–53) | `__schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'tasks', 'schema.json')` | **Asset** | None *functionally* — `tasks/schema.json` ships inside the plugin, so the `../tasks/schema.json` relative read resolves within the plugin cache dir (intra-plugin relative reads are preserved; only outside-plugin `../` traversal is blocked). **Verify** the `src/ → ../tasks/` hop stays inside the plugin root after packaging (it does, given the §A.4 tree). |
| 9 | `src/project-md.js` — **schema asset load** (~L56–57) | `__schemaPath = join(__thisFileDir, '..', 'state', 'PROJECT.schema.json')` | **Asset** | Same as #8: `state/PROJECT.schema.json` ships inside the plugin; relative read is fine. The *failure mode is already graceful* (falls back to empty schema). |
| 10 | `src/project-md.js` — **project I/O** (`writeProjectMd`/`readProjectMd`) | `join(repoRoot, 'PROJECT.md')` | **Yes** | None. |
| 11 | `src/agent-generator.js` (`generateProjectContext`) | `join(repoRoot, '.claude','agents','project-context.md')` | **Yes** (param) | **Behavioral check:** it writes `project-context.md` into the *user's* `<repoRoot>/.claude/agents/`. That is correct — the per-project briefing belongs in the user's repo, not the plugin. Confirm the dir-create (`mkdirSync(dirname(target), {recursive:true})`) handles a user project with no pre-existing `.claude/`. It does. No change. |
| 12 | `src/backlog-seeder.js` (`seedBacklog`, `readAllTasksSync`) | Takes `repoRoot`; `join(repoRoot,'tasks')`; delegates writes to `createTask` | **Yes** | None. |
| 13 | `src/framework-history.js` (`archiveFrameworkHistory`) | Takes `repoRoot`; `join(repoRoot,'tasks')`, `join(repoRoot,'.framework-history',…)` | **Yes** | None. **But:** on a freshly-installed plugin the user's project has no framework-history tickets, so the archive step is a structural no-op (its guard returns `{archived:[]}` when `tasks/` is absent or empty). The dev-repo seed tickets never reach the user — they live in the plugin cache, not `${CLAUDE_PROJECT_DIR}`. |
| 14 | `bin/init.js#countFrameworkHistory` (~L77) | `join(repoRoot,'tasks')` | **Yes** (param) | None beyond #1's shell binding. |
| 15 | `package.json` — `ajv`, `ajv-formats`, `gray-matter` | Listed under **`devDependencies`** | **No (packaging bug)** | `task-store.js` imports `ajv`/`ajv-formats` at runtime; the init path runs that code on the *user's* machine. These must move to **`dependencies`**, AND `node_modules` must be resolvable where the plugin's Node code runs. See B.4. |

**Summary:** of ~15 audited surfaces, only **3 CLI shells (#1–#3)** and **1 packaging fix (#15)** are genuine retargets; **2 are framework-asset reads (#8–#9)** that are already correct; everything in `src/` is already `repoRoot`-clean. The earlier design instinct ("`repoRoot` is already a parameter on most functions — good") is confirmed: the retargeting blast radius is small and concentrated at the CLI boundary.

### B.3 Where the user's `state/` and `tasks/` live, and how `bin/` discovers the project root

- **The user's `tasks/`, `state/`, `PROJECT.md`, `.claude/agents/project-context.md`, and `knowledge/` all live under `${CLAUDE_PROJECT_DIR}`** — i.e. inside the user's own repo, version-controlled by them. They are *created by the framework at init time* (via `seedBacklog`, `startSession`, `writeProjectMd`, `generateProjectContext`), writing into the project root.
- **The framework's own `tasks/`/`state/` (the dev backlog, this very ticket) stay inside the plugin** and are never touched at the user's project. `bin/make-template.js` exists precisely to scrub the dev repo to a pristine state *before* it is published, so the shipped plugin carries no stale dev tickets. (If make-template is excluded from the shipped `bin/` per #3, it still runs at publish time from the dev clone.)
- **How `bin/` shells discover the project root:** the plugin's `bin/` directory is placed on the **Bash tool's PATH while the plugin is enabled** (confirmed: "Executables added to the Bash tool's PATH … invokable as bare commands"). When the orchestrator (or a slash command) runs `node init.js` or invokes the bare command, that Bash process inherits `CLAUDE_PROJECT_DIR` in its environment. The shells read `process.env.CLAUDE_PROJECT_DIR` (falling back to `process.cwd()` for the standalone/dev case). This is the single retarget seam.

  **Caveat / verify-at-impl:** the docs state `CLAUDE_PROJECT_DIR` is exported to **hook and MCP/LSP subprocesses** explicitly, and is the value "hooks receive." It is *very likely* also present for Bash-tool subprocesses spawned while a plugin is enabled (the Bash tool runs in the project working directory), but the docs do not state this verbatim for the Bash-tool case. **Impl ticket #2 must verify** that `CLAUDE_PROJECT_DIR` is set in the Bash-tool environment, or that `process.cwd()` of a Bash-tool call equals the project root. If neither holds, the fallback strategy is a **`SessionStart` hook** that exports/derives the project dir, or invoking init via a slash command whose `$ARGUMENTS`/working-dir is the project. (Flagged §I.)

### B.4 Runtime dependency resolution (the `ajv` problem)

`src/task-store.js` does `import Ajv from 'ajv/dist/2020.js'` and `import addFormats from 'ajv-formats'` at module load, and `src/project-md.js`/the loader use `gray-matter` patterns elsewhere. When the plugin is installed, its directory is copied to the cache **without** running `npm install`. So `node_modules` will not exist next to the cached `src/`. Two options:

1. **Vendor dependencies** — bundle `node_modules` (or pre-bundle `ajv` into a single file via esbuild) inside the plugin so the imports resolve from the cache dir. Simple, self-contained, but bloats the plugin and pins transitive versions.
2. **Install into `${CLAUDE_PLUGIN_DATA}` on first run** — use the documented `SessionStart`-hook pattern (diff bundled `package.json` against a copy in `${CLAUDE_PLUGIN_DATA}`, `npm install` when they differ), and set `NODE_PATH=${CLAUDE_PLUGIN_DATA}/node_modules` for the bin/MCP subprocesses. This is the pattern the reference explicitly documents for plugins with Node deps. Survives plugin updates, no repo bloat, but adds a hook + a first-run `npm install` latency.

**Recommendation:** option 2 (the documented pattern) for the MCP server and bin scripts, with `ajv`/`ajv-formats`/`gray-matter` moved to `dependencies`. Re-evaluate vendoring if first-run latency is unacceptable. This is its own impl ticket (#3).

---

## C. Orchestrator ship + activation (AC3)

### C.1 The blocking constraint

The orchestrator IS `CLAUDE.md` (RESUME FIRST + First-chat routing). But the plugins-reference states plainly:

> "A `CLAUDE.md` file at the plugin root is not loaded as project context. Plugins contribute context through skills, agents, and hooks rather than CLAUDE.md. To ship instructions that load into Claude's context, put them in a skill."

So we **cannot** ship the orchestrator simply by putting `CLAUDE.md` in the plugin and expecting it to activate. The routing must reach Claude's context by another mechanism. Three options:

### C.2 Option comparison

**Option 1 — Generate a project-level `CLAUDE.md` at init time.**
The `/hivemind:init-project` command (or `bin/init.js`) writes a `CLAUDE.md` into `${CLAUDE_PROJECT_DIR}` containing the RESUME FIRST + First-chat routing + workflow contract. Claude Code *does* load the project's own `CLAUDE.md` as context. Pros: zero ambiguity — the routing lives where Claude already looks; survives across chats with no per-session step. Cons: **collision** when the user's project already has a `CLAUDE.md` (the common case). Must detect and *append a clearly delimited routing block* rather than overwrite, and must be idempotent on re-run.

**Option 2 — Ship the routing as an always-on plugin skill.**
A `skills/orchestrator-routing/SKILL.md` (with a `description` that makes Claude load it whenever the user asks to "start/resume work") carries the RESUME-FIRST four-step sequence. Pros: no file written into the user's repo; updates with the plugin; no CLAUDE.md collision. Cons: skills are *model-invoked by description match* — activation is probabilistic, not guaranteed on the very first message of a cold chat, which is exactly when RESUME FIRST must fire. A skill is also more easily "forgotten" mid-session than a top-of-context CLAUDE.md rule. The `settings.json` `agent` key (which can force a plugin agent to be the main thread) is a stronger variant — but plugin `settings.json` only supports `agent` + `subagentStatusLine`, and making the orchestrator the *default main agent* for the user's whole Claude Code install is too invasive.

**Option 3 — Bootstrap slash command that generates the routing (hybrid).**
A `/hivemind:init-project` command runs intake AND writes/merges the project `CLAUDE.md` (Option 1's mechanism), and the plugin *also* ships a lightweight routing skill (Option 2) as a backstop so resume works even before init has run. The command is the explicit, deterministic entry point; the generated CLAUDE.md is the durable activation; the skill is the safety net.

### C.3 Recommendation

**Option 3 (bootstrap command → generated/merged project `CLAUDE.md`, with a thin routing skill as backstop).** Rationale:

- RESUME FIRST must fire **deterministically on the first message of every new chat**. Only a project-level `CLAUDE.md` rule reliably does that (it loads as context unconditionally). A skill alone (Option 2) is too probabilistic for the one instruction that must never be missed.
- The **collision case is handled explicitly**: `init-project` checks for an existing `${CLAUDE_PROJECT_DIR}/CLAUDE.md`. If absent, write the full framework CLAUDE.md. If present, **append a fenced, marker-delimited block** (e.g. between `<!-- BEGIN hivemind routing -->` / `<!-- END hivemind routing -->`) so re-runs replace only that block and never clobber the user's content. This mirrors the framework's existing idempotency discipline (the `seed` label guard, make-template's marker-scoped rewrites).
- The bootstrap command is the natural home for the existing intake wizard (`bin/init.js`), so AC3 and the init experience converge into one user action: `/hivemind:init-project`.
- The backstop skill costs little (always-on token cost is just its description) and rescues the "user installed the plugin but hasn't run init yet, and opens a fresh chat" case.

**What the generated CLAUDE.md contains:** the RESUME FIRST four-step sequence, First-chat routing (the `PROJECT.md`-absent → run init branch), the workflow loop, and repository etiquette — i.e. the substance of the current repo-root `CLAUDE.md`, minus framework-development-specific bits. The orchestrator *agent* (`agents/orchestrator.md`) ships via the plugin's `agents/` and is invokable as `hivemind:orchestrator`; the generated CLAUDE.md tells the main thread to *act as* the orchestrator and follow RESUME FIRST.

---

## D. Proof-of-load spec (AC4)

This is a **throwaway** minimal plugin to prove that (a) a plugin loads via `--plugin-dir` on this Windows machine, (b) at least one existing agent appears, and (c) at least one slash command appears. It does **not** exercise retargeting or the real engine — it is a load smoke test only. The orchestrator (you) will execute the command and paste the result back, since I cannot run a shell.

### D.1 Skeleton file list (create under a temp dir, e.g. `C:\Users\srpar\plugin-proof\`)

Exactly three files:

**File 1 — `C:\Users\srpar\plugin-proof\.claude-plugin\plugin.json`**
```json
{
  "name": "af-proof",
  "description": "Throwaway proof-of-load for TASK-020",
  "version": "0.0.1"
}
```

**File 2 — `C:\Users\srpar\plugin-proof\agents\af-orchestrator.md`**
(A copy of the real orchestrator's frontmatter is enough to prove agent discovery. Use a minimal, dependency-free agent so load can't fail on tool grants.)
```markdown
---
name: af-orchestrator
description: Proof-of-load orchestrator agent for TASK-020. Coordinates dev work.
tools: Read, Grep, Glob
---

You are a proof-of-load orchestrator. If invoked, say "af-proof orchestrator loaded".
```

**File 3 — `C:\Users\srpar\plugin-proof\commands\ping.md`**
```markdown
---
description: Proof-of-load slash command for TASK-020
---

Respond with exactly: "af-proof ping ok".
```

### D.2 Exact command to run on this machine (Windows / PowerShell)

```
claude --plugin-dir C:\Users\srpar\plugin-proof
```

(Forward-slash and relative `./plugin-proof` forms also work; the absolute Windows path above is unambiguous from any cwd. If testing the zip path instead: `claude --plugin-dir C:\Users\srpar\plugin-proof.zip` — requires Claude Code v2.1.128+.)

### D.3 Expected success signals

After Claude Code starts with the flag:

1. Run `/help` (or `/agents`) — the agent **`af-proof:af-orchestrator`** should be listed.
2. Run `/agents` — `af-orchestrator` appears under the `af-proof` plugin namespace.
3. Run the slash command **`/af-proof:ping`** — Claude responds `af-proof ping ok`.
4. Optionally `claude --debug` shows a "loading plugin af-proof" line and registers 1 agent + 1 command with no manifest errors.

**Failure-mode tells** (from the reference's troubleshooting table): if the agent/command don't appear, the most likely cause is component dirs placed inside `.claude-plugin/` instead of at the plugin root — verify `agents/` and `commands/` are siblings of `.claude-plugin/`, not children. If the manifest is rejected, `claude plugin validate C:\Users\srpar\plugin-proof` reports the specific field error.

### D.4 What this proves vs. doesn't

Proves: plugin discovery + manifest parse + agent registration + command registration work on this Windows box via `--plugin-dir`. Does **not** prove: `${CLAUDE_PROJECT_DIR}` retargeting, `bin/` PATH injection, MCP startup, or node-dep resolution — those are impl-chain concerns, intentionally out of scope for a load smoke test. Throwaway: delete `C:\Users\srpar\plugin-proof\` after capturing the result; do not commit it.

### D.5 Observed result (executed by orchestrator, 2026-05-28)

Executed on this machine (`claude` at `/c/Users/srpar/.local/bin/claude`). Skeleton created per §D.1 plus a `marketplace.json` to exercise the install path. Results:

- **`claude plugin validate <dir>`** → `✔ Validation passed with warnings` (1 cosmetic warning: no `author`). Manifest schema accepted.
- **`claude --plugin-dir <dir> --debug -p "..."`** → started cleanly, exit 0 (headless load with the plugin dir succeeds; no manifest/load errors).
- **`claude plugin marketplace add` + `claude plugin install af-proof@af-proof-marketplace`** → both `✔ Successfully …`. Local relative-path (`source: "./"`) marketplace + install path works exactly as designed in §A.3.
- **`claude plugin details af-proof`** (deterministic component inventory) →
  ```
  Component inventory
    Skills (1)  ping
    Agents (1)  af-orchestrator
    Hooks (0)
    MCP servers (0)
  Projected token cost — Always-on: ~67 tok
  ```
  Both the agent AND the command registered. **Naming nuance discovered:** the `commands/ping.md` file is surfaced under **Skills**, not a separate "Commands" bucket, in this Claude Code version — i.e. `commands/` and `skills/` may be inventoried together. P1 should confirm whether the framework's intake entrypoint is better authored as a `commands/` file or a `skills/` SKILL.md given this. Does not change the §C recommendation.
- **Cleanup** — `plugin uninstall` + `marketplace remove` + dir delete all succeeded; `plugin list` / `marketplace list` confirm zero `af-proof` residue in the user's config.

**Verdict: AC4 PASS.** Plugin packaging loads, validates, installs via a relative-path marketplace, and registers an agent + a command on this Windows box. The `claude plugin {validate,details,install,uninstall,marketplace}` CLI surface is available for the impl chain's verification steps (and is non-interactive — usable as a sensor).

---

## E. MCP seam contract (AC5)

### E.1 Which task-store operations become MCP tools

The MCP server wraps `src/task-store.js`'s public API. Each tool binds `repoRoot` to the project root the server was launched against (`${CLAUDE_PROJECT_DIR}` substituted into the `.mcp.json` `env`/`cwd`, or the MCP `roots/list` request). Proposed tools (name → args → returns), all thin wrappers over existing functions:

| MCP tool | Args | Returns | Wraps |
|----------|------|---------|-------|
| `list_todos` | `{}` | `Task[]` (status==todo, numeric-key order) | `listTodos({repoRoot})` |
| `list_ready` | `{}` | `Task[]` (todo with all deps done) | `listReady({repoRoot})` |
| `get_task` | `{ key: string }` | `Task \| null` | read `tasks/<key>.json` |
| `create_task` | `{ title, description, acceptance_criteria: string[], priority, labels?: string[], depends_on?: string[] }` | `{ key, path }` | `createTask({repoRoot, …})` |
| `transition_status` | `{ key: string, status: "todo"\|"in_progress"\|"in_review"\|"blocked"\|"done" }` | `{ ok: true }` | `transitionStatus({repoRoot, key, status})` |
| `append_comment` | `{ key: string, author: string, body: string }` | `{ ok: true }` | `appendComment({repoRoot, key, author, body})` |

These map 1:1 onto the Jira-compatible field names already in `tasks/schema.json`, so the same tool surface survives the eventual Atlassian-MCP migration (the server backend swaps from local JSON to Jira; the tool names stay).

`.mcp.json` shape (per the reference; `${CLAUDE_PLUGIN_ROOT}` for the server code, `${CLAUDE_PROJECT_DIR}` for the project it operates on):
```json
{
  "mcpServers": {
    "hivemind-tasks": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/src/mcp-server.js"],
      "env": {
        "CLAUDE_PROJECT_DIR": "${CLAUDE_PROJECT_DIR}",
        "NODE_PATH": "${CLAUDE_PLUGIN_DATA}/node_modules"
      }
    }
  }
}
```

### E.2 Explicit WILL / WON'T for a non-Claude-Code user once the seam exists

**A non-Claude-Code MCP client (claude.ai, Claude Desktop, or any MCP host) WILL get:**
- The six task-store tools above — read the backlog, read a ticket, create tickets, transition status, append comments. Full CRUD on the ticket store as MCP tool calls.
- (If we also expose them) MCP *resources* for read-only ticket browsing and *prompts* for canned task-creation templates.
- Whatever skills/slash commands the plugin ships, **if** that client supports plugin skills/commands (claude.ai/Desktop get MCP tools and, via plugins, skills/commands).

**A non-Claude-Code MCP client WON'T get:**
- **The orchestrator → developer/reviewer/researcher subagent loop.** Agent-tool subagents are file-based `.claude/agents/` constructs exclusive to Claude Code; MCP cannot install or activate them. ([sub-agents.md](https://code.claude.com/docs/en/sub-agents.md), [mcp.md](https://code.claude.com/docs/en/mcp.md))
- **The RESUME-FIRST session-state orchestration** as an automatic behavior (no main-thread CLAUDE.md routing in a non-Code host). The session bundle files still exist on disk and the MCP tools could read them if we exposed session tools, but nothing *drives* the workflow loop.
- **The TDD-enforced dev loop** (tests-first, fresh-context review, etc.) — that is orchestrator behavior, not a tool.

In one line for the "broaden later" expectation: **the MCP seam turns the framework's *ticket store* into a cross-client API, but the *orchestration* stays Claude Code-only.** A non-Code user gets a shared backlog, not a robot dev team.

---

## F. Phased implementation ticket chain (AC6)

Ordered, with one-line scope and `depends_on` edges. Ready to mint.

| Proposed | Scope (one line) | depends_on |
|----------|------------------|------------|
| **P1 — Plugin scaffold + manifests** | Create `.claude-plugin/plugin.json` + `marketplace.json`; relocate `agents/` and `skills/` from `.claude/` to plugin root; add `commands/` dir; verify load via `--plugin-dir`. | — |
| **P2 — repoRoot retargeting** | Bind the three `bin/` shells to `process.env.CLAUDE_PROJECT_DIR ?? process.cwd()`; verify `CLAUDE_PROJECT_DIR` is present in the Bash-tool env (or add `SessionStart` hook fallback); confirm `src/` asset reads (#8/#9) resolve inside the plugin cache. Tests for the env-binding. | P1 |
| **P3 — Runtime dependency packaging** | Move `ajv`/`ajv-formats`/`gray-matter` to `dependencies`; implement the `${CLAUDE_PLUGIN_DATA}` + `SessionStart`-hook `npm install` pattern and `NODE_PATH` wiring so `task-store.js` imports resolve at the user's machine. | P2 |
| **P4 — `/init-project` bootstrap command** | Author `commands/init-project.md` that invokes the intake wizard against `${CLAUDE_PROJECT_DIR}` (PROJECT.md, project-context.md, seeded backlog, session bundle). | P2, P3 |
| **P5 — Orchestrator ship + activation** | Generate/merge a project-level `CLAUDE.md` (marker-delimited, idempotent, collision-safe per §C.3) from `init-project`; ship the always-on routing backstop skill; **reconcile `agents/orchestrator.md` with the v2 pointer/bundle contract** (the current file still describes the v1 single-file `state/session.json` + `state/sessions/<updated_at>.json` archive scheme — a discrepancy, see §H). | P4 |
| **P6 — MCP task-store server** | Implement `src/mcp-server.js` exposing the six tools (§E); add `.mcp.json`; bind `repoRoot` to `${CLAUDE_PROJECT_DIR}`. | P3 |
| **P7 — E2E install test + quickstart docs** | A clean-machine test: add marketplace → install → `/init-project` → confirm backlog + session + orchestrator activation; write a non-technical quickstart README. | P5, P6 |

**Critical path:** P1 → P2 → P3 → P4 → P5 → P7. P6 (MCP) branches off P3 and rejoins at P7; it is the only piece that can be deferred without blocking the core "install and develop" experience, consistent with the "devs now, broaden later" direction.

### New tech stack / skill assessment (AC6 requirement)

**No new `.claude/skills/<stack>/` skill is warranted.** The work is entirely (a) packaging/config (JSON manifests, directory moves), (b) trivial env-var binding in existing Node CLI shells, and (c) a standard MCP server wrapping functions that already exist. The plugin/marketplace mechanics live in the Claude Code docs (cited throughout) and in *this* design doc; MCP-server authoring is a one-off that doesn't recur across tickets. The team will not repeatedly need "how to write a Claude Code plugin" as a stack skill the way it might need, say, a database-driver skill. If P6's MCP server uses a specific MCP SDK the team hasn't used, the developer can request a focused research pass at that point — but that is a maybe-later, not a now.

---

## G. Discrepancies found vs. the briefing's "authoritative external facts"

The live docs **confirmed** every external fact in the briefing (plugins bundle agents+skills+commands+hooks+MCP as one unit; `.claude-plugin/plugin.json` manifest + `marketplace.json`; `/plugin install <name>@<marketplace>`; `claude --plugin-dir`; `claude --plugin-url <zip>`; skills auto-discover and namespace as `/plugin-name:skill-name`; MCP cannot carry subagents). Additions / refinements beyond the briefing:

1. **Plugin-root `CLAUDE.md` is explicitly NOT loaded as context.** The briefing didn't state this; it is the single most important constraint for AC3 and forces the §C.3 generated-CLAUDE.md approach. (plugins-reference, "Plugin directory structure")
2. **`${CLAUDE_PROJECT_DIR}` is the canonical project-root handle** — the briefing framed retargeting as an open unknown; the docs give an exact mechanism, shrinking AC2's risk to "verify it's set in the Bash-tool env."
3. **`--plugin-url` is zip-only and `--plugin-dir` zip support needs v2.1.128+;** `displayName` needs v2.1.143+; plugin monitors need v2.1.105+. These are version-gated — flagged where used.
4. **`bin/` is auto-added to the Bash-tool PATH** when the plugin is enabled — a stronger, cleaner mechanism than the briefing implied for exposing `init`/`new-task`.
5. **Path-traversal limitation:** installed plugins cannot read files outside their own dir (`../shared` breaks post-install). This validates that framework-asset reads (`src/ → ../tasks/schema.json`) are fine (intra-plugin) but any attempt to reach the user's repo via relative paths would fail — reinforcing the "use `${CLAUDE_PROJECT_DIR}`" rule.

No contradictions with the briefing were found.

## H. Repo-internal discrepancy worth flagging

`.claude/agents/orchestrator.md` still documents the **v1** session model: a single `state/session.json` holding full state and archiving to `state/sessions/<updated_at>.json` on task completion (its "Session State" section, steps 1–5 and workflow step 8). This contradicts the **v2 pointer/bundle** contract now in `CLAUDE.md` and `state/README.md` (tiny pointer file + `state/sessions/<session-id>/` bundles, `session-id` = `YYYYMMDDTHHMMSSZ-<hex>`). The orchestrator agent text was not updated when TASK-004's bundle design landed. **This must be reconciled in P5** (orchestrator ship + activation) — shipping the stale agent text into user projects would propagate the wrong session model. Not strictly in TASK-020's scope to *fix*, but it's load-bearing for the plugin's correctness, so P5 owns it.

---

## I. Open questions (need a human decision before the impl chain is minted)

1. **Is `CLAUDE_PROJECT_DIR` set in the Bash-tool subprocess environment?** The docs guarantee it for hook + MCP/LSP subprocesses and as the value hooks receive; they do not state verbatim that a plain Bash-tool call inherits it. P2 must verify on this machine. If not, fallback is a `SessionStart` hook or invoking init exclusively via the slash command. **Recommendation:** verify empirically first (cheap); only add the hook if needed.
2. **Ship `bin/make-template.js` to users, or keep it publish-time-only?** It is a dev/distribution scrub tool, not a user-facing command, and exposing it on the user's PATH risks a destructive `--yes` run against a real project. **Recommendation:** exclude it from the shipped `bin/` (keep it in the repo for publish-time use), or hard-guard it. Confirm.
3. **CLAUDE.md collision policy.** Recommended: marker-delimited append/replace into an existing project `CLAUDE.md`, never overwrite. Confirm the marker convention and whether the user should be prompted before the framework writes into their `CLAUDE.md` at all (vs. silent merge). **Recommendation:** prompt once, then idempotent merge.
4. **Dependency strategy: `${CLAUDE_PLUGIN_DATA}` install vs. vendored bundle.** §B.4 recommends the documented data-dir install pattern; vendoring (esbuild single-file) is the alternative if first-run latency hurts. Confirm preference before P3.
5. **Marketplace hosting + name.** `hivemind-marketplace` (not reserved) hosted in this same git repo via relative `source: "./"`. Confirm the repo will be the public marketplace, or whether a separate catalog repo is wanted. Affects the `source` form in §A.3.
6. **Explicit `version` vs. commit-SHA versioning during the impl chain.** Recommend leaving `version` unset (commit-SHA) while iterating P1–P7, then setting an explicit `version` at the first published release. Confirm.
7. **Does `make-template` also need to scrub a user-project `CLAUDE.md` routing block on uninstall?** Out of scope for TASK-020 but worth a future ticket — the framework writes into the user's `CLAUDE.md`; nothing currently cleans it up. Flag for backlog.

---

## Sources

- [Create plugins (plugins.md)](https://code.claude.com/docs/en/plugins.md) — plugin structure, `--plugin-dir`/`--plugin-url`, `bin/` on PATH, "convert configurations" migration, `settings.json` `agent` key.
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference) — full `plugin.json` schema, component path fields & replace/extend rules, `${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_PLUGIN_DATA}`/`${CLAUDE_PROJECT_DIR}`, "`CLAUDE.md` at plugin root is not loaded as context", path-traversal limits, `${CLAUDE_PLUGIN_DATA}` npm-install pattern, plugin-agent supported frontmatter (no `mcpServers`/`hooks`/`permissionMode`), CLI commands, version management.
- [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) — `marketplace.json` schema (`name`/`owner`/`plugins[]`), plugin sources (relative/`github`/`url`/`git-subdir`/`npm`), reserved names, `/plugin marketplace add` + `/plugin install`.
- [MCP (mcp.md)](https://code.claude.com/docs/en/mcp.md) and [Subagents (sub-agents.md)](https://code.claude.com/docs/en/sub-agents.md) — MCP exposes tools/resources/prompts only; subagents are Claude Code-exclusive file-based constructs.
