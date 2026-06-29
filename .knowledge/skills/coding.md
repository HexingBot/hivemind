---
module: skills/coding
updated: 2026-06-24
files: []
---

## Purpose
Instructions for the coding agent (the Body's `developer` role) using this knowledge base.

## How to approach this task

1. **Read the relevant knowledge files first**: use `read_knowledge_base` to load [[architecture]]
   (decisions, constraints) and [[conventions]] (patterns, observability), plus any module you will touch.
2. **Search for prior patterns**: use `search_knowledge` with the concept you are working on; prefer
   reusing an established pattern over inventing one.
3. **Honor the tier gate**: check the ticket's `verification_tier`. For core / `tdd` tickets, the
   relevant manifest must exist (and tests written) *before* code. For `uat-only` glue, skip the manifest.
4. **Define observability before code**: confirm the feature's logging/tracing/metrics are specified
   in [[conventions]] § Observability. Generated code must emit OTel spans/logs; brain calls must log
   whether they hit the canonical graph or the grep-KB fallback. No code for an unobserved feature.
5. **Respect the brain seam**: reach wisearch only over MCP, and always provide the offline
   fallback path. Never set `ANTHROPIC_API_KEY`; spawn via the subscription CLI.
6. **Keep it minimal**: build the smallest thing that satisfies the AC (Ponytail minimalism); leave
   gold-plating for the reviewer to never have to flag.

## Anti-patterns
- Do not proceed without reading the constraints sections of affected modules.
- Never skip the implementation order — dependencies must exist before dependents.
- Do not read raw source files. Use `read_knowledge_base` and `search_knowledge` only.
- Do not skip `write_plan`. A plan described in conversation but not written to `PLAN.md` is not a plan.
- Do not write a brain-dependent feature without its defined offline behavior.
- Do not couple the plugin to the brain by anything other than MCP.
