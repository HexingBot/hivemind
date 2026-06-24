---
module: skills/planning
updated: 2026-06-24
files: []
---

## Purpose
Instructions for the planning agent (the Body's orchestrator/planning role) using this knowledge base.

## How to approach this task

1. **Read the relevant knowledge files first**: use `read_knowledge_base` to load [[architecture]]
   and [[conventions]], and re-read PLAN.md — the design-of-record that gates all code.
2. **Search for prior patterns**: use `search_knowledge` with the concept you are planning around.
3. **Plan in PLAN.md before any code**: update the relevant `.knowledge/` files to reflect design
   intent, then call `write_plan`. A plan only described in conversation does not satisfy the gate.
4. **Assign a verification tier to every ticket**: choose `tdd` / `tests-after` / `uat-only` by risk;
   tier-gating drives whether a manifest precedes code (see [[conventions]] Patterns).
5. **Honor the phased build**: respect PLAN.md's phase order (0 identity → 1 brain seam → 2 truth on
   tasks → …). Phase/consolidation gates are hard-stops, not suggestions.
6. **Carry calibration onto tickets**: ticket ACs should carry `marker` + `source_tier` + `confidence`
   (Phase 2) so the reviewer can block assumption laundering downstream.
7. **Surface open questions**: leave PLAN.md's open questions visible; do not resolve them silently
   with [ASSUMED] claims dressed as decisions.

## Anti-patterns
- Do not proceed without reading the constraints sections of affected modules.
- Never skip the implementation order — dependencies must exist before dependents.
- Do not read raw source files. Use `read_knowledge_base` and `search_knowledge` only.
- Do not skip `write_plan`. A plan described in conversation but not written to `PLAN.md` is not a plan.
- Do not promote a design sketch to [INFERRED:strong] until it is a ratified locked decision.
