# Revisión de agilidad — cómo recortar el tiempo del ciclo tdd/review sin perder fiabilidad

Fecha: 2026-07-01 · Autor: orchestrator · Solicitado por el humano ("quitar tiempo de revisión del tdd sin perder fiabilidad, que sea más ágil en general")

## Dónde se va el tiempo hoy (ticket tdd, pipeline secuencial)

| Fase | Coste | Nota |
|---|---|---|
| 1. Orquestador: fetch + plan + checkpoint | bajo | |
| 2. Developer spawn #1 (TEST mode) | alto | contexto frío: lee ticket, convenciones, tests existentes |
| 3. Developer spawn #2 (IMPL mode) | alto | contexto frío OTRA VEZ: re-adquiere todo lo que el TEST dev ya sabía |
| 4. Reviewer spawn (contexto fresco, por diseño) | alto | modelo más caro (inherit), diff completo, gates Spine completos |
| 5. Cierre: ticket + index + grafo + bundle | bajo-medio | |
| 6. Loop RC (HIGH → dev fix frío → re-review frío) | el más caro | históricamente ~1 de cada 3 tickets tdd |

## Recomendaciones (ordenadas por ahorro/riesgo)

### R1 — Un solo spawn de developer para tdd, con disciplina de dos commits (AHORRO GRANDE, RIESGO BAJO)
Hoy el tier tdd spawns al developer dos veces; cada spawn paga la adquisición de contexto completa.
Propuesta: UN spawn que (a) escribe los tests, (b) los corre y captura la salida ROJA, (c) commit `test:`,
(d) implementa, (e) commit `feat:/fix:`. Garantías conservadas:
- El orden de commits prueba tests-first (`test:` precede al impl-commit en `git log`).
- La corrida roja capturada prueba que los tests fallaban por la razón correcta.
- El reviewer fresco puede re-correr los tests contra el parent del impl-commit si sospecha.
Pérdida real: la separación de contextos entre quien escribe el test y quien implementa. La evidencia
del propio historial dice que esa separación NO era el sensor que cazaba los bugs: todos los RC HIGH
vivieron en caminos no especificados y los cazó el REVIEWER fresco, no la separación TEST/IMPL.

### R2 — Profundidad de review escalada al riesgo del diff (AHORRO MEDIO, RIESGO BAJO-MEDIO)
Regla objetiva para `review_depth`:
- **light**: diff < ~150 líneas Y no toca schema/seguridad/estado compartido/packaging(dist).
  Review = AC-compliance + re-run del gate + barrido de las 5 clases de HIGH recurrentes.
- **full**: todo lo demás (y siempre lógica core tdd).
Guardia one-way: el reviewer puede auto-escalar light→full, nunca degradar full→light.

### R3 — Checklist de prevención pre-hand-off (AHORRO ALTO EN RC LOOPS, COSTE CASI NULO)
Los RC loops son el camino más caro y todos los HIGH históricos caen en 5 clases conocidas. Añadir a
developer.md un checklist obligatorio antes del hand-off:
1. ¿Probé el camino NO especificado más cercano al que toqué?
2. ¿Todo sensor/lock nuevo puede fallar? (red-green plant)
3. ¿Rebuild de dist/ si toqué src|bin bundleado?
4. ¿Paridad byte-identical de skills si toqué una copia?
5. ¿Markers de calibración conservados aguas abajo?

### R4 — Solapamiento en el loop (AHORRO DE WALL-CLOCK, RIESGO MEDIO — diferir)
Mientras el reviewer revisa el ticket N, el developer de N+1 podría arrancar si los ámbitos de archivos
son disjuntos. Requiere guardas (nunca 2 developers en el mismo working tree; idealmente worktrees).
Es la ganancia más cara de asegurar — recomiendo diferirla hasta agotar R1-R3.

### R5 — Bookkeeping por lotes (AHORRO PEQUEÑO)
Checkpoint del bundle en transiciones de fase (no por micro-paso); edges del grafo sólo al cierre.

## Qué NO tocar (núcleo de fiabilidad, con evidencia del historial)
- **Reviewer en contexto fresco** — cazó el data-island nunca inyectado (038 specs verdes), el lock
  doblemente vacuo, la migración perdida del 032, el gap SSE del 067. Es EL sensor.
- **Red-green plant** para todo lock estático nuevo.
- **dist-parity + skill-parity** en test:all.
- **Gate 3 del loop** (ambigüedad genuina): nunca se levanta.
- Gates de calibración/observabilidad Spine (bloquean clases de error que ningún test unitario ve).

## Impacto estimado
- R1+R3: ~40-50% menos coste y tiempo por ticket tdd (un spawn menos + menos RC loops).
- R2: ~30% menos coste de review en tickets pequeños.
- El grant "sin supervisión" (loop_auth, ya registrado esta sesión) elimina la espera humana,
  que era el mayor componente de wall-clock en runs supervisados.

## Cambios concretos si se aprueba
- R1: editar agents/developer.md (+ copia .claude/agents/) y orchestrator-routing SKILL.md (protocolo
  de spawn tdd) — ticket tests-after.
- R2: rubrica `review_depth` en orchestrator-routing + reviewer.md — ticket tests-after.
- R3: checklist en developer.md — ticket uat-only (prosa).
