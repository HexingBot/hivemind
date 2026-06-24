---
module: spine-discipline
layer: canonical
tier: T1
updated: 2026-06-24
files: [.claude/skills/, tasks/schema.json]
---

## Purpose
The Spine = wisengine's discipline vendored into hivemind as skills + validators: calibrated markers,
source tiering, language-agnostic manifests (tier-gated), observability, and minimalism. Design
intent from decision 005. `proposal-engine` is NOT vendored — it stays a standalone upstream app.

## Decisions
- **Vendor, don't call** (except proposal-engine): implementation-engine logic, engine-tools
  validators (`validate_markers`/`validate_tiers`), and wisengine standards become hivemind skills/
  prompts. [INFERRED:strong] (decision 005)
- **Markers on tasks**: extend `tasks/schema.json` with `marker` + `source_tier` + `confidence`
  (components, not a scalar). The reviewer blocks assumption laundering. [INFERRED:strong] (decision 005)
- **Tier-gated specs**: core/`tdd` tickets generate/update a language-agnostic manifest before code;
  `uat-only` glue skips it. An independent verifier checks cross-artifact coverage. [INFERRED:strong] (decisions 003, 005)

## Patterns
The base already grades work with a fresh-context reviewer + HIGH/MEDIUM/LOW severity and the
`tdd`/`tests-after`/`uat-only` tiers. [EXPLICIT] (`.claude/agents/reviewer.md`, `CLAUDE.md`)
The Spine adds: marker/tier validation, manifest generation, an independent verifier role, and the
observability + minimalism review rules. [INFERRED:strong] (decision 005)

## Constraints
- A `tdd`-tier ticket cannot pass review with a laundered (marker-dropped) claim. [INFERRED:strong] (decision 005)
- `[EXPLICIT]` requires T1/T2; `[INFERRED:strong]` requires T2+ (tier ceiling). [EXPLICIT] (`.knowledge/meta/SOURCE_TIERS.md`)
- Generated product code must emit OTel span + log per functionality (review BLOCKER if missing). [INFERRED:strong] (decision 005; conventions ## Observability)

## Interfaces
- Existing base tiers/reviewer: reused as-is. [EXPLICIT] (`CLAUDE.md`)
- New (proposed): `tasks/schema.json` marker/tier/confidence fields; ported `validate_markers`/
  `validate_tiers`; manifest-generation skills (SCREEN_SPECS, API_CONTRACTS, STATE_SCHEMAS,
  COMPONENT_CATALOG, PROJECT_STRUCTURE, BLOCK_TASKS). [ASSUMED]

## Files
- `.claude/skills/<spine-*>/SKILL.md` — vendored standards (to be created). [MISSING_INFO]
- `tasks/schema.json` — to be extended with calibration fields. [EXPLICIT] (exists today)
