---
id: set-source-tier-at-task-creation-not-review
problem: >-
  A newly created task JSON is a mandated calibration surface
  (isMandatedTierSurface), but the Orchestrator often mints tickets without a
  source_tier. check:calibration only runs at FULL review, so the omission stays
  invisible through decomposition, the Developer spawn, and implementation, then
  surfaces as a HIGH blocker at the close review — an avoidable REQUEST-CHANGES
  loop for a pure metadata gap with nothing to do with the delivered code.
symptoms:
  - >-
    check:calibration emits "[BLOCKER] source_tier missing from a mandated
    surface" against an active (non-done) task file
  - >-
    A code-clean review is forced to REQUEST-CHANGES solely on ticket metadata,
    not on any code defect
  - >-
    The task file is the only active ticket lacking source_tier while its
    siblings all carry one (done siblings are grandfather-exempt, masking the
    gap)
solution: >-
  Assign source_tier when the ticket is created (Workflow step 1/2), the same
  moment verification_tier is set — not at review. Pick the tier from the
  LOWEST-authority source that materially grounds the ticket per
  .knowledge/meta/SOURCE_TIERS.md: T1 when extending existing executable
  source/manifest; T2 for a committed schema/config OR a ratified
  design-of-record spec (the design-of-record exception rates an approved spec
  doc as T2-equivalent). TASK-125 derived from the human-approved
  docs/design/design-profile-spec.md, so T2 was correct even though 15 sibling
  tasks use T1. The done-status grandfather exemption means a survey of closed
  tickets will not reveal the omission — check active tickets.
tags:
  - calibration
  - source-tier
  - process
  - ticket-metadata
  - review-gate
projects:
  - hivemind
source_tier: T2
created_at: '2026-07-08T21:09:38.970Z'
last_seen_at: '2026-07-08T21:09:38.970Z'
---
## Why it happens
The calibration gate is a review-time sensor, not a creation-time one. A task file is a mandated tier surface, but nothing forces source_tier at `create_task`. The done-status grandfather exemption then hides the omission from any survey of closed tickets, so the gap only ever shows up as a late HIGH at the close review — the most expensive place to catch a one-line metadata fix.

## The general lesson
Metadata a review gate mandates should be set at the moment the artifact is created, not discovered at the gate. For hivemind tickets that means assigning `source_tier` alongside `verification_tier` in Workflow step 1/2. Choose it from the lowest-authority contributing source per SOURCE_TIERS.md; a ratified design-of-record spec counts as T2-equivalent even when the surrounding convention defaults to T1.

## Detection
Run `npm run check:calibration -- tasks/<KEY>.json` at ticket creation, not just at review. A clean result there closes the gap before any Developer spawn.
