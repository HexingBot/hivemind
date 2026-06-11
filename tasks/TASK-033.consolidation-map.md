# TASK-033 Consolidation Map — 51-file spec audit

**Baseline timings:** Run 1: 16.90s, Run 2: 16.93s (361 passed / 4 skipped, 51 files)

---

## Audit methodology

Each `it()` block was classified against one rule:
- **KEEP** — encodes an AC of a closed ticket, a real regression lock, or a documented design decision unique to this spec.
- **MERGE** — coverage duplicate; assertions move to the surviving spec, donor deleted.
- **DELETE** — superseded regression lock (decision later flipped), pure probe of library/runtime behavior, or empty placeholder shell (no unique contract).

Conservative bias applied: when in doubt, KEEP.

---

## File-by-file tables

### tests/e2e/task-store.spec.js (11 tests)

| spec name | verdict | AC / regression | justification |
|---|---|---|---|
| `list_todos_returns_only_status_todo` | KEEP | TASK-001 AC1 | canonical listTodos behavior |
| `list_todos_empty_store` | KEEP | TASK-001 AC1 edge | empty-store edge case |
| `list_todos_ignores_index_json` | KEEP | TASK-001 AC1 — files-not-index design | unique assertion (no-index + stale-index) |
| `transition_status_writes_new_status_and_bumps_updated_at` | KEEP | TASK-001 AC2 | happy path of transitionStatus |
| `transition_status_rejects_invalid_status` | KEEP | TASK-001 AC2 | enum guard + no-partial-write |
| `transition_status_rejects_unknown_key` | KEEP | TASK-001 AC2 | ENOENT guard |
| `transition_status_regenerates_index_after_write` | KEEP | TASK-001 AC4 | index-regeneration |
| `append_comment_pushes_well_formed_object` | KEEP | TASK-001 AC3 | comment shape contract |
| `append_comment_preserves_existing_comments` | KEEP | TASK-001 AC3 | append-not-replace |
| `append_comment_bumps_updated_at_and_regenerates_index` | KEEP | TASK-001 AC3+AC4 | updated_at + index regression |
| `writes_go_through_atomic_write` (transitionStatus) | KEEP | TASK-001 ATOMIC | unique: spies on transitionStatus path specifically |

**File verdict: KEEP ALL** — all 11 are the canonical TASK-001 AC map with no duplicates surviving the cross-file check.

---

### tests/e2e/task-store-hardening.spec.js (17 tests)

| spec name | verdict | AC / regression | justification |
|---|---|---|---|
| `verify_and_repair_index_rewrites_when_index_overcounts` | KEEP | TASK-009 AC1 | drift-detect edge: overcount |
| `verify_and_repair_index_rewrites_when_index_undercounts` | KEEP | TASK-009 AC1 | drift-detect edge: undercount |
| `verify_and_repair_index_no_churn_when_in_sync` | KEEP | TASK-009 AC1 | no-spurious-write happy path |
| `single_writer_assumption_comment_present` | KEEP | TASK-009 AC2 | source-grep for the design doc comment |
| `sweep_tasks_tmp_files_removes_orphans_and_preserves_canonicals` | KEEP | TASK-009 AC3 | sweeper behavior |
| `sweep_tasks_tmp_files_handles_missing_tasks_dir` | KEEP | TASK-009 AC3 | robustness: missing dir |
| `list_todos_invokes_sweep_tasks_tmp_files` | KEEP | TASK-009 AC3 | hook-point: listTodos calls sweep |
| `list_ready_excludes_tasks_with_unsatisfied_deps` | KEEP | TASK-009 AC4 | listReady + listTodos comparison |
| `list_ready_unblocks_after_dep_transitions_to_done` | KEEP | TASK-009 AC4 | dep-satisfaction dynamics |
| `list_ready_excludes_tasks_with_missing_dep_keys` | KEEP | TASK-009 AC4 | missing-dep defensive case |
| `transition_status_validates_before_write` | KEEP | TASK-009 AC5 | AJV validation before write |
| `append_comment_validates_before_write` | KEEP | TASK-009 AC5 | AJV validation before write |
| `create_task_validates_before_write` | KEEP | TASK-009 AC5 | AJV validation before write |
| `list_todos_sorts_by_numeric_suffix` | KEEP | TASK-009 AC6 | numeric sort |
| `build_index_sorts_by_numeric_suffix` | KEEP | TASK-009 AC6 | index numeric sort via transitionStatus |
| `create_task_bootstraps_tasks_dir_on_fresh_repo` | KEEP | TASK-009 AC7 | self-bootstrap |
| `backlog_seeder_no_longer_mkdirs_tasks` | KEEP | TASK-009 AC7 | source-grep negative: workaround removed |

