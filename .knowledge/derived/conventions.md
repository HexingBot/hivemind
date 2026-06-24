---
module: conventions
layer: derived
tier: T2
updated: 2026-06-24
files: [src/**/*.js, .claude/agents/*.md, .claude/skills/**/*.md]
---

## Purpose
Coding and process standards for hivemind. Non-negotiable. Two scopes are kept distinct:
**(A) hivemind's own code** (the Node plugin + the brain seam), and **(B) the product code
hivemind generates** for a user's project (governed by the vendored Spine standards).

## Agent Workflow
- **Knowledge-first — no code without a plan**: write/update `.knowledge/` then produce `PLAN.md`
  before any implementation. Hard gate.
- **Knowledge base only**: during planning/implementation read `.knowledge/` (`read_knowledge_base`,
  `search_knowledge`), never raw source. Source is for the compiler; `.knowledge/` is for agents.
- **Observability is non-negotiable**: a feature without defined observability (below) is not coded.
- **Docker over local installs**: Qdrant, Neo4j, and any service run via Docker — never host installs.
- **Tier-gated rigor**: scale discipline to risk via the `verification_tier` (`tdd`/`tests-after`/
  `uat-only`). Core work gets full markers + specs + research; glue gets a light touch. [INFERRED:strong] (decision 003)

## Observability
**(A) hivemind itself** (current scale — single operator, local):
- **Logging**: structured JSON to **stderr only** (stdout is reserved for MCP stdio). Always log:
  subagent spawn/return, each MCP call to the brain, brain-fallback activation, every gate block
  (marker/tier/review), and session lifecycle transitions. Correlate by `session_id` + ticket key.
- **Tracing**: full distributed tracing is **not required at hivemind's current scale**. The trace
  substitute is the session bundle `lifecycle.log` (append-only) plus `decision→task` edges in the
  knowledge graph. Revisit if hivemind ever runs multi-operator.
- **Metrics**: counters emitted to the log stream — tickets by terminal status, gate blocks by kind,
  brain calls vs. fallbacks, research rounds per mission. No external metrics backend at this scale.
- **Error reporting**: tool failures return MCP error responses; the plugin logs to stderr and
  **must not crash the session** — brain/service errors degrade to fallback with a logged message.

**(B) product code hivemind generates** (the vendored Spine standard, enforced at review):
- Every functionality emits an **OpenTelemetry span + a correlated structured log**; metrics on key
  paths only. Backend = **SigNoz** (recorded as an ADR in the target project). A missing span/log on
  any functionality is a review BLOCKER; a missing metric on a key path is a SHOULD. [INFERRED:strong] (decision 005; wisengine OBSERVABILITY standard)

## Patterns
- **One-way MCP boundary**: plugin (JS, client) → wisearcher (Python, MCP server). Never the reverse;
  never a second transport.
- **Graceful degradation**: every brain-dependent path has a defined offline behavior (fallback grep
  KB), chosen explicitly and logged — never a silent failure. [INFERRED:strong] (decision 006)
- **Markers travel**: a claim's calibration (`[EXPLICIT]`/`[INFERRED:strong|weak]`/`[ASSUMED]`/
  `[MISSING_INFO]`) is preserved end-to-end — from the brain's confidence components, onto task ACs,
  through specs, into review. Dropping a marker is "assumption laundering" and is a review BLOCKER.
- **Minimalism (Ponytail ladder)**: before building anything, walk necessity → stdlib → native
  feature → existing dep → one-liner → custom. Speculative abstractions are a review finding.
- **Error handling**: throw typed errors; catch at boundaries (MCP handlers, subagent edges); a
  service/brain failure becomes a fallback, never an uncaught crash.

## Decisions
- **Auth**: subscription CLI only (`claude -p`, key stripped). No `anthropic` SDK dependency, no API
  key path. [EXPLICIT] (`.claude/skills/claude-headless/SKILL.md`)
- **No new transport across JS↔Python**: MCP only. [INFERRED:strong] (decision 001)

## Constraints
- Never write to stdout from an MCP server (breaks the stdio protocol) — logs go to stderr.
- Never set `ANTHROPIC_API_KEY` in a spawned env.
- Never bypass the marker/tier/review gates on a `tdd`-tier ticket.
- Always keep `dist/*.cjs` rebuilt + committed when `bin/` or `src/` change (dist-parity gate).

## Files
```
src/          — hivemind plugin logic (Node): orchestration bridge, task store, graph bridge, brain client
.claude/      — agent definitions (developer/reviewer/researcher) + skills (vendored Spine standards)
dist/         — esbuild bundles (committed build artifacts)
.knowledge/   — this KB (canonical/derived/meta/skills); the only thing agents read while planning
```
