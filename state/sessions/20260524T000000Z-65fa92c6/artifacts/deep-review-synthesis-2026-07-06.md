# Deep-Review Synthesis — Sweep #2 (2026-07-06)

**Input:** 50 adversarially-verified findings across 8 dimensions (loop-autonomy, state-integrity, security-injection, verification-gates, docs-drift, knowledge-layer, product-ux, roadmap-revalidation).
**Output:** 29 deduplicated roadmap items — 4 HIGH, 18 MEDIUM, 7 LOW.
**Scope note:** the codebase was heavily per-ticket-reviewed through the v0.10.0 drive; everything here is systemic or cross-module, not surface polish.

## Dominant themes

The unattended loop — the declared product surface since the 2026-07-01 lean pivot — is not yet reliably executable or enforceable outside the dev repo: the documented selection pipeline strands every dep-bearing goal, a plugin install cannot reach the loop machinery at all (bare `src/` paths, no dist bundle), and three of the five hard-stop gates exist only as prose. Where deterministic enforcement does exist it is thinner than the docs claim: the close guard fires on only one of three write paths, the calibration gate's BLOCK tier is structurally dead on its entire mandated surface, and fail-open defaults erase the remaining checks precisely when session state is damaged. Meanwhile the state/knowledge layer accretes without lifecycle management — a 260 KB bundle rewritten whole at every phase boundary and re-read at every resume, a knowledge-capture pipeline that produced 3 entries against 92 closed tickets, and a graph split into unjoinable id namespaces — steadily degrading cost and memory on exactly the unattended path the product now centers on.

---

## Finding index (original → merged item)

Original findings are referenced as F1–F50 in input order (dimension order: loop-autonomy F1–F7, state-integrity F8–F13, security-injection F14–F16, verification-gates F17–F22, docs-drift F23–F28, knowledge-layer F29–F34, product-ux F35–F42, roadmap-revalidation F43–F50).

| Item | Merged findings | Severity |
|---|---|---|
| R1 | F1 | HIGH |
| R2 | F35 | HIGH |
| R3 | F17, F18, F50 | HIGH |
| R4 | F23, F16 | HIGH |
| R5 | F4 | MEDIUM |
| R6 | F6, F8 | MEDIUM |
| R7 | F3, F5 | MEDIUM |
| R8 | F2 | MEDIUM |
| R9 | F9 | MEDIUM |
| R10 | F10, F47 | MEDIUM |
| R11 | F11, F44 | MEDIUM |
| R12 | F14, F15, F38, F43 | MEDIUM |
| R13 | F25, F26, F49 | MEDIUM |
| R14 | F36, F24 | MEDIUM |
| R15 | F42 | MEDIUM |
| R16 | F29 | MEDIUM |
| R17 | F30 | MEDIUM |
| R18 | F31, F48 | MEDIUM |
| R19 | F39, F45 | MEDIUM |
| R20 | F46 | MEDIUM |
| R21 | F19, F28 | MEDIUM |
| R22 | F37 | MEDIUM |
| R23 | F21, F22 | LOW |
| R24 | F20, F40 | LOW |
| R25 | F12 | LOW |
| R26 | F13 | LOW |
| R27 | F7 | LOW |
| R28 | F27, F32, F33, F41 | LOW |
| R29 | F34 | LOW |

---

## HIGH

### R1. Documented loop pipeline strands every dep-bearing ready ticket (F1)
- **Problem:** `commands/loop.md:85-86` pipes `listReady()` output (todo-only; done deps excluded — `src/task-store.js:317-336`) into `selectNextTicket`, whose `depsAreDone` (`src/drive-loop.js:42-49`) rejects any ticket whose done dep is absent from the passed array. The "safe in either case" claim at `drive-loop.js:13-14` is false and untested (`tests/drive-loop.spec.js:96-113` never composes the two). Null ticket + `goalStuck(allTasks)=false` spins the no-progress counter to `maxNoProgress=3` and stops with a misleading "dependency cycle" reason; restart hits the same wall. 30+ tasks carry `depends_on`.
- **Action:** Change loop.md Step 2 to fetch the FULL task list (readAllTasks/list_todos) for `selectNextTicket`, delete the false "safe in either case" claim, and add a composed listReady→selectNextTicket spec.
- **Impact/effort:** HIGH impact (permanently strands unattended goals via the documented path) / SMALL effort — doc line + comment + one spec, optionally a defensive tweak in `depsAreDone`.