**File verdict: KEEP ALL** — all 17 encode unique TASK-009 ACs not duplicated in task-store.spec.js (which covers TASK-001 ACs only).

---

### tests/e2e/new-task.spec.js (11 tests)

| spec name | verdict | AC / regression | justification |
|---|---|---|---|
| `next_key_is_highest_plus_one` | KEEP | TASK-002 AC2 | key derivation |
| `next_key_with_three_digit_padding` | KEEP | TASK-002 AC2 | boundary 999→1000 |
| `next_key_in_empty_store` | KEEP | TASK-002 AC2 | empty store |
| `next_key_ignores_non_task_files` | KEEP | TASK-002 AC2 | schema.json/index.json excluded |
| `created_task_conforms_to_schema` | KEEP | TASK-002 AC1 | AJV round-trip + field spot-check |
| `created_at_and_updated_at_use_injected_now` | KEEP | TASK-002 AC1 | now-injection contract |
| `defaults_applied_when_omitted` | KEEP | TASK-002 AC1 | defaults shape |
| `rejects_empty_acceptance_criteria` | KEEP | TASK-002 AC1 | schema minItems guard |
| `rejects_invalid_priority` | KEEP | TASK-002 AC1 | priority enum guard |
| `index_is_regenerated_and_includes_new_task` | KEEP | TASK-002 AC3 | index regen |
| `writes_go_through_atomic_write` (createTask) | KEEP | TASK-002 AC3 | two-phase atomic write for two files |

**File verdict: KEEP ALL** — createTask-specific AC2 key-derivation tests are unique here; the atomic-write spy tests a different path (createTask = two files) from the one in task-store.spec.js (transitionStatus = one file).

---

### tests/e2e/atomic-write.spec.js (3 tests)

| spec name | verdict | AC / regression | justification |
|---|---|---|---|
| `pause_atomic_write_temp_then_rename` | KEEP | TASK-004/TASK-010 AC4 | unique: tests *lifecycle pauseSession* path, not task-store |
| `crash_during_pause_recovered_on_next_read` | KEEP | TASK-004/TASK-010 AC4 | crash safety + sweepAndRecover |
| `rename_retries_on_EBUSY` | KEEP | TASK-010 AC4 | EBUSY retry: unique to lifecycle path |

**File verdict: KEEP ALL** — these test the LIFECYCLE atomic-write path (pauseSession/sweepAndRecover), which is distinct from the task-store path tested by the fs-spy tests in task-store.spec.js and new-task.spec.js.

---

### tests/e2e/verification-tier.spec.js (11 tests)

| spec name | verdict | AC / regression | justification |
|---|---|---|---|
| `schema_accepts_a_task_with_a_valid_tier_tdd` | MERGE→it.each | TASK-028 AC1 | collapse with 2 siblings into `it.each` per L7 |
| `schema_accepts_a_task_with_tier_tests_after` | MERGE→it.each | TASK-028 AC1 | see above |
| `schema_accepts_a_task_with_tier_uat_only` | MERGE→it.each | TASK-028 AC1 | see above |
| `schema_still_accepts_a_task_without_verification_tier` | KEEP | TASK-028 AC1 | backward-compat, distinct concern from enum values |
| `schema_rejects_an_invalid_tier_value` | KEEP | TASK-028 AC1 | negative test, distinct |
| `createTask_persists_verification_tier_when_provided` | KEEP | TASK-028 AC1 createTask | persistence |
| `createTask_omits_verification_tier_when_not_provided` | KEEP | TASK-028 AC1 createTask | absence-not-null |
| `createTask_rejects_an_invalid_tier` | KEEP | TASK-028 AC1 createTask | rejection + no-write |
| `tier_flag_lands_in_created_task_json` | KEEP | TASK-028 AC5 CLI | --tier flag |
| `bogus_tier_flag_throws` | KEEP (strengthen) | TASK-028 AC5 CLI | N9: match /tier/i |
| `create_task_with_verification_tier_persists_it` | KEEP | TASK-028 AC5 MCP | MCP tier round-trip |

