# Research memo: should hivemind's KB move to "something like Obsidian"?

**Question posed:** Should the knowledge layer migrate to an Obsidian-style vault, or stay as-is?
**Answer up front: stay as-is, and fix the process, not the format.** Details below.

## 1. Current-state assessment (verified by reading the repo, not from memory)

hivemind's knowledge layer is already, structurally, a markdown vault:

- `knowledge/entries/<id>.md` — one fact per file, YAML frontmatter (`id`, `problem`, `symptoms`, `solution`, `tags`, `projects`, `created_at`, `last_seen_at`, optional `source_urls`/`supersedes`/`superseded_by`), free-form markdown body. Only 3 entries exist today (`windows-atomic-rename-not-truly-atomic`, `claude-headless-stream-json-bridge`, `session-audit-logs-vs-wildcard-gitignore`).
- `knowledge/schema.json` — a JSON-Schema (draft-07-style, Ajv-validated) that machine-checks every entry's frontmatter (`src/knowledge.js::validateEntry`). This is real enforcement, not documentation.
- `src/knowledge.js::lookupKnowledge` — deterministic 3-pass grep scorer (tags×3, symptoms×2, body×1), stopword-filtered tokenizer, top-3 candidates, tie-break by `last_seen_at`. Pure function, no I/O side effects beyond read. `recordKbReuse` does an atomic (`atomic-write.js`, Windows-safe temp+rename+EBUSY-retry) frontmatter-only update of `last_seen_at`.
- `knowledge/graph/graph.json` — a **typed** graph (`src/knowledge-graph.js`): 4 node types (`knowledge_entry`, `task`, `decision`, `skill`), 6 enumerated edge relations (`learned-in`, `blocks`, `supersedes`, `uses`, `produced-by`, `relates-to`). Every write runs full Ajv 2020-12 validation and referential-integrity checks (`from`/`to` must exist) **before** any disk mutation; writes are atomic; serialization is deterministic (sorted nodes/edges) so git diffs stay readable. `neighbors()`/`nodesByType()` give typed, directional traversal.
- `agents/researcher.md` has a mandatory KB-first contract (brain-first, then grep-KB fallback) with an explicit manual algorithm the researcher agent can execute via `Read`/`Grep` (it has no `Bash`/code-exec tool, so it can't literally call the JS functions — it re-derives the same deterministic procedure by hand, per its system prompt).
- The heavier "brain" (Neo4j+Qdrant, semantic search) was demoted to experimental opt-in on 2026-07-04 — the team already chose lean over infra once this cycle.

**What it demonstrably fails at**, confirmed directly by reading `knowledge/graph/graph.json`:
- **Capture rate is structurally near zero.** ~3 entries after ~95 closed tickets. The cause is process, not format: every entry write requires per-entry human approval before commit (`agents/researcher.md`: "you may PROPOSE... never write... the Orchestrator commits after human approval"). Nothing about markdown vs. JSON changes that gate.
- **ID-hygiene bug, confirmed live in the file.** `graph.json` node ids mix `TASK-063` (uppercase, from `tasks/TASK-063.json`) and `task-032` (lowercase slug) for the same conceptual entity type ("task"), plus raw ISO-timestamp strings used as `decision` node ids (e.g. `2026-06-16T23:08:38.712Z`). Exact-id lookups (`neighbors({id: 'TASK-063'})` vs `'task-063'`) will silently miss depending on which casing the caller uses.
- **No semantic recall** — grep scoring only; a paraphrased question with different vocabulary than the entry's tags/symptoms scores zero.
- **Executable-lookup gap** — the researcher's tool allowlist (`Read, Grep, Glob, WebSearch, WebFetch, Write, mcp__github__*, mcp__wisearcher-brain__*`) has no code-execution tool, so it cannot literally invoke `lookupKnowledge()`; it must faithfully hand-simulate the algorithm via `Grep`, which is fragile compared to running the actual scorer.

## 2. What "moving to Obsidian" concretely means

An Obsidian **vault** is just a directory of plain `.md` files with YAML frontmatter and `[[wikilinks]]`; the Obsidian desktop app is an optional human viewer/editor layered on top with no proprietary file format. Two very different things get conflated under "move to Obsidian":

**(a) Agent-facing access via an Obsidian MCP server.** Checked the most-referenced implementation, [cyanheads/obsidian-mcp-server](https://github.com/cyanheads/obsidian-mcp-server): it exposes 14 tools (read/write/patch/frontmatter/tag management) but **wraps the Obsidian desktop app's Local REST API plugin** — it cannot touch vault files directly; it requires the Obsidian GUI app running with a paid-adjacent community plugin installed and an API key configured, on Bun ≥1.3.11 or Node ≥24. This is a hard **stateful, GUI-dependent runtime requirement**. It is disqualifying on its own for hivemind: the framework's stated direction is an unattended-first autonomous loop where subagents write with no human at the keyboard, and CLAUDE.md commits to zero runtime deps. Requiring a running desktop app with a plugin to write a KB entry is a regression on both axes, not an upgrade.

**(b) Adopting Obsidian's plain-file *conventions*** (frontmatter schema, `[[wikilinks]]`, index/log files) **without any app or MCP dependency**, using the same `Read`/`Write`/`Grep` tools the team already has. This is what Karpathy's "LLM Wiki" pattern ([Ar9av/obsidian-wiki AGENTS.md](https://github.com/Ar9av/obsidian-wiki/blob/main/AGENTS.md)) and Claude Code's own persistent-memory convention (one fact per file + frontmatter + `[[wikilinks]]` + `MEMORY.md` index — literally the scheme this researcher session itself operates under) both do. This half is genuinely low-cost and already compatible with hivemind's tools.

**Graph capability comparison.** Obsidian's graph view is derived purely from untyped `[[wikilinks]]` — a link only means "these two notes are related," nothing more. hivemind's `graph.json` has a **6-value enumerated relation type** (`produced-by`, `blocks`, `supersedes`, `uses`, `learned-in`, `relates-to`) with referential-integrity enforcement. Expressing a typed edge in Obsidian requires bolting on an ad hoc inline-field convention (Dataview-style `relation:: produced-by`) that is itself unenforced free text — strictly *less* rigorous than what already exists, and would need new parsing/validation code to recover parity. Migrating the graph to bare wikilinks is a capability downgrade, not a modernization.

**Schema enforcement.** A directly relevant critique found in research (["Stop Calling It Memory"](https://limitededitionjonathan.substack.com/p/stop-calling-it-memory-the-problem)) lists markdown-vault-as-memory's structural failures: no query language, no programmatic relationship traversal, a context-window scaling ceiling, **no schema enforcement**, and concurrent-write corruption risk. hivemind's `knowledge/schema.json` (Ajv-validated frontmatter) and `knowledge-graph.js` (Ajv-validated typed edges, single-writer-by-design per its own concurrency comment) already close two of those five gaps that a bare Obsidian vault would reopen.

**Portability/git-friendliness.** Both formats are plain text and diff cleanly in git; no material difference. `knowledge/graph/graph.json` already serializes deterministically (sorted keys) specifically so diffs stay readable — a property the team would have to re-derive for any wikilink-based graph file.

**The human can browse it in Obsidian today, at zero migration cost.** Because `knowledge/entries/*.md` is already plain markdown with YAML frontmatter, the human can literally open `D:\hivemind\knowledge` (or the whole repo) as an Obsidian vault right now to browse, tag-filter, and graph-view it — Obsidian doesn't require any format change to render existing frontmatter and tags. If the human wants the browsing experience, that desire is already satisfiable without an engineering task.

## 3. The honest third option: fix the process, not the format

The two confirmed failure modes (near-zero capture rate, id-hygiene bug) are process/data-hygiene bugs, not format limitations:

- **Capture rate.** The per-entry human-approval gate before any commit is the bottleneck (confirmed in `agents/researcher.md`). A format change does not touch this gate at all — Karpathy's own LLM Wiki pattern only works at scale because it writes automatically and relies on periodic human *review* rather than a pre-commit *approval* gate per fact, plus delta-tracking via `git log` since last sync. Both of those are portable onto the current JSON/markdown format with zero migration: e.g. let the Orchestrator auto-commit low-risk, clearly-generalizable proposed entries and batch them for human review at ticket-close or session-end, rather than blocking each one individually.
- **ID hygiene.** The `TASK-063`/`task-032` casing split is fixable with a normalization pass + a lint spec, independent of file format.
- **Executable lookup gap.** Fixable by adding a scoped code-exec capability (or a dedicated `kb_lookup`-style tool) to the researcher's allowlist so it runs the real `lookupKnowledge()` instead of hand-simulating it — again, unrelated to format.

None of these are addressed by moving to Obsidian; all of them are addressed by process changes fully compatible with the current format.

## 4. Comparison table

| | **Stay (current JSON+md)** | **Migrate to Obsidian-style md vault** | **Hybrid (adopt conventions, no app/MCP)** |
|---|---|---|---|
| Zero runtime deps | Yes (Ajv/gray-matter already deps) | No — MCP path needs the Obsidian app + REST plugin running | Yes |
| Unattended-loop safe (no human at keyboard) | Yes | No — MCP path is GUI-dependent | Yes |
| Schema enforcement | Yes (Ajv on frontmatter + graph) | No (convention only, unless rebuilt) | Yes (kept) |
| Typed, validated graph edges | Yes (6-relation enum + referential integrity) | No (bare wikilinks; typed edges need a new ad hoc convention) | Yes (kept) |
| Human can browse in Obsidian app | Yes, already, zero cost | Yes | Yes, already, zero cost |
| Fixes capture-rate problem | No (needs process fix either way) | No | No — but bundled with the process fix below |
| Engineering cost | Zero | High: rewrite `knowledge-graph.js`, `graphify` skill, `knowledge.js` lookup, 4+ spec files, `agents/researcher.md` contract | Low: optional `[[wikilink]]` cross-refs in entry bodies, no code changes required |

## 5. Migration cost estimate (if full migration were chosen)

- **`.claude/skills/graphify/SKILL.md` and `src/knowledge-graph.js`** — the entire value proposition (typed relations, referential integrity, atomic deterministic writes, `neighbors()`/`nodesByType()` query API) would need to be reimplemented against wikilinks-plus-inline-fields, likely at *higher* LOC than the current 364-line module, for *less* enforced capability.
- **`src/knowledge.js` lookup** — largely neutral; the grep-scoring algorithm doesn't care whether the file has wikilinks in the body, so this file wouldn't need to change much either way. This is itself evidence that format migration buys nothing for the lookup problem specifically.
- **Test/lock surface that would break or need rewriting:** `tests/knowledge-files.spec.js`, `tests/knowledge-graph-scaffold.spec.js`, `tests/graph-sync.spec.js`, `tests/graphify-skill.spec.js` all pin the current JSON-Schema/graph.json shape and would need to be rewritten against a new format; `tests/agility-doc-locks.spec.js`-style doc-lock specs that pin literal prose in `agents/researcher.md`/`CLAUDE.md`/skill files describing the current lookup procedure would also need updating everywhere that prose is duplicated (parity specs already exist to catch exactly this kind of drift, so the blast radius is at least self-detecting).
- **`agents/researcher.md` KB-first contract** — the entire brain-first/grep-fallback procedure description would need a rewrite, plus retraining the manual grep-simulation steps against a new file shape.

Net: full migration is a multi-file rewrite that regresses two structural capabilities (typed graph, unattended write-safety) to solve a problem (capture rate) it does not touch.

## 6. Recommendation

**Stay on the current JSON+markdown mechanism. Do not adopt an Obsidian MCP server (violates zero-runtime-deps and unattended-loop constraints). Optionally borrow two cheap, zero-dependency Obsidian conventions**, and separately fix the two confirmed process bugs:

1. **Fix the capture-rate gate** — replace per-entry pre-commit human approval with batched review (auto-commit clearly-generalizable proposed entries, human reviews the batch at ticket-close/session-end). This is the single highest-leverage change; it directly targets the ~3-entries-in-95-tickets failure.
2. **Fix the id-hygiene bug** — normalize `graph.json` task-node ids to one casing convention, add a lint/spec to prevent recurrence.
3. **Close the executable-lookup gap** — give the researcher a scoped way to actually run `lookupKnowledge()` rather than hand-simulating the grep procedure.
4. **(Optional, cheap) Adopt `[[wikilink]]`-style cross-references** in `knowledge/entries/*.md` bodies for human readability and free Obsidian graph-view compatibility, and tell the human they can already open `knowledge/` (or the repo) directly in the Obsidian app today for browsing — no code change required for that.

Rationale in one sentence: the pain is a human-approval bottleneck and an id-normalization bug, not a file-format limitation, and the one path that would look like "moving to Obsidian" for agent-facing writes (an MCP server) requires a GUI app running — a dependency hivemind's own unattended, zero-runtime-dep design explicitly rules out.
