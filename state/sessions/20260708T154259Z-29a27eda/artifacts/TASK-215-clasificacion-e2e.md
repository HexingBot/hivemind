# TASK-215 — Clasificación completa de tests/e2e/ contra los tres criterios de retiro

Fecha: 2026-09-10. Universo: los 110 archivos `tests/e2e/*.spec.js` medidos ese día
(el ticket decía 106; el recuento se rehízo antes de clasificar).

Criterios: (a) criterio de aceptación vivo — (b) daño nombrable sobre datos/estado/usuario —
(c) caso de uso de tests/use-cases/USE-CASES.md.
Regla: el default es KEEP; CANDIDATE exige que fallen los tres Y que exista un spec hermano
nombrado que cubra el mismo camino; cualquier duda cae en DOUBT y no se borra.

RESULTADO: KEEP=110, CANDIDATE=0, DOUBT=0. **No se borró ningún archivo.**

## Lote 1

| archivo | veredicto | a/b/c | razón |
|---|---|---|---|
| ac-fidelity-probes.spec.js | KEEP | si/si/no | Replay fixture lock de TASK-189; validateAcceptanceCriteria sigue vigente |
| agent-generator.spec.js | KEEP | si/si/no | TASK-013; evita agentes sin project-context.md |
| agent-models-config.spec.js | KEEP | si/si/no | TASK-036; evita corromper archivos de agentes al aplicar modelos |
| agent-permissions-config.spec.js | KEEP | si/si/no | TASK-091/036/044; parche quirúrgico de tools: en developer.md |
| apply-settings.spec.js | KEEP | si/si/no | TASK-009/210; evita perder wiring de settings.json |
| apply-workflows.spec.js | KEEP | si/si/no | Evita sobrescritura de workflows existentes |
| assimilate.spec.js | KEEP | si/si/no | Protege el human-gate de adopción de skills |
| atomic-write.spec.js | KEEP | si/si/no | Evita estado a medio escribir tras crash |
| autonomous-drive.spec.js | KEEP | si/si/si | USE-CASES.md: "Drive a goal autonomously" |
| backfill-graph-task-nodes.spec.js | KEEP | si/si/no | TASK-175; idempotencia del backfill |
| backlog-seeder-hardening-init.spec.js | KEEP | si/si/no | TASK-017 AC5; evita backlog a medio sembrar |
| backlog-seeder-hardening.spec.js | KEEP | si/si/no | TASK-017; evita corrupción silenciosa de JSON |
| backlog-seeder-plan-ticket.spec.js | KEEP | si/si/no | TASK-165; generación determinista del ticket de plan |
| backlog-seeder.spec.js | KEEP | si/si/no | TASK-014; contrato principal del seeder |
| bundle-compaction.spec.js | KEEP | si/si/no | TASK-103; previene bundle corrupto u oversize |
| bundle-shape.spec.js | KEEP | si/si/no | Evita que transcripts nativos se modifiquen |
| bundle.spec.js | KEEP | si/si/no | TASK-092; readBundleSessionOrThrow usado por varios seams |
| claude-md-init.spec.js | KEEP | si/si/no | TASK-025; consentimiento y colisiones al escribir CLAUDE.md |
| close-guard.spec.js | KEEP | si/si/no | Guard de cierre en modo loop; decenas de ACs vigentes |
| close-procedure-doc-lock.spec.js | KEEP | si/si/no | TASK-187/196; ancla el procedimiento documentado a los guards reales |
| context-monitor-repin-e2e.spec.js | KEEP | si/si/no | Evita settings.json apuntando a rutas de plugin obsoletas |
| context-monitor-repin-signal.spec.js | KEEP | si/si/no | TASK-209; evita reparación silenciosa sin aviso |
| context-monitor-sentinel.spec.js | KEEP | si/si/no | TASK-008 AC2; sentinels fuera del cwd |
| context-monitor-settings-migrate-e2e.spec.js | KEEP | si/si/no | TASK-210; migración flat→nested sin corromper settings.json |
| context-monitor-settings-scaffold.spec.js | KEEP | si/si/no | TASK-008/210; merge no destructivo |
| create-task-routes.spec.js | KEEP | si/si/no | TASK-054; evita escritura de tickets inválidos por HTTP |
| design-pack-doc-lock.spec.js | KEEP | si/si/no | TASK-184; citado en CLAUDE.md como fix verificado CONFORMING |
| design-profile-frontmatter.spec.js | KEEP | si/si/no | TASK-124; round-trip de perfil_proyecto/tier |