### R2. /hivemind:loop and /hivemind:mode are unexecutable on the recommended plugin install (F35)
- **Problem:** loop.md (`:26,30,62,255`) and mode.md (`:50`) — plus orchestrator-routing SKILL.md `:396,411,482` — reference bare `src/session-lock.js` / `src/operating-mode.js` / `src/loop-checkpoint.js` / `src/loop-auth.js` paths that don't exist in a plugin-installed user project. Every other command uses `${CLAUDE_PLUGIN_ROOT}/dist/*.cjs`; no dist bundle exposes the loop helpers (`scripts/build-plugin.mjs:42-49` = 6 CLIs). Consequence chain: mode never flips to 'loop', so `loopModeCloseGuard` (`src/close-guard.js:41`) no-ops, no advisory lock, no crash-resume checkpoints — the entire deterministic loop apparatus depends on model improvisation for plugin users.
- **Action:** Ship a `dist/loop-ctl.cjs` CLI (acquire/renew/release/set-mode/checkpoint/grant-unattended/resume-point subcommands, added to ENTRYPOINT_NAMES and shipped-bin.json), and rewrite loop.md/mode.md/SKILL.md to invoke it via `${CLAUDE_PLUGIN_ROOT}`.
- **Impact/effort:** HIGH impact (flagship command broken + Gate-1 guard unarmed for all plugin users) / MEDIUM effort — new CLI wrapper over existing modules, doc re-path, packaging specs.

### R3. Calibration gate is structurally dead on its entire mandated surface (F17 + F18 + F50)
- **Problem:** Three compounding defects make the reviewer's mandated calibration gate a false-green: (a) `bin/check-calibration.js:53` exits non-zero only on BLOCKERs, and the only per-file BLOCKER rules (tier ceilings, `src/calibration.js:108-135`) are unreachable when `source_tier` is missing (`calibration.js:94-100` early-returns a FLAG) — `knowledge/schema.json` (additionalProperties:false, no source_tier property) makes it *illegal* for entries to carry the field, and tasks/*.json JSON-form fields aren't parsed by `extractTier`; (b) the G3 claim-language sensor is gated by a case-sensitive `includes('confirmed')` pre-filter (`calibration.js:38`) making `decided`/`resolved`/`proven` and any capitalized form dead code; (c) every knowledge file uniformly FLAGs for missing source_tier — noise that trains the reviewer to ignore the gate's output. `agents/reviewer.md:54,63,76` declares this "load-bearing" with "Source-tier ceiling → HIGH / BLOCK".
- **Action:** Make missing source_tier a BLOCKER on the surfaces the gate is mandated for; add `source_tier` to knowledge/schema.json; teach `extractTier` the JSON field form; delete the `includes('confirmed')` pre-filter; add spec cases for decided/resolved/proven and capitalized forms.
- **Impact/effort:** HIGH impact (false-green verification gate feeding auto-close; laundered certainty enters the KB) / SMALL-MEDIUM effort — localized logic + schema + specs.

### R4. Ticket-write contract is self-contradictory and the board bypasses the close guard (F23 + F16)
- **Problem:** Three canonical prose sites still instruct direct guard-bypassing Edit-to-done — SKILL.md:88-90, :97, Workflow step 6 (:138-141), and CLAUDE.md Workflow step 7 (no MCP mention anywhere in CLAUDE.md) — contradicting the Ticket-update protocol (SKILL.md:613-617) that exists precisely because a hand edit bypasses both the uat-only done-guard and the loop-mode close guard (TASK-082). Separately, the third write path half-enforces: `src/task-board.js:1370` calls `transitionStatus` without `closeGuard`, unlike `src/mcp-server.js:185,230`, so a board POST closes a ticket ignoring `auto_close_on_green_review` (SKILL.md:616 falsely claims MCP is the "only" path).
- **Action:** Rewrite SKILL.md:86-97 + Workflow step 6 + CLAUDE.md step 7 to name close_task/transition_status as the sole write path (direct Edit = documented degraded fallback only); pass `closeGuard: loopModeCloseGuard` in task-board.js:1370; add a doc-lock asserting the Workflow step text references the MCP tools.
- **Impact/effort:** HIGH impact (unattended orchestrator following the numbered workflow silently bypasses both deterministic guards) / SMALL effort — doc rewrite + one-line code fix + doc-lock spec.

---

## MEDIUM

### R5. Gates 2 and 4 are prose-only: no code reads `uat_delegated_to_orchestrator` or `auto_version_bump_on_milestone` (F4)
- **Problem:** The only loop_auth value any code reads is `auto_close_on_green_review` (`src/close-guard.js:54`). `checkUatGuard` (`src/task-store.js:377`) accepts ANY comment with author==='uat'; `appendComment` runs no guard. The push hook is an uninstalled copy-paste recipe (loop.md:159-161); Gate 4 has no code seam at all. A drifting/injected model with only auto_close granted can self-author a 'uat' comment and close a uat-only ticket past both shipped guards — contradicting SKILL.md:440-444's "cannot self-satisfy a UAT verdict".
- **Action:** Extend loopModeCloseGuard to reject uat-only closes in loop mode unless `uat_delegated_to_orchestrator===true` (or the uat comment records a human verdict); ship the push/version-bump PreToolUse hooks as installed settings rather than a recipe.
- **Impact/effort:** MEDIUM-HIGH impact (converts two prose gates to code) / MEDIUM effort.

