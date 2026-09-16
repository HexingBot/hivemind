---
module: skills/planning
updated: 2026-09-16
files: []
---

## Purpose
Instructions for the planning agent (the Body's orchestrator/planning role) using this knowledge base.

## How to approach this task

1. **Read the relevant knowledge files first**: use `read_knowledge_base` to load [[architecture]]
   and [[conventions]], and re-read PLAN.md — the design-of-record that gates all code.
2. **Search for prior patterns**: use `search_knowledge` with the concept you are planning around.
3. **Plan in PLAN.md before any code**: update the relevant `.knowledge/` files to reflect design
   intent, then call `write_plan`. A plan only described in conversation does not satisfy the gate.
4. **Define the use cases and the paths of use — this is step 1 of the flow, and it is YOURS**
   (2026-09-16 human decision). Before dispatching any implementation, turn the acceptance criteria
   into a plain-text list of "do X, expect Y" cases that enumerates the **paths**, not just the happy
   one: what the user does, what is expected, and which alternative/failure paths run through the
   change. Derive it from the ticket, **never from the code, and never delegate it to the
   implementer** — a test written by the same agent that wrote the implementation confirms that
   agent's belief, not the requirement. This list replaces tests-first outright, travels in the
   implementer's briefing, and is reused unchanged as the UAT script when UAT is needed. If the
   implementer needs to change a case to make it pass, that escalates to the human.
   **Creating the list is mandatory and the human approves it before implementation starts** — a hard
   stop, not a courtesy: present the numbered list, wait for an explicit approval, record it on the
   ticket, and only then dispatch. The approval exists up front because the approved list is exactly
   what the wargaming pass verifies the finished change against.
   **De dónde salen los casos: del PEDIDO, con la forma de `docs/PLANTILLA-PEDIDO.md`** (2026-09-16,
   "vamos a reforzar la entrada del pedido y la salida"). Recogé el pedido con esa plantilla, o
   completá contra ella lo que el humano ya contó en prosa y devolvé el completado para que lo
   confirme — un pedido en prosa suelta nunca se rechaza, y un bloque que no se puede completar sin
   suponer se pregunta en vez de rellenarse. Después derivá con su tabla de mapeo: bloque 4 (caminos
   y acciones esperadas) → un caso por camino, alternativos y de fallo incluidos; bloque 5 (criterios
   de "hecho") → el "espera Y"; bloque 6 (restricciones) → los casos negativos. Un bloque 4 vacío, o
   que sólo repite los criterios de aceptación, es el hueco a cerrar con el humano ANTES de
   despachar. La otra punta, al cierre, es `docs/PLANTILLA-ENTREGA.md`.
5. **Assign a verification tier — sizing only, never a gate**: `tests-after` (the default) or
   `uat-only`. `tdd` is ELIMINATED and cannot be assigned. The tier says how much regression locking
   the change earns *after* it works; it never says when verification happens. Verification of record
   is the **wargaming** pass at the end of the flow — plan for it explicitly, and plan the affected
   e2e specs to RUN there rather than at hand-off (see [[conventions]] Patterns).
6. **Honor the phased build**: respect PLAN.md's phase order (0 identity → 1 brain seam → 2 truth on
   tasks → …). Phase/consolidation gates are hard-stops, not suggestions.
7. **Carry calibration onto tickets**: ticket ACs should carry `marker` + `source_tier` + `confidence`
   (Phase 2) so the reviewer can block assumption laundering downstream.
8. **Surface open questions**: leave PLAN.md's open questions visible; do not resolve them silently
   with [ASSUMED] claims dressed as decisions.

## Anti-patterns
- Do not proceed without reading the constraints sections of affected modules.
- Never skip the implementation order — dependencies must exist before dependents.
- Do not read raw source files. Use `read_knowledge_base` and `search_knowledge` only.
- Do not skip `write_plan`. A plan described in conversation but not written to `PLAN.md` is not a plan.
- Do not promote a design sketch to [INFERRED:strong] until it is a ratified locked decision.
- **Never plan a tests-first step.** TDD is eliminated; there is no tier, phase, or manifest that
  legitimises writing tests before the behavior exists.
- **Never let the implementer derive its own cases.** That is the authorship defect the use-case /
  paths-of-use step exists to close.
- **Never dispatch implementation on use cases the human has not approved.** No list, or a list with
  no recorded human approval, means no implementation.
- **Never plan a close without a wargaming pass.** A green review is not the verification of record.
- **Never invent an intermediate process step.** El medio del desarrollo es libre (2026-09-16): las
  únicas tres obligaciones son el pedido estructurado, los casos de uso aprobados y el wargaming
  final. Pedir un artefacto de proceso que ninguna de las tres exija es reintroducir el gate por
  proceso que esta política elimina, con otro nombre.
- **Never deliver without the output shape.** El cierre sigue `docs/PLANTILLA-ENTREGA.md`: casos
  aprobados con su estado final, resultado, reporte del wargaming, y UAT o la línea explícita de que
  no se pidió. Un bloque completado con "OK" se lee después como trabajo verificado sin estarlo.