## Lote 2

| archivo | veredicto | a/b/c | razón |
|---|---|---|---|
| design-profile-round-trip.spec.js | KEEP | si/si/no | TASK-125/124; evita corrupción de tier/perfil al round-trip |
| discovery-intake.spec.js | KEEP | si/si/no | TASK-046; evita materializar PROJECT.md sin confirmación explícita |
| dist-init-workflows.spec.js | KEEP | si/si/no | TASK-038/039; evita omitir workflows al empaquetar |
| dist-parity.spec.js | KEEP | si/si/no | TASK-049; gate que evita enviar dist/ desactualizado |
| e2e-install.spec.js | KEEP | si/si/si | USE-CASES.md: "Install as a plugin" |
| framework-history.spec.js | KEEP | si/si/no | TASK-015; evita mezclar backlog seed con historial real |
| git-pathspec-commit-isolation.spec.js | KEEP | si/si/no | TASK-191; evita que un commit arrastre lo staged por otro agente |
| git-worktree-handback.spec.js | KEEP | si/si/no | TASK-195/197/226; evita bundles fusionados incorrectamente |
| gitignore-runtime-artifacts.spec.js | KEEP | si/si/no | TASK-083; evita commitear locks/tmp huérfanos |
| init-builtin-design-power.spec.js | KEEP | si/si/no | TASK-129; evita fuga de campos de diseño a proyectos no-diseño |
| init-command.spec.js | KEEP | si/si/no | TASK-024; answers-file no debe usar el prompter interactivo |
| init-pack-hook.spec.js | KEEP | si/si/no | TASK-128; shape byte-idéntico off-by-default |
| init.spec.js | KEEP | si/si/si | USE-CASES.md: "Initialize a project" |
| inline-object-frontmatter-escaping.spec.js | KEEP | si/si/no | TASK-162; evita mis-parseo de perfil con comas o llaves |
| inspection.spec.js | KEEP | si/si/no | TASK-212; garantiza que la inspección sea read-only |
| intake-e2e.spec.js | KEEP | si/si/si | USE-CASES.md: "Initialize a project" |
| intake-invisible-chars.spec.js | KEEP | si/si/no | TASK-159; seguridad, inyección de Unicode invisible |
| intake-scope-overlap-warn.spec.js | KEEP | si/si/no | TASK-167; scope_in/scope_out contradictorios sin aviso |
| intake-structure-forgery.spec.js | KEEP | si/si/no | TASK-158; seguridad, forja de encabezados/directivas |
| intake-underspecified-warn.spec.js | KEEP | si/si/no | TASK-166; goals+scope vacíos sin aviso |
| integrations-lock.spec.js | KEEP | si/si/no | TASK-116; escritura atómica real del lockfile |
| kb-graph-query.spec.js | KEEP | si/si/no | TASK-168/171/172/173; evita descartar filtros en silencio |
| kb-lookup-partial-reuse.spec.js | KEEP | si/si/no | TASK-113; éxito/fracaso ambiguo en bumps parciales |
| kb-lookup-seam.spec.js | KEEP | si/si/no | TASK-106; evita last_seen_at congelado para siempre |
| knowledge-entry-write.spec.js | KEEP | si/si/no | TASK-105/111; evita sobrescritura silenciosa y pérdida de drafts |
| knowledge-graph-canonical-ids.spec.js | KEEP | si/si/no | TASK-104; evita que neighbors() devuelva [] enmascarando errores |
| knowledge-graph-review.spec.js | KEEP | si/si/no | TASK-035; seguridad, XSS vía labels hostiles en el render |
| knowledge-graph.spec.js | KEEP | si/si/no | TASK-035; API central del grafo |

