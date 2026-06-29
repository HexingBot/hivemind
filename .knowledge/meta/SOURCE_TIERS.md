---
module: meta/source-tiers
layer: meta
updated: 2026-06-24
files: []
---

## Purpose
Source tiers rank the authority of the evidence behind a claim and cap how strong a marker may be.
A canonical/derived file's `tier` frontmatter is the marker ceiling for every claim in it, set by
the **lowest-authority** source that materially contributes.

## Tier table (code-derived KB)
| Tier | What qualifies | Marker ceiling |
|------|----------------|----------------|
| T1 | Executable source that compiles/runs; the manifest (package.json) | [EXPLICIT] |
| T2 | Tests, type definitions, committed schema/config | [EXPLICIT] / [INFERRED:strong] |
| T3 | Comments, docstrings, naming conventions | [INFERRED] only |
| T4 | README prose, commit messages, external docs | context only, never a claim |
| TX | Dead / rejected code | recorded here, never the basis of a claim |

## Design-of-record exception (pre-implementation)
hivemind currently has **no executable source** — the KB describes design intent ahead of code.
While in this state:
- The **design-of-record** (an accepted `PLAN.md` and the locked decisions it ratifies) acts as a
  **T2-equivalent** ceiling: claims may reach **[INFERRED:strong]** when they cite a specific PLAN
  section/decision as the signal.
- **[EXPLICIT] is unreachable** until matching executable source exists. When code lands, re-derive
  the claim from the source, cite `path:line`, and only then flip the marker to [EXPLICIT].
- Design prose that is *not* ratified (sketches, options under debate) stays [INFERRED:weak] /
  [ASSUMED] / [MISSING_INFO].

## Rules
- Always set `tier` on every canonical and derived file.
- Never raise a claim above its file's tier: [EXPLICIT] requires T1/T2; [INFERRED:strong] requires
  T2+ (or the design-of-record exception above).
- Record TX (rejected/dead) material here with the reason it was excluded.

## TX (rejected) material
- **proposal-engine bundling** — rejected. It stays a separate standalone app (optional upstream
  producer of proposal KBs), never vendored into hivemind. (PLAN.md decision 5)
- **`git merge upstream/main` for template sync** — rejected pattern inherited from the wisengine
  workspace: unrelated histories cause duplicates + template-only leakage. Not a basis for any
  hivemind claim.
- **Local `knowledge-graph.js` as source of truth** — demoted, not deleted: it becomes a thin
  cache/projection over wisearch's canonical Neo4j+Qdrant graph. (PLAN.md decision 2)
