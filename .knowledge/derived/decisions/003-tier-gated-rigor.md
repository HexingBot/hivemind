---
module: decisions/003-tier-gated-rigor
layer: derived
tier: T2
updated: 2026-06-24
files: [tasks/schema.json]
---

## Decision
Rigor (markers, spec/manifest generation, depth of research) is **tier-gated** — it scales to the ticket's risk via the existing `verification_tier` (`tdd` / `tests-after` / `uat-only`), rather than applying full ceremony to everything or leaving it opt-in.

## Status
Accepted

## Context
wisengine + wisearcher discipline is powerful but heavy; applied uniformly it would smother the base's fast loop on trivial tickets. Applied only on opt-in, it would be skipped exactly where it matters.

## Rationale
The base already models "scale cost to risk" with verification tiers. Reusing that single knob to also gate marker discipline, manifest generation, and research depth keeps one coherent mental model: core/`tdd` work gets the full treatment; `uat-only` glue stays light.

## Consequences
- Easier: velocity on glue, rigor on core; one familiar control surface.
- Trade-off: tier assignment becomes more load-bearing (it now gates spec + truth, not just tests); mis-tiering has a bigger cost, so the assignment rubric must be clear.
