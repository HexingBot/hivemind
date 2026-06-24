---
module: decisions/005-spine-vendored-proposal-standalone
layer: derived
tier: T2
updated: 2026-06-24
files: []
---

## Decision
wisengine's discipline is **vendored into hivemind** as skills + validators (implementation-engine logic, engine-tools `validate_markers`/`validate_tiers`, manifests, observability, minimalism). The **exception is `proposal-engine`, which stays a standalone app** (an optional upstream producer of proposal KBs), not folded in.

## Status
Accepted

## Context
The Spine could be brought in by vendoring its standards, by calling the engines as separate services, or by reimplementing fresh. Separately, the question was what happens to the existing engine repos.

## Rationale
The Spine standards are prompt/skill-level — vendoring them needs no runtime coupling and keeps the plugin self-contained, while reusing battle-tested wording and the existing validators. proposal-engine, however, is a distinct front-door workflow (docs → proposal) many users want standalone; folding it in would bloat hivemind and lose that use case.

## Consequences
- Easier: one self-contained plugin for the build pipeline; proposal work still available on its own.
- Trade-off: implementation-engine effectively gets absorbed (its repo role ends); vendored standards must be kept in step with their wisengine origins; `tasks/schema.json` must gain calibration fields.
