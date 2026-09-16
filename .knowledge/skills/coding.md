---
module: skills/coding
updated: 2026-09-16
files: []
---

## Purpose
Instructions for the coding agent (the Body's `developer` role) using this knowledge base.

## How to approach this task

1. **Read the relevant knowledge files first**: use `read_knowledge_base` to load [[architecture]]
   (decisions, constraints) and [[conventions]] (patterns, observability), plus any module you will touch.
2. **Search for prior patterns**: use `search_knowledge` with the concept you are working on; prefer
   reusing an established pattern over inventing one.
3. **Follow the verification flow — there is no tier gate and no TDD** (2026-09-16 human decision).
   Never write tests before the behavior exists; `tdd` is eliminated and unassignable. The order is:
   the Orchestrator's use-case / paths-of-use definition arrives in your briefing, **already approved
   by the human** (no list or no recorded approval means you do not start: return that fact instead of
   an implementation) → **implement** against those approved cases →
   **tests-after**, the *minimum necessary* regression locks, written only once you have proven the
   behavior by running it → **wargaming** (the adversarial pass, run by the team, and the real
   verification) → **UAT** if asked for or needed. The ticket's `verification_tier` only sizes step
   3: `tests-after` (default) earns minimal locks, `uat-only` glue earns none. Write e2e specs as
   `tests-after` when the change needs them, but **do not run them as part of your hand-off gate** —
   name them for the wargaming step instead. Your hand-off gate is `npm run test:changed` plus the
   fast tier (`npm test`).
4. **Define observability before code**: confirm the feature's logging/tracing/metrics are specified
   in [[conventions]] § Observability. Generated code must emit OTel spans/logs; brain calls must log
   whether they hit the canonical graph or the grep-KB fallback. No code for an unobserved feature.
5. **Respect the brain seam**: reach wisearcher only over MCP, and always provide the offline
   fallback path. Never set `ANTHROPIC_API_KEY`; spawn via the subscription CLI.
6. **Keep it minimal**: build the smallest thing that satisfies the AC (Ponytail minimalism); leave
   gold-plating for the reviewer to never have to flag.

## Anti-patterns
- **Never write a test before the implementation it checks.** TDD is eliminated; a tests-first pass
  reintroduced under any other name is a policy violation, not a stylistic choice.
- **Never pad the suite.** New specs are capped at the ticket's acceptance-criterion count, each must
  name the concrete harm it prevents, and each must encode an AC or a real regression. A large suite
  that proves nothing is the exact failure this policy exists to stop.
- **Never treat a green tier gate as verification.** Verification is the wargaming pass at the end.
- Do not proceed without reading the constraints sections of affected modules.
- Never skip the implementation order — dependencies must exist before dependents.
- Do not read raw source files. Use `read_knowledge_base` and `search_knowledge` only.
- Do not skip `write_plan`. A plan described in conversation but not written to `PLAN.md` is not a plan.
- Do not write a brain-dependent feature without its defined offline behavior.
- Do not couple the plugin to the brain by anything other than MCP.
