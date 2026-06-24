---
module: skills/updater
updated: 2026-06-24
files: []
---

## Purpose
Instructions for the updater agent — keeps the KB in sync as design intent becomes real source.

## How to approach this task

1. **Read the relevant knowledge files first**: use `read_knowledge_base` to load the module you
   are updating, plus [[architecture]] and [[conventions]] for cross-cutting constraints.
2. **Search for prior patterns**: use `search_knowledge` to find every place the changed concept is
   described, so an update in one file does not leave a stale claim in another.
3. **Re-derive, don't copy**: when code lands for a previously design-only claim, read the new
   source, re-derive the fact, cite `path:line`, and flip the marker from [INFERRED:strong] to
   [EXPLICIT]. Update the file's `tier` and `files:` frontmatter to match the real source.
4. **Preserve markers downstream**: when propagating a claim from canonical → derived, carry its
   marker; dropping it is assumption laundering ([[meta/guardrails]] KG2).
5. **Sweep for staleness**: when a file/symbol is renamed or removed, fix every citation that
   referenced it (KG6); record genuinely rejected material in [[meta/source-tiers]] § TX.
6. **Verify**: after writing, run `verify_knowledge` and resolve every BLOCK before declaring done.

## Anti-patterns
- Do not proceed without reading the constraints sections of affected modules.
- Never skip the implementation order — dependencies must exist before dependents.
- Do not read raw source files for *planning*. Use `read_knowledge_base` and `search_knowledge`.
  (Reading source is permitted only to *re-derive* an [EXPLICIT] citation once code exists.)
- Do not skip `write_plan`. A plan described in conversation but not written to `PLAN.md` is not a plan.
- Do not leave a claim [EXPLICIT] after its cited source was deleted — downgrade or remove it.