## Lote 3

| archivo | veredicto | a/b/c | razón |
|---|---|---|---|
| knowledge-lookup-cut-determinism.spec.js | KEEP | si/si/no | TASK-113; desempate determinista vivo en src/knowledge.js |
| knowledge-lookup.spec.js | KEEP | si/si/no | El researcher aún exige KB lookup y last_seen_at |
| license-detect.spec.js | KEEP | si/si/no | TASK-117 AC4; fallback de disco |
| lifecycle-polish.spec.js | KEEP | si/si/no | Cinco hallazgos LOW de TASK-004/008 aún relevantes |
| lifecycle.spec.js | KEEP | si/si/si | USE-CASES.md: "Resume a session across machines" |
| loop-auth.spec.js | KEEP | si/si/no | TASK-075/088; switches de autorización permanente |
| loop-checkpoint.spec.js | KEEP | si/si/si | USE-CASES.md: "Drive a goal autonomously (crash-resume)" |
| loop-ctl.spec.js | KEEP | si/si/no | TASK-097/111; CLI de la maquinaria del loop |
| make-template.spec.js | KEEP | si/si/no | TASK-019; AC map del template |
| mcp-append-comment-uat-guard.spec.js | KEEP | si/si/no | TASK-108; guard de escritura de comentarios uat |
| mcp-build-status.spec.js | KEEP | si/si/no | TASK-204; staleness del servidor MCP |
| mcp-close-task.spec.js | KEEP | si/si/no | TASK-082/108/163; cierre atómico y guards |
| mcp-server.spec.js | KEEP | si/si/no | TASK-026; superficie MCP viva |
| new-task-cli.spec.js | KEEP | si/si/si | USE-CASES.md: "Mint a ticket" |
| new-task.spec.js | KEEP | si/si/si | USE-CASES.md: "Mint a ticket" |
| operating-mode.spec.js | KEEP | si/si/no | TASK-063; harness vs loop |
| pack-apply.spec.js | KEEP | si/si/no | TASK-119; applier con lock atómico |
| pack-ctl-consumer-source.spec.js | KEEP | si/si/no | TASK-181; camino consumer-shaped, distinto del resto |
| pack-ctl.spec.js | KEEP | si/si/no | TASK-134/135; CLI del reconciler |
| pack-orchestrator.spec.js | KEEP | si/si/no | TASK-132; reconcilePack |
| pack-reconcile.spec.js | KEEP | si/si/no | TASK-118; probeSkills |
| persist-subagent-hook.spec.js | KEEP | si/si/no | TASK-219; el hook que hace durable el resultado de cada subagente |
| plugin-deps.spec.js | KEEP | si/si/si | USE-CASES.md: "Install as a plugin" |
| pointer.spec.js | KEEP | si/si/no | El puntero de sesión es v2 hoy; coincide con lo que exige el spec |
| project-definition-sections.spec.js | KEEP | si/si/no | TASK-045; secciones problem/goals/scope |
| project-md-frontmatter-injection.spec.js | KEEP | si/si/no | TASK-157; seguridad sobre renderProjectMd |
| project-md-hardening.spec.js | KEEP | si/si/no | TASK-016; hardening vigente |
| project-md.spec.js | KEEP | si/si/no | TASK-011; writeProjectMd |

## Lote 4