### R6. Close guard fails OPEN to 'harness' on any unreadable pointer/bundle (F6 + F8)
- **Problem:** `getMode` (`src/operating-mode.js:24-34`) swallows every error and returns 'harness'; `loopModeCloseGuard` (`close-guard.js:40-41`) then no-ops without ever checking loop_auth. A corrupt/half-merged pointer or bundle (both are committed git files) disables the one deterministic Gate-1 backstop precisely when state is least trustworthy. Fail-open is a documented deliberate tradeoff (loop.md:187-196), but the deliberate version never considered the "loop is provably active" case.
- **Action:** Fail CLOSED when the pointer/bundle is unreadable AND a lock file exists at `state/.lock` (evidence a loop is active); at minimum distinguish "harness by default" from "harness because the read failed" via a typed error and block the latter on close attempts.
- **Impact/effort:** MEDIUM impact / SMALL effort — one guard-path change + specs.

### R7. Crash-resume checkpoint gaps: false 'reset' over landed commits + counters dropped on reset (F3 + F5)
- **Problem:** (a) The documented cadence (loop.md:63-66, SKILL.md:551-553) writes nothing between the fetch-phase checkpoint and the Developer's return — the longest phase, where test:/impl commits land. A mid-spawn crash resumes as in_progress+'fetch' → `resumePoint` returns 'reset' ("no durable work landed", `src/loop-checkpoint.js:40,162-168`), flipping the ticket to todo and re-driving it over already-landed commits (duplicate commits, broken red-run TDD evidence). (b) All three 'reset' returns (loop-checkpoint.js:142-147,154-159,162-168) omit iteration/completed_this_run/run_started_at — the very counters 'none'/'resume' carry verbatim to prevent silent zeroing — so a crash on a reset branch restarts the maxIterations and Gate-5 consolidation ceilings.
- **Action:** Add a checkpoint write immediately before the Developer spawn (phase 'test'/'impl') to loop.md + SKILL.md; include the counters verbatim on all 'reset' results; have the reset protocol check `git log` for ticket-referencing commits before discarding.
- **Impact/effort:** MEDIUM impact (wasted cost, false ticket comments, unbounded-ish ceilings across crash cycles) / SMALL effort — same module + docs.

### R8. Lock staleness window is reader-side only — a default-window session can steal a live loop's lock mid-spawn (F2)
- **Problem:** loop.md:26 tells the loop to pass a 30-60 min stalenessMs, but `makeLockRecord` (`src/session-lock.js:387-395`) never persists the window; `isFresh` (:493) judges freshness with the COMPETING caller's own stalenessMs (5-min default, :39,421). Renew only happens at phase boundaries; a Developer spawn routinely exceeds 5 minutes. loop.md:297 mischaracterizes expiry as governed by the holder's override.
- **Action:** Persist the holder's window (a `staleness_ms` or `expires_at` field) in the lock record; have `isFresh` honor max(record window, caller window); fix loop.md:26/297.
- **Impact/effort:** MEDIUM impact (dual-orchestrator overlap bounded to one phase, but drives the single-writer store concurrently) / SMALL effort.

### R9. Whole-bundle read-modify-write with no revision check — lost-update race across five writers (F9)
- **Problem:** lifecycle.js:143/187/234, loop-auth.js:83-94, operating-mode.js:62-71, loop-checkpoint.js:76-92 all do read→spread→write of the ENTIRE bundle with no lock or revision check (session-lock.js:14-22: lock "intentionally NOT wired" into lifecycle; harness chats never acquire it). Two writers interleaving in the sub-second read-to-write window silently lose one write — e.g. a revocation of `auto_close_on_green_review` clobbered by a concurrent checkpoint. Rare coincidence, but unguarded and untested, unlike the CAS-hardened task-store/lock (TASK-085/090/094).
- **Action:** Add optimistic concurrency to `writeBundleSession` (monotonic revision or read-bytes compare, reusing the session-lock CAS pattern) failing loudly when the bundle changed since the caller's read.
- **Impact/effort:** MEDIUM impact / MEDIUM effort — touches one seam all writers share.

