---
name: impl-block-tasks
description: Generate the BLOCK_TASKS manifest — every work block broken into concrete developer tasks with testable + observable acceptance criteria, dependencies, and blocking gaps. Load when decomposing an epic/block into tickets. Vendored Spine skill, gated by verification_tier (src/manifest-policy.js).
---

## Sources & gate (hivemind)

Vendored from implementation-engine. In hivemind the "context" this skill reads is the project's
knowledge surface — `PROJECT.md`, the wisearcher brain graph (`kb_search`/`kb_answer`, or the local
`knowledge/` KB when the brain is offline), and the ticket's scope + acceptance criteria. Where the
body below refers to `context/<file>.md`, read the equivalent from that surface. Output goes to
`implementation/BLOCK_TASKS.md`.

**Gate:** required for **core** tickets (`verification_tier` tdd / tests-after), **skipped** for
`uat-only` glue — see `src/manifest-policy.js` (`requiresManifest`). Generate/update it BEFORE code;
the reviewer treats a missing required manifest as a HIGH finding. Preserve epistemic markers
(`[EXPLICIT]`/`[INFERRED:strong|weak]`/`[ASSUMED]`) and respect source tiers.

---

# impl-block-tasks

Generates `implementation/BLOCK_TASKS.md` — every work block (B-01..B-20) broken into concrete developer tasks.

## Read first

Read these files from `context/` (and only from `context/`):
- `context/estimation.md` — B-01..B-20 definitions, effort ranges (O/B/P), category (A/B/C), complexity drivers
- `context/technical.md` — architecture context needed to define tasks meaningfully
- `context/gaps.md` — open gaps (G-##, GT-##) that affect specific blocks

## Output: `implementation/BLOCK_TASKS.md`

One section per block (B-01 through B-20, in order). For each block:

```markdown
## B-## — <Block Name>

**Phase**: P#
**Category**: A / B / C
**Effort**: O=# / B=# / P=# person-days
**Complexity**: <Low | Medium | High>

### Tasks
- [ ] <Concrete developer task — specific enough to be a ticket>
- [ ] <Next task>
- [ ] ...

### Acceptance criteria
- <Observable, **testable** outcome — phrased so a test-first (red-green) test can assert it>
- <Observability: emits span `<feature.action>`; errors logged; latency metric if a key path>
- ...

### Dependencies
- Requires: B-## <reason>, B-## <reason>
- Blocks: B-## <reason>

### Blocking gaps
- G-## / GT-## — <what is unknown and how it affects this block>
- [MISSING_INFO] if a required input has no gap ID yet

### Notes
<Any clarifying context: re-estimation triggers, conditional scope items (C-##) that expand this block, or assumptions made>
```

## Rules

- Acceptance criteria must be **testable** (they become test-first tests — see
  `.claude/shared/TDD.md`) and each must carry its **observability** requirement
  (`.claude/shared/OBSERVABILITY.md`). UI tasks reuse **canonical components**
  (`.claude/shared/UI_CONSISTENCY.md`) — never re-implement a shared input.
- Tasks must be concrete ("Implement campaign list endpoint call and render results") not vague ("Build campaigns screen").
- Category C blocks should be listed but marked clearly as **not estimable** — list known tasks and mark unknowns with `[MISSING_INFO]`.
- Preserve effort ranges exactly as they appear in the estimation context — do not recalculate.
- Link every gap (G-##) that affects a block using the IDs from `context/gaps.md`.
- If a block's scope is expanded by a conditional item (C-##), call it out in Notes — do not include the conditional work in the base task list.

## After writing

Report: total blocks documented, blocks with blocking gaps, blocks marked Category C, total base effort (sum of B values across all blocks).
