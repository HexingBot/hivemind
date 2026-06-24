---
module: decisions/004-subscription-cli-auth
layer: derived
tier: T2
updated: 2026-06-24
files: [.claude/skills/claude-headless/SKILL.md, tests/orchestrator-bridge.spec.js]
---

## Decision
All Claude access uses the **subscription CLI** (`claude -p` with `ANTHROPIC_API_KEY` stripped from the child env). No `anthropic` SDK dependency and no API-key path.

## Status
Accepted

## Context
The question was whether hivemind needs a separate Agent-SDK / API-key auth path. Inspection of the base showed it already spawns `claude -p` with `ANTHROPIC_API_KEY` deleted (tests assert its absence), and wisearcher does the identical thing. The "Agent-SDK credit allowance" is a usage bucket inside the Claude subscription, not an API key.

## Rationale
Both organs already converge on subscription auth, so adopting it is free, not a compromise. It fits a personal/local-first tool: no metered API cost, no second billing relationship. A separate API-key path would add code paths for no current benefit.

## Consequences
- Easier: zero new auth code; consistent across body + brain; no API bill.
- Trade-off: requires a logged-in `claude` CLI (and the claimed Agent-SDK credit); headless/CI without a logged-in CLI is out of scope until explicitly revisited.
