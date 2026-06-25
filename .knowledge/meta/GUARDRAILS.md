---
module: meta/guardrails
layer: meta
updated: 2026-06-24
files: []
---

## Purpose
Named anti-patterns the Reviewer checks before finishing and the `verify_knowledge` tool enforces
where mechanically possible. BLOCK must be fixed before the KB is trusted; FLAG needs a human look.

## Guardrails
| ID | Anti-pattern | Severity | Checked by |
|----|--------------|----------|------------|
| KG1 | Fabrication — KB describes a module/behavior absent from source | BLOCK | citation existence (verify_knowledge) + reviewer |
| KG2 | Assumption laundering — a marker present in canonical is dropped in derived | BLOCK | reviewer (manual) |
| KG3 | Citation gap — [EXPLICIT] with no path / path:line | BLOCK | verify_knowledge |
| KG4 | Marker inflation — everything [EXPLICIT] or everything [INFERRED] | FLAG | verify_knowledge |
| KG5 | Single-source dependency — a critical claim rests on one ambiguous signal | FLAG | reviewer (manual) |
| KG6 | Staleness — KB cites a file/symbol that no longer exists | FLAG | verify_knowledge |

## How to use
Writer writes → Reviewer re-reads each file against this table → Verifier (`verify_knowledge`) runs
the mechanical checks. Do not skip the Reviewer pass for KG2/KG5 — they are not auto-detected.
