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

## Rules
- Always set `tier` on every canonical and derived file.
- Never raise a claim above its file's tier: [EXPLICIT] requires T1/T2; [INFERRED:strong] requires T2+.
- Record TX (rejected/dead) material here with the reason it was excluded.

## TX (rejected) material
- <none yet>