| archivo | veredicto | a/b/c | razón |
|---|---|---|---|
| project-schema.spec.js | KEEP | si/si/no | TASK-002/011; el validador sigue en uso |
| publish-scrub.spec.js | KEEP | si/si/no | Evita que tickets/estado de dev se filtren al template publicado |
| question-engine.spec.js | KEEP | si/si/no | TASK-010; escritura atómica y reanudación del cuestionario |
| recovery-agegate.spec.js | KEEP | si/si/no | TASK-085 AC6; evita borrar tmp huérfano fresco |
| recovery-wiring.spec.js | KEEP | si/si/no | TASK-083 AC1; evita recuperar un bundle corrupto en vez del tmp |
| repo-root.spec.js | KEEP | si/si/no | resolveRepoRoot es el contrato usado por todos los bin/ |
| requires-uat-persistence.spec.js | KEEP | si/si/no | TASK-220/221/222; evita perder requires_uat en round-trip |
| round-trip.spec.js | KEEP | si/si/si | USE-CASES.md: "Resume a session across machines" |
| session-lock.spec.js | KEEP | si/si/no | TASK-061/070/080/085/090/094; carreras y corrupción del lock |
| summary.spec.js | KEEP | si/si/no | TASK-004/099; contenido obligatorio de summary.md |
| task-018-corruption-policy.spec.js | KEEP | si/si/no | Sus cuatro ACs son literalmente los de TASK-018 |
| task-board.spec.js | KEEP | si/si/no | TASK-034/099; guardas HTTP (host header, 403, traversal) |
| task-calibration.spec.js | KEEP | si/si/no | Campos de calibración validados vía schema |
| task-store-hardening.spec.js | KEEP | si/si/no | Reparo de índice, sweep de tmp, deps, orden numérico |
| task-store-resilience.spec.js | KEEP | si/si/no | TASK-085; colisiones de clave y archivos cero-byte |
| task-store.spec.js | KEEP | si/si/si | USE-CASES.md: "Drive the workflow" |
| test-changed.spec.js | KEEP | si/si/no | TASK-194; evita falsos fatales en selección vacía |
| test-since.spec.js | KEEP | si/si/no | TASK-081/192; evita que un ref inválido pase como verde |
| uat-audit-cli.spec.js | KEEP | si/si/no | TASK-223; exit codes distinguibles, el audit nunca muta tasks/ |
| uat-gate-cli.spec.js | KEEP | si/si/no | TASK-225; evita que una violación post-cutoff pase como verde |
| use-case-suite.spec.js | KEEP | si/si/no | TASK-029/160; evita DoS de array y sobrescritura de specs |
| verification-tier.spec.js | KEEP | si/si/no | Rechaza el tier tdd retirado; conducta activa hoy |
| workflows-materializer.spec.js | KEEP | si/si/no | TASK-037/038/039; evita sobrescribir workflows del destino |
| worktree-handback-lstat-failopen.spec.js | KEEP | si/si/no | TASK-198; evita tratar un junction presente como ausente |
| worktree-handback-partial-removal.spec.js | KEEP | si/si/no | TASK-198/206/211; estado ambiguo tras remoción parcial |
| worktree-node-modules-provisioning.spec.js | KEEP | si/si/no | TASK-195/198; evita tocar un node_modules real no vacío |

## Lectura del resultado

El diagnóstico del ticket — "la suite creció 1:1 con el trabajo hecho en vez de con la
superficie del producto" — es correcto como observación de crecimiento, pero no se traduce
en archivos borrables: cada uno de los 110 fija una conducta que sigue siendo requerida y
nombra un daño concreto. Que 99 de 110 fallen el criterio (c) — las otras 11 filas lo cumplen — es un dato sobre
USE-CASES.md, que enumera pocos flujos primarios, no sobre los tests: por eso el criterio
de retiro exige que fallen los TRES y no uno solo.

El costo de la suite e2e es real y sigue sin resolverse por esta vía. Si se quiere bajar,
el camino que este resultado deja abierto es paralelizar o dividir el tier, no borrar.
