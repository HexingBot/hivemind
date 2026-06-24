---
module: decisions/007-plugin-front-door
layer: derived
tier: T2
updated: 2026-06-24
files: [LICENSE, NOTICE.md]
---

## Decision
The hivemind **plugin is the new front door**; the other tools are vendored libraries or called services. hivemind is built by **fork-and-extend** of agent-framework (MIT) at repo `wisemancer/hivemind` (private), with `origin`=hivemind and `upstream`=`lordiwa/agent-framework`. It is named **hivemind**.

## Status
Accepted

## Context
The unified framework could be founded as a fork-and-extend of agent-framework, a fresh repo vendoring pieces, or a thin orchestrator over four independent tools. A repo home (org/visibility) and a name were also needed.

## Rationale
agent-framework is the most complete harness (the Body); rewriting its runtime would waste effort, and the Spine/Brain are additive. A private mirror under `wisemancer` matches the other engine repos and keeps `upstream` so lordiwa's improvements can be pulled. MIT permits the derivative; LICENSE + NOTICE retain attribution.

## Consequences
- Easier: inherit a working runtime; pull upstream fixes; one installable plugin.
- Trade-off: carries the base's conventions; must track upstream; MIT attribution obligations (LICENSE/NOTICE) are permanent.