### R10. S7 unbounded bundle growth: 260 KB / 1084 lines, fully rewritten per phase checkpoint, fully loaded per resume (F10 + F47)
- **Problem:** Live bundle: decisions[] 80+ entries (~131 KB), subagent_results[] 63 (~70 KB), handoff_summary a single 44 KB string — violating SKILL.md:55-59's "paragraph"/"~1000 chars" contract; schema length caps were deliberately removed (`src/schemas.js:46-56`) and no sensor replaced them. Every phase-boundary checkpoint rewrites the whole file (loop-checkpoint.js:78-92 + bundle.js:101-106, 4+ per ticket); RESUME-FIRST burns ~65 K tokens of orchestrator context per new chat; Read-tool truncation at 2,000 lines is ~2 drives away.
- **Action:** Implement compaction/rotation: keep required fields + mode/loop_auth/loop_state counters + latest handoff_summary in session.json; rotate older decisions/subagent_results into an append-only archive in the bundle dir; restore an enforced size sensor (maxItems/maxLength or a fast-tier spec).
- **Impact/effort:** MEDIUM-HIGH impact (cost + context erosion on the core unattended path) / MEDIUM effort.

### R11. writeBundleSession validates nothing — the lone unguarded state file (F11 + F44)
- **Problem:** `src/bundle.js:101-106` stringifies any payload straight to disk; `readBundleSession` is a raw JSON.parse. `bundleStateSchema` is compiled only in tests (which don't exist in consumer projects), while task-store, knowledge-graph, and knowledge all validate before write. Spread-merge writers faithfully propagate damage. (Caveat from verification: loop_state is deliberately additionalProperties:true and readers mostly fail safe, so this is defense-in-depth, not a live corruption vector.)
- **Action:** Compile the existing schema in src/bundle.js and validate in writeBundleSession before atomicWriteFile (typed E_BUNDLE_INVALID), mirroring the task-store pattern; optional validate-and-repair on read.
- **Impact/effort:** MEDIUM impact / SMALL effort.

### R12. Repo identity + framework bug reporter: stale DEFAULT_REPO, scrubber gaps, ungated agent path (F14 + F15 + F38 + F43)
- **Problem:** `DEFAULT_REPO = 'lordiwa/agent-framework'` (`src/framework-bug-report.js:275`, baked into `dist/report-framework-bug.cjs:181`) is the private upstream, not this product (origin = HexingBot/hivemind) — for non-maintainer operators GitHub filing always dead-ends in the local-file fallback with a misleading cause, so bugs never reach the maintainers; README.md:51-52's install example cites the same stale URL (rebrand leftover, commit 79f1bad updated neither). SECRET_PATTERNS has no URI-userinfo rule and the env rule omits `_AUTH`/bare `PASSWORD=` — `bolt://neo4j:hunter2@db:7687` and `NEO4J_AUTH=neo4j/hunter2` pass verbatim (reproduced live). The agent path (report-framework-bug.md:23-24) files with no human confirm.
- **Action:** Point DEFAULT_REPO (one shared constant) and the README URL at HexingBot/hivemind and rebuild dist/; add URI-userinfo + `_AUTH`/`PASSWORD=` scrub patterns with specs; require a confirm (or a loop gate) before any external `gh issue create` in agent mode.
- **Impact/effort:** MEDIUM impact (secret egress + misrouted/dead bug channel + wrong quickstart URL) / SMALL effort.

### R13. First-run breakage: README omits npm install; brain.md uses a repo-relative path that breaks plugin installs (F25 + F26 + F49)
- **Problem:** README.md:113-117 instructs clone → cd → `node bin/init.js` with no `npm install`; bin/init.js transitively imports ajv (task-store.js:34-35), so the very first onboarding command dies with ERR_MODULE_NOT_FOUND (README:182-184 admits the requirement, but only in the maintainer section). `commands/brain.md:19` runs `node bin/brain-launch.js --health` — the ONLY command using a repo-relative path — failing on plugin installs *after* `docker compose up -d` already ran; brain.md:2 also still recommends the TASK-079-demoted brain "at the start of a knowledge-heavy session" with no experimental label.
- **Action:** Add `npm install` to First-time setup; switch brain.md to `node ${CLAUDE_PLUGIN_ROOT}/dist/brain-launch.cjs --health` and reword to experimental opt-in.
- **Impact/effort:** MEDIUM impact (guaranteed onboarding failure for the stated non-technical audience) / TRIVIAL effort.

### R14. The loop is invisible in onboarding, and the generated CLAUDE.md routing block teaches the pre-pivot workflow (F36 + F24)
- **Problem:** README has zero mentions of loop/unattended; its first-chat script (README.md:78-87) teaches manual one-ticket-at-a-time. `src/claude-md.js:75-76` hardcodes unconditional "Tests first" into user-project CLAUDE.md (contradicting the tdd/tests-after/uat-only tier policy) and twice references `state/README.md` (:60-61, :80-81), which init never materializes into user projects. Dev-repo CLAUDE.md Operating Principle 4 (:29) unconditionally requires per-close approval, unqualified by loop_auth standing grants.
- **Action:** Add a "Run the loop" section (goal syntax, gates, unattended preset) to README and a pointer in CLAUDE.md; update the claude-md.js routing block to the tier policy + mention /hivemind:loop; drop or materialize the state/README.md reference; qualify Principle 4 with "unless a standing loop_auth authorization covers the action".
- **Impact/effort:** MEDIUM impact (product's primary surface undiscoverable; generated docs fight the shipped policy) / SMALL effort.

### R15. --apply-models / --apply-permissions silently no-op in plugin-installed projects (F42; verifier upgraded LOW→MEDIUM)
- **Problem:** `applyAgentModels` (`src/agent-generator.js:317-322`) and `applyDeveloperPermissions` (:497-502) silently skip missing target files; init writes only project-context.md into user `.claude/agents/`, so in a plugin install EVERY target is absent and the command prints "updated 0 file(s)" as apparent success. SKILL.md:499-514 markets --apply-permissions as the Developer Bash-allowlist "enforcement boundary" for unattended mode AND documents zero-changed-files as the idempotent-success signal — operators are actively taught to misread a neutralized security knob as applied. E2E tests cover only fixture repos where the files exist.
- **Action:** Copy the shipped agent definitions into the project's `.claude/agents/` before patching (project-scope overrides plugin agents), or emit an explicit warning naming the missing files; add a plugin-layout e2e case.
- **Impact/effort:** MEDIUM impact / SMALL-MEDIUM effort.

### R16. Knowledge capture pipeline is effectively dead: 3 entries vs 92 closed tickets; unattended preset auto-skips the only capture checkpoint (F29)
- **Problem:** All 3 knowledge entries predate 2026-06-16 with last_seen_at == created_at. The ticket-close protocol (SKILL.md:661-676) records only decision→task graph edges — no entry step; the only knowledge hook is Gate 5's consolidation pause, and the unattended preset sets `auto_consolidate=true` (loop.md:252-257) which skips it with no substitute action (`drive-loop.js:198`); `src/knowledge.js` has no entry-write function at all. Meanwhile SKILL.md:728 mandates KB-first lookup — a read contract with no write path. Recurring lessons (the 4x lock pid-identity class, TASK-078's 5 HIGH classes) never entered the KB.
- **Action:** Add a capture step to the ticket-close/drive-end protocol (any reviewer HIGH or RC loop → draft knowledge entry, orchestrator-committed); make Gate 5 under auto_consolidate still emit entry drafts instead of skipping knowledge work entirely.
- **Impact/effort:** MEDIUM impact (KB-first contract short-circuits nothing; lessons re-derived every drive) / MEDIUM effort — protocol design + docs.

### R17. Graph split into unjoinable id namespaces by two contradictory live conventions (F30)
- **Problem:** orchestrator-routing SKILL.md:668,671 mandates `TASK-035` keys + raw ISO decision timestamps; graphify SKILL.md:45-46 mandates slugs (`task-035`, `decision-...`). The live graph carries both: 25 `TASK-*` vs 26 `task-*` nodes, 12 raw-ISO vs 6 slug decision ids. `neighbors()` is exact-match with silent `[]` on unknown ids (`src/knowledge-graph.js:325-352`); addNode's dup guard is case-sensitive (:216) — so lookups silently miss and closes can mint split-brain duplicate nodes.
- **Action:** Pick one convention, migrate graph.json ids once (mechanical rename of nodes + edge endpoints), align both SKILL.md files, and make `neighbors()` warn/throw on unknown ids.
- **Impact/effort:** MEDIUM impact (audit trail + KB lookups silently degraded) / SMALL effort.

### R18. Researcher's "deterministic" KB lookup is hand-simulated; recordKbReuse has zero production callers (F31 + F48)
- **Problem:** researcher.md:5 grants no Bash; :34-41 mandates the weighted scoring algorithm and neighbors/nodesByType queries "as code" while :22 promises Reviewer-reproducible determinism — in practice the agent hand-emulates via Grep (the documented fallback), non-reproducibly. No MCP/CLI tool exposes `lookupKnowledge`; `recordKbReuse` (`src/knowledge.js:166`) is reachable only via the demoted brain client, so `last_seen_at` — the lookup's tie-breaker — is frozen at authoring time forever, and knowledge/README.md:26's "updates last_seen_at automatically" is false.
- **Action:** Expose a `kb_lookup` tool on the existing hivemind MCP server wrapping lookupKnowledge + recordKbReuse (or ship bin/kb-lookup.js + a scoped Bash grant); rewrite researcher.md's grep-KB section to call it; fix the README claim.
- **Impact/effort:** MEDIUM impact (grep KB is now the PRIMARY knowledge path post-demotion) / SMALL-MEDIUM effort.

### R19. No notification seam for unattended stops (F39 + F45)
- **Problem:** The entire stop contract is a bundle-file write + terminal text (loop.md:272-280, :110-114, :266-270); the unattended preset adds authorization switches but no completion/stop signaling; grep finds no notify/webhook mechanism anywhere. An absent operator whose granted-unattended run stops at iteration 3 on a reviewer HIGH loses the whole unattended window. (Downgraded companion: no /loop-status command or board banner either — task-board.js:41-43 removed the mode badge with the console.)
- **Action:** Add one optional notification hook on the stop path (a loop_notify command/webhook read from bundle or settings, executed alongside the loop-stop-reason.txt write); optionally a /hivemind:loop-status command and a documented Stop-hook notification recipe.
- **Impact/effort:** MEDIUM impact / SMALL effort for the hook; command is extra.

### R20. shouldStop bounds only iteration count while claiming to bound token spend; no wall-clock or context budget (F46)
- **Problem:** `src/drive-loop.js:162-181` inputs are exclusively iteration/no-progress counters, yet the reason string (:171) says "to avoid unbounded token spend". `run_started_at` is checkpointed (loop-checkpoint.js:54) but nothing consumes it; loop.md:117-123 lists no time/context backstop and never references the claude-code-context-monitor skill (which documents `context_window.used_percentage`). One pathological ticket can grind for hours inside the iteration ceiling. Flagged in the 2026-07-02 synthesis (S3); no ticket exists.
- **Action:** Add an elapsed-time budget to shouldStop (run_started_at is already available) and reference the context-monitor skill from loop.md as a stop condition; reword the reason string until spend is actually bounded.
- **Impact/effort:** MEDIUM impact (cost control on the core surface) / SMALL effort.

### R21. Doc-integrity sensors have holes: commands/loop.md is unlocked and skills-parity is bespoke per skill (F19 + F28)
- **Problem:** commands/loop.md:134-260 mirrors the full five-gate/switch contract but NO spec reads its content (only an inert path string in upstream-classify.spec.js:17) — SKILL.md's own gate/switch sections are also unlocked; a schema change would rot the operative loop prompt silently. Separately there is no generic skills-parity sweep: coverage is per-skill bespoke specs, the tech-training-template mirrored pair has ZERO byte-parity coverage today, and the set already diverges on both sides — prior drift needed a manual reconcile commit (d1f9b53).
- **Action:** Add a fast-tier doc-lock asserting loop.md's switch names equal LOOP_AUTH_SWITCHES and its gate headings match SKILL.md's; replace bespoke per-skill parity specs with one generic sweep (set-equality modulo an explicit exception list + recursive byte-identity).
- **Impact/effort:** MEDIUM impact (prevents silent contract rot on the operative prompt) / SMALL effort.

### R22. Release version is a two-site manual lockstep including a hardcoded constant inside a spec (F37)
- **Problem:** `.claude-plugin/plugin.json:9` and `tests/publish-config.spec.js:41` both hardcode `0.10.0`; release d677106 touched exactly these two files; the test is still *named* `plugin_json_has_version_exactly_0_1_1` while asserting 0.10.0. Every release — including a Gate-4-authorized unattended bump — must edit a test's expected value to pass the gate, normalizing "edit the test to pass"; package.json sits at 0.0.0 with no bump script.
- **Action:** Make the spec assert semver shape + agreement with a single source (read plugin.json, cross-check the git tag), or add scripts/bump-version.mjs updating both sites and the test name in one command.
- **Impact/effort:** MEDIUM impact (recurring release friction, misleading diagnostics) / SMALL effort.

---

## LOW

### R23. Zero-specs-green class survives in two npm scripts (F21 + F22)
- **Problem:** `test:use-cases` (package.json:14) carries `--passWithNoTests` while tests/use-cases/ contains zero .spec.js — its entire non-vacuity rests on one named file; moving it greens on nothing. `test:changed` (package.json:11) — the named per-ticket Developer gate — exits 0 selecting zero specs on a clean tree (reproduced live), guarded only by prose (developer.md:47). Both are the exact class scripts/test-since.mjs was built to kill.
- **Action:** Drop `--passWithNoTests`; route test:changed through a wrapper that fails on zero selected specs when `git status --porcelain` is clean.
- **Impact/effort:** LOW / TRIVIAL.

### R24. shipped-bin.json omits dist/report-framework-bug.cjs; "four bundles" comments stale against six (F20 + F40)
- **Problem:** shipped-bin.json lists 5 vs ENTRYPOINT_NAMES' 6 (build-plugin.mjs:42-49); sensors are membership-only (toContain) and cannot catch omission; stale "four bundles" prose at build-plugin.mjs:28,52 and dist-parity.spec.js:15-16. Known V1 drift from the 2026-07-02 synthesis, remediation deferred past TASK-074, never landed.
- **Action:** Generate shipped-bin.json from ENTRYPOINT_NAMES (or add a set-equality spec); fix the two comments.
- **Impact/effort:** LOW / TRIVIAL.

### R25. verifyAndRepairIndex is value-blind to stale status/priority (F12)
- **Problem:** `src/task-store.js:196-217` compares only key sets and field presence, never values; a crash between the task-file rename and the index rename leaves stale index values no later repair fixes. Impact bounded: the board and loop read per-task files, and any later mutation rebuilds the index.
- **Action:** Compare status/priority/title values per key (both already in memory); regenerate on mismatch.
- **Impact/effort:** LOW / TRIVIAL.

### R26. No recovery path for a corrupt pointer file; orphan tmps outside bundle session.json never swept (F13)
- **Problem:** `readPointer` (`src/pointer.js:20-24`) raw-parses with no typed error; `sweepAndRecover` (recovery.js:15) reaps only bundle session.json tmps — pointer/manifest/summary tmps accrete forever. Mitigations: startSession overwrites the pointer unconditionally; corruption vector is human-mishandled merges only.
- **Action:** Typed E_POINTER_CORRUPT + tmp-promotion recovery mirroring sweepAndRecover; widen the sweep to aged pointer/manifest/summary tmps.
- **Impact/effort:** LOW / SMALL.

### R27. Lock-loss and unexpected-error stops are exempt from the stop-artifact contract (F7)
- **Problem:** loop.md:274 enumerates four stop classes for `artifacts/loop-stop-reason.txt`; the E_LOCK_HELD stop (:28) and the unexpected-error pause (:301) are not among them — those exits leave no machine-readable why-trace.
- **Action:** Reword loop.md:272-280 to require the artifact for EVERY stop other than goalSatisfied, explicitly naming lock loss and unhandled errors.
- **Impact/effort:** LOW / TRIVIAL (prose).

### R28. Post-pivot stale residue sweep: TASK-091 viability note, brain-first prose, dead brain seam code, console-era skill (F27 + F32 + F33 + F41)
- **Problem:** (a) SKILL.md:251-252 still claims the Developer "currently declares a bare Bash tool" — contradicted by the applied allowlist and the same file's TASK-091 section (:499-514); (b) researcher.md:22-30 still mandates brain-first and brain.md recommends session-start use with zero "experimental" labeling post TASK-079 wont-do; (c) brain-client/graph-sync/wisdom-sink/recordKbReuse have zero production callers (~600 lines of test/review carrying cost) and knowledge/README.md:26's "automatically updates last_seen_at" is false; (d) `.claude/skills/claude-headless/` still triggers on the TASK-074-removed console bridge (*bridge*/*headless* files), polluting dev-repo sessions.
- **Action:** One residue-sweep ticket: rewrite the viability note past-tense; stamp EXPERIMENTAL on brain surfaces (or move the brain seam trio under an experimental dir); fix the README claim; delete or re-scope claude-headless.
- **Impact/effort:** LOW (context pollution, duplicate-ticket risk, carrying cost) / SMALL.

### R29. Decision graph nodes ref the mutable live session.json, some via non-resolvable fragment anchors (F34)
- **Problem:** 12-13 decision nodes ref the live bundle path (graph.json:7,25,...), 4 with invented `#<timestamp>` fragments (:229,:241,:247,:253) no tooling resolves — contradicting graphify SKILL.md:22-23's immutable-artifact model. Slow-rot risk if the decisions array is ever compacted (which R10 proposes — coordinate).
- **Action:** Record decisions as small immutable files (knowledge/decisions/<date>-<slug>.md) and ref those; when implementing R10's rotation, keep archived decisions addressable and repoint refs.
- **Impact/effort:** LOW / SMALL (fold into R10's design).

---

## Clusters

### Quick wins (small effort, high/medium impact)
- **R1** loop selection fix (HIGH, ~1 line of doc + 1 spec)
- **R4** guarded write-path: doc rewrite + board one-liner (HIGH)
- **R3** calibration gate revival (HIGH, localized)
- **R13** npm install + brain.md path (MEDIUM, trivial)
- **R12** DEFAULT_REPO + scrub patterns (MEDIUM, small)
- **R7** checkpoint cadence + reset counters (MEDIUM, one module)
- **R6** fail-closed close guard when a lock exists (MEDIUM, small)
- **R11** validate-before-write in bundle.js (MEDIUM, small)
- **R17** graph id migration (MEDIUM, mechanical)
- **R20** elapsed-time budget in shouldStop (MEDIUM, small)
- **R21** loop.md doc-lock + generic parity sweep (MEDIUM, small)
- **R22** version bump script/spec (MEDIUM, small)
- **R14** loop discoverability + claude-md.js block (MEDIUM, small)
- **R23, R24** test/manifest vacuity one-liners (LOW, trivial)

### Strategic (bigger bets worth planning)
- **R2** dist/loop-ctl.cjs — makes the flagship command real on plugin installs; unlocks R6/R7/R8 value for plugin users
- **R5** code-enforce Gates 2 and 4 + ship the PreToolUse hooks — converts the gate matrix from prose to mechanism
- **R10** S7 bundle compaction/rotation + size sensor (design jointly with R29 decision refs)
- **R9** optimistic concurrency on writeBundleSession — closes the last unguarded lost-update seam
- **R16** knowledge capture protocol — the KB-first contract needs a write path or it stays dead
- **R18** kb_lookup MCP tool — executable, reproducible KB lookup now that grep KB is primary
- **R15** apply-models/permissions on plugin layout — a marketed security knob must not silently no-op
- **R19** stop-notification seam — the unattended window is only as valuable as the operator's awareness of stops
- **R8** persist lock staleness window

### Watch (real but low value now)
- **R25** index value drift (microsecond crash window, decision-inert)
- **R26** pointer corruption recovery / orphan tmp sweep
- **R27** stop-artifact contract wording
- **R28** post-pivot residue sweep (batch when touching those files)
- **R29** decision ref immutability (fold into R10)

---

## Suggested ticket cut (mint first, in order)

| # | Ticket | Tier | Priority | Rationale |
|---|---|---|---|---|
| 1 | Fix loop ticket selection: pass the full task list to selectNextTicket; delete the false "pre-filtered is safe" claim; composed spec (R1) | tdd | high | The documented pipeline permanently strands any goal containing dep-bearing tickets — the product's core flow fails on 30+ existing tasks. |
| 2 | Ship dist/loop-ctl.cjs (lock/mode/checkpoint/grant subcommands) and re-path loop.md, mode.md, SKILL.md via ${CLAUDE_PLUGIN_ROOT} (R2) | tests-after | high | The flagship command is unexecutable on the recommended install, leaving Gate 1 unarmed and crash-resume impossible for every plugin user. |
| 3 | Revive the calibration gate: missing source_tier → BLOCKER on mandated surfaces, source_tier in knowledge/schema.json, JSON-form extractTier, drop the G3 case pre-filter (R3) | tdd | high | The declared HIGH/BLOCK verification gate structurally exits 0 on its entire mandated surface — a standing false-green feeding auto-close. |
| 4 | Single guarded write path: rewrite SKILL.md/CLAUDE.md workflow steps to the MCP tools, pass loopModeCloseGuard on the board endpoint, extend the guard to enforce uat_delegated_to_orchestrator on uat-only closes (R4 + R5-guard-leg) | tdd | high | Canonical prose instructs bypassing both deterministic close guards and one of three write paths skips them anyway — TASK-082's protection is porous end to end. |
| 5 | Crash-resume correctness: checkpoint before the Developer spawn, carry counters verbatim on 'reset', git-log check before discarding (R7) | tdd | medium | A crash during the longest phase falsely resets tickets over landed commits and zeroes the run's spend ceilings — pure loop-checkpoint logic, cheap to lock in specs. |
| 6 | Repo identity + reporter hardening: DEFAULT_REPO/README URL → HexingBot/hivemind, URI-userinfo and _AUTH scrub patterns, confirm gate on the agent path (R12) | tdd | medium | The only off-machine egress path leaks credential shapes verbatim and files bugs where no maintainer will ever see them. |
| 7 | Onboarding repair: npm install in quickstart, brain.md dist path + experimental framing, "Run the loop" section in README and the claude-md.js routing block (R13 + R14) | uat-only | medium | First-run dies at minute one and the product's primary surface is undiscoverable — pure docs/config, verified conversationally. |
| 8 | Bundle hygiene: validate-before-write in writeBundleSession + S7 compaction/rotation of decisions/subagent_results with an enforced size sensor (R11 + R10) | tdd | medium | The lone unguarded state file grows without bound, taxing every resume and checkpoint on the unattended path; schema + state mutation work squarely fits tdd. |

*Not cut this round but next in line:* R5's hook-shipping leg, R16 knowledge capture, R18 kb_lookup tool, R19 stop notification, R20 budgets, R21 doc-lock sweep, R22 bump script — all small-to-medium and well-specified above.