**File verdict: MERGE 3→1 (it.each on enum values). All others KEEP.**

---

### tests/e2e/backlog-seeder.spec.js (14 tests)

All 14 tests map 1:1 to TASK-014 ACs 1–7 (with AC2's 5 use-case subtests). No duplicates with hardening suite (hardening focuses on AC1–7 edge cases, not these happy paths). KEEP ALL.

---

### tests/e2e/backlog-seeder-hardening.spec.js (8 tests)

All 8 map to TASK-017 ACs 1–4 and 6–7. AC5 is in its own file (hardening-init). No duplicates. KEEP ALL.

---

### tests/e2e/backlog-seeder-hardening-init.spec.js (1 test)

Single test for TASK-017 AC5 (init.js warn-and-rethrow with vi.mock). Isolated for hoisting reason. KEEP.

---

### tests/e2e/task-018-corruption-policy.spec.js (4 tests)

All 4 map to TASK-018 ACs 1–4. AC1/AC2 test corruption throw-before-archive (unique behavior). AC3/AC4 are source-greps for docstring policy. KEEP ALL.

---

### tests/e2e/init.spec.js (13 tests)

All 13 map to TASK-012/TASK-015 ACs. The four-branch state machine, robustness cases, and the CLAUDE.md routing-section check are all unique. KEEP ALL.

---

### tests/e2e/init-command.spec.js (8 tests, 1 skipped)

All tests map to TASK-013 ACs. The skipped manual sensor for `claude` CLI is documented. KEEP ALL.

---

### tests/e2e/agent-generator.spec.js (17 tests)

All map to TASK-019/TASK-020 ACs for project-context.md generation and agent copying. KEEP ALL.

---

### tests/e2e/make-template.spec.js (15 tests)

All map to publish/template scrub workflow. KEEP ALL.

---

### tests/e2e/plugin-deps.spec.js (26 tests)

All map to TASK-023 AC1/bundling. The DOC probe (`only_an_adjacent_up_tree_node_modules_resolves_ESM`) is a **runtime-fact documentation test** written deliberately per the ticket to motivate the esbuild decision — annotated as `DOC` in the describe label. KEEP: this is a documented design-decision sensor, not a library probe. KEEP ALL.

---

### tests/e2e/question-engine.spec.js (16 tests)

All map to TASK-007/TASK-008 ACs. KEEP ALL.

---

### tests/e2e/lifecycle.spec.js (6 tests)

All map to TASK-003/TASK-004 lifecycle ACs. KEEP ALL.

---

### tests/e2e/lifecycle-polish.spec.js (6 tests)

Maps to TASK-010 polish ACs. KEEP ALL.

---

### tests/e2e/pointer.spec.js (3 tests)

Maps to TASK-004 pointer ACs. KEEP ALL.

---

### tests/e2e/mcp-server.spec.js (8 tests)

All map to TASK-026 AC1/AC3. KEEP ALL.

---

### tests/e2e/project-md.spec.js (6 tests)

Maps to TASK-013 ACs. KEEP ALL.

---

### tests/e2e/project-md-hardening.spec.js (8 tests)

Maps to TASK-016 ACs 1–5. KEEP ALL.

---

### tests/e2e/project-schema.spec.js (3 tests)

Maps to TASK-020 project schema ACs. KEEP ALL.

---

### tests/e2e/repo-root.spec.js (13 tests)

Maps to TASK-022 ACs. KEEP ALL.

---

### tests/e2e/publish-scrub.spec.js (5 tests)

Maps to publish scrub workflow. KEEP ALL.

---

### tests/e2e/bundle-shape.spec.js (3 tests)

Maps to TASK-023 bundling shape ACs. KEEP ALL.

---

### tests/e2e/round-trip.spec.js (2 tests)

Maps to state-read round-trip ACs. KEEP ALL.

---

### tests/e2e/inspection.spec.js (2 tests)

Maps to state inspection ACs. KEEP ALL.

---

### tests/e2e/summary.spec.js (2 tests)

Maps to lifecycle summary ACs. KEEP ALL.

---

### tests/e2e/knowledge-lookup.spec.js (3 tests)

Maps to knowledge-store lookup ACs. KEEP ALL.

---

### tests/e2e/framework-history.spec.js (5 tests)

Maps to TASK-015 framework-history detection ACs. KEEP ALL.

---

### tests/e2e/new-task-cli.spec.js (6 tests)

Maps to TASK-024 new-task CLI ACs. KEEP ALL.

---

### tests/e2e/claude-md-init.spec.js (6 tests)

Maps to TASK-025 claude-md init ACs. KEEP ALL.

---

### tests/e2e/intake-e2e.spec.js (1 test)

Maps to intake end-to-end smoke. KEEP.

---

### tests/e2e/e2e-install.spec.js (1 test, 1 skipped)

Skipped manual CLI sensor (documented). KEEP.

---

### tests/plugin-scaffold.spec.js (16 tests, 1 skipped)

All map to TASK-021 AC1–AC4. The `plugin_version_is_pinned_for_publish` spec in AC1 is NOT superseded by publish-config.spec.js — it only asserts a version EXISTS (any string), while publish-config asserts the exact value `0.1.1`. Complementary, not duplicate. The skipped manual sensor KEEP. KEEP ALL.

---

### tests/publish-config.spec.js (10 tests)

Maps to TASK-027 AC3 (exact version + marketplace shape + no-dangling + cross-manifest). KEEP ALL.

---

### tests/agents-parity.spec.js (3 tests)

Maps to TASK-021 AC5 drift guard. KEEP ALL.

---

### tests/orchestrator-agent-v2.spec.js (9 tests)

Maps to TASK-025 AC4 orchestrator v2 contract. KEEP ALL.

---

### tests/orchestrator-routing-skill.spec.js (6 tests)

Maps to TASK-025 AC3 backstop skill. KEEP ALL.

---

### tests/mcp-config.spec.js (8 tests, 1 skipped)

Maps to TASK-026 AC2 MCP config. Skipped manual sensor KEEP. KEEP ALL.

---

### tests/mcp-server-skill.spec.js (4 tests)

Maps to TASK-026 skill parity. KEEP ALL.

---

### tests/mcp-scope-docstring.spec.js (3 tests)

Maps to TASK-026 AC4 scope boundary docstring. KEEP ALL.

---

### tests/verification-policy-docs.spec.js (6 tests)

Maps to TASK-028 AC1–AC4 doc layer. L8 drift guard will be ADDED here in Phase 3. KEEP ALL.

---

### tests/agent-models.spec.js (5 tests)

Maps to TASK-031 AC1–AC4 per-agent model assignment. KEEP ALL.

---

### tests/claude-md-merge.spec.js (7 tests)

Maps to TASK-025 AC1–AC2 claude-md merge pure-function. KEEP ALL.

---

### tests/question-library.spec.js (6 tests)

Maps to TASK-011 AC1–AC3. KEEP ALL.

---

### tests/readme.spec.js (6 tests)

Maps to TASK-015 AC1 README. KEEP ALL.

---

### tests/quickstart-docs.spec.js (4 tests)

Maps to TASK-027 AC2 quickstart docs. KEEP ALL.

---

### tests/knowledge-files.spec.js (5 tests)

Maps to TASK-010/TASK-011 knowledge-store ACs. KEEP ALL.

---

### tests/docs.spec.js (2 tests)

Maps to TASK-010 AC11 docs. KEEP ALL.

---

### tests/live-state.spec.js (1 test)

Maps to TASK-004 drift guard (live state validates against schemas). KEEP.

---

## Summary

| verdict | count | notes |
|---|---|---|
| KEEP | 358 | all tests not in MERGE category |
| MERGE | 3 | the three `schema_accepts_a_task_with_tier_*` specs in verification-tier.spec.js → collapsed into `it.each` |
| DELETE | 0 | no tests deleted |

**Spec count:** 365 before → 363 after (3 merged into 1 `it.each` = net -2 `it()` blocks; file count unchanged at 51).

**Phase 3 additions:**
- L7: `it.each` for the 3 enum-accepts tests (net -2 specs in verification-tier.spec.js).
- L8: 1 new drift guard spec in tests/verification-policy-docs.spec.js (net +1).
- N9: strengthen `bogus_tier_flag_throws` to match `/tier/i`.
- N10 + orchestrator.md: agent prompt polish (no spec count change).

**Net spec delta: -2 + 1 = -1 spec** (364 → 363 after all phases).

---

*Generated by TASK-033 consolidation pass, 2026-06-11.*
