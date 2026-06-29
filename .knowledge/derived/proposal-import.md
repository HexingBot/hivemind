---
module: proposal-import
layer: derived
tier: T2
updated: 2026-06-24
files: []
---

## Purpose
How `proposal-engine`'s output feeds hivemind's canonical graph. Resolves PLAN.md open question
*"How proposal-engine's KBs feed hivemind's graph (import path / format)."* proposal-engine stays
a **standalone** producer (decision 5); hivemind **imports** its `project_knowledge_base/` rather
than vendoring the engine. Grounded in the real proposal KB at
`/home/escuok-ai/code/wisengine/proposal-engine/project_knowledge_base/`.

## Input shape (what proposal-engine emits)
[INFERRED:strong] (signal: `proposal-engine/project_knowledge_base/`, a sibling repo)
- **All markdown**, two layers: **canonical** (`contexts/` 11 files, `relations/`
  {traceability_matrix, gaps, rejected}.md, `discovery/`) + **derived** (`estimation/`,
  `deep_dive/`, `audit/`, `consolidation/`, `proposal/`, `reviews/`).
- **Frontmatter** is light prose, not YAML: `**Layer**: Canonical|Derived`, `**Source**: raw/`
  or `**Depends on**: …`, optional `**Phase**: F1–F6`, `**Status**`.
- **Inline epistemic markers** identical to hivemind's: `[EXPLICIT]`, `[INFERRED:strong|weak]`,
  `[ASSUMED]`, `[MISSING_INFO]`; citations as `path:line` / `path#section`.
- **Source tiers T1–TX** and **PG# guardrails** defined in `proposal-engine/CLAUDE.md` (T1–T4 +
  TX; PG1–PG6). IDs embedded in body text: `OBJ-##`, `R##`, `ADR-##`, `G-T##`, `DT##`, `H-##`.
- **No machine-readable manifest, no content hashes** — versioning is git + `.logs/`.

## Import = deterministic markdown→graph, NOT re-extraction
The proposal KB is **already structured and marked**. Re-running wisearch's LLM claim-extraction
on it would risk **dropping markers** (assumption laundering, PG3/[[meta/guardrails]] KG2) and cost
tokens. Decision: a **deterministic importer** parses frontmatter + inline markers and writes
graph nodes directly via the `kb_assert` brain tool, **preserving each marker verbatim**. [INFERRED:strong]

## Mapping into the wisearch graph schema
| Proposal KB element | → Graph |
|---------------------|---------|
| Each KB file | a **Source** node (`origin`=repo-relative path, `kind`="file", `title`=H1, `credibility` from file tier) |
| Each marked statement | a **Claim** node (`text`, `confidence` from marker×tier below), **CITES** its Source |
| Embedded IDs (`OBJ-##`, `R##`, `ADR-##`…) | **Entity** nodes (`type`=Objective/Risk/Decision…), Claims **MENTION** them |
| `traceability_matrix.md` rows | **RELATION** edges (`predicate`="traces_to") between entities |
| `gaps.md` items | Gap **Entity** + Claims describing block status (`B1/B2`) |
| `rejected.md` items | recorded as **TX** provenance, not asserted as fact (mirror [[meta/source-tiers]] § TX) |

## Marker × tier → ConfidenceComponents
Maps proposal markers/tiers onto wisearch's decomposed confidence (signal:
`wisearch/wisearch/extract/models.py:80`):
- `[EXPLICIT]` → `assertion_strength`=ASSERTED; `source_credibility` from tier (T1≈1.0, T2≈0.8).
- `[INFERRED:strong]` → ASSERTED, lower credibility / needs corroboration.
- `[INFERRED:weak]` → HEDGED.
- `[ASSUMED]` → HEDGED, low credibility, flagged as assumption.
- `[MISSING_INFO]` → **not ingested as a claim**; recorded as a gap.
- **Tier ceiling enforced**: a `[EXPLICIT]` on a T3 source is downgraded on import (proposal-engine
  rule, `CLAUDE.md`), never laundered upward.

## Import path
- A hivemind importer (`kb_import_proposal`, or a `kb_ingest` variant) takes the
  `project_knowledge_base/` **directory path** as input and records the batch under a topic =
  the client/proposal name; `Source KB:` provenance is preserved on every node. [INFERRED:strong]
- Idempotent: re-import updates by deterministic `claim_id` (`make_claim_id`, signal:
  `wisearch/wisearch/extract/models.py:73`),
  so re-running after a proposal revision reconciles rather than duplicates. [INFERRED:strong]

## Open (deferred to build)
- Whether to import the derived layer (estimation/proposal) or only canonical contexts+relations. [INFERRED:weak]
- Exact predicate vocabulary for traceability edges. [MISSING_INFO]
