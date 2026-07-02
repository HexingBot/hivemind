# Roadmap de mejora consolidado — hivemind (post-pivot lean/unsupervised)

Fuente: 30 hallazgos CONFIRMED, deduplicados a 20 ítems. Tema dominante: **el harness acaba de quitar al humano del loop, pero casi todos los gates siguen siendo prosa** — el trabajo prioritario es convertir contratos en prosa en guards deterministas en los seams de mutación, y reparar los sensores que hoy dan verde en falso.

---

## 0. Enmiendas a tickets en vuelo (no son tickets nuevos)

**E1 — Ampliar TASK-075: `auto_consolidate` en el schema + reconciliar el contrato de gates** *(merge de hallazgos 1 + 13)*
- **Problema:** SKILL.md (que se autodeclara "durable contract") dice 4 gates; loop.md dice 5; y `loop_auth` en `src/schemas.js:150-162` y `state/bundle.schema.json:87-97` (`additionalProperties:false`) rechaza el switch `auto_consolidate` que loop.md documenta y que el preset unattended de TASK-075 AC2 debe setear. `tests/live-state.spec.js` valida el bundle vivo, así que persistir el grant documentado pone la suite en rojo hoy.
- **Acción:** añadir `auto_consolidate` a AMBAS copias del schema + parity spec entre las dos copias; añadir Gate 5 y su fila de switch a SKILL.md, con loop.md refiriendo a SKILL.md como canónico.
- **Evidencia:** SKILL.md:199,228-267; loop.md:7,117-138; src/drive-loop.js:193; src/schemas.js:150-162. **Impacto alto / esfuerzo pequeño.**

**E2 — Ampliar TASK-077: auditoría del `verification_tier` por el reviewer** *(hallazgo 3)*
- **Problema:** el tier es el knob de mayor palanca de toda la política de verificación (decide si existen tests) y es el único gate sin verificador. En loop unattended el orchestrator asigna el tier Y se beneficia de tiers ligeros — self-grading sin sensor. Un `uat-only` mal etiquetado que toca `src/` aterriza sin specs, sin manifest y con UAT auto-atestado.
- **Acción:** paso de tier-audit en `agents/reviewer.md` (+ copia parity): si el diff de un ticket `uat-only`/`tests-after` toca source logic/state/parsing/schema → HIGH "tier misassignment". Componer con la rúbrica de profundidad de TASK-077 (depth ≠ gate: un FULL review hoy sigue derivando el gate del label).
- **Evidencia:** CLAUDE.md paso 1; SKILL.md:110-113; reviewer.md:20; manifest-policy.js:27. **Impacto alto / esfuerzo pequeño (solo prosa).**

---

## Quick wins (esfuerzo pequeño, impacto alto/medio)

**Q1 — El gate de re-verificación del reviewer da verde en falso en CADA ticket** *(merge de 25 + 26 + 4 — el ítem más urgente de todo el roadmap)*
- **Problema (3 patas del mismo seam):** (a) `npm run test:changed` con `--changed` bare diffea contra HEAD; al momento del review el diff del developer ya está commiteado, así que selecciona **cero specs y sale 0** ("No test files found" + `passWithNoTests`) — el check "green must reproduce as green" es un falso positivo silencioso en cada ticket, y el reviewer no puede usar la forma correcta porque `npx` no está en su allowlist. (b) El import graph de `--changed` es ciego al mayor producto del framework (markdown: agents/skills/commands/CLAUDE.md) — los sensores de parity leen por `readFileSync`, sin edge de import, así que un ticket md-only (la forma exacta de TASK-076/077/078) corre cero sensores. (c) El check de calibración que reviewer.md declara HIGH/BLOCK se invoca como `node bin/check-calibration.js`, fuera del allowlist — denegación dura justo en el blocker obligatorio.
- **Acción:** (a) script `test:since` con base-ref (`vitest run --changed=<base-sha>`) invocado vía la forma `npm run` allowlisted, reviewer.md usa el ref range que ya recibe; (b) añadir `npm test` (fast tier ~2s, contiene todos los sensores fs-read) al gate per-ticket en CLAUDE.md/developer.md/reviewer.md — NO usar `forceRerunTriggers` en sharedTest (arrastraría la e2e lenta); (c) documentar `npm run check:calibration -- --forward ...` y exigir el output en el bloque Verification. Añadir doc-lock spec para que el contrato no vuelva a podrirse.
- **Evidencia:** reviewer.md:5,21,41-42; package.json test:changed; vitest 2.1.9 (git.B5SDxu-n.js:19-38, passWithNoTests); tests/agents-parity.spec.js; developer.md:42. **Impacto alto / esfuerzo pequeño.**

**Q2 — Resiliencia de estado ante crashes: `sweepAndRecover` es dead code + artefactos runtime commiteables + sweep de tmp sin age-gate** *(merge de 6 + 11 + 8)*
- **Problema:** (a) el módulo de recovery está escrito y testeado pero **cero call sites** — el contrato de state/README.md:77 es falso; tras un crash mid-write los orphan tmp se acumulan y un bundle corrupto no es resumible por ningún chat nuevo (fatal en unattended). (b) `state/.lock` y `*.tmp.*` no están gitignored con `state/` totalmente tracked — un `git add` amplio durante un run commitea el lock, que en la máquina B bloquea `acquire()`. (c) `sweepTasksTmpFiles` borra CUALQUIER `tasks/*.tmp.*` sin umbral de edad y ya hay ≥5 procesos escritores violando el supuesto SINGLE-WRITER — puede borrar un tmp in-flight entre fase 1 y 2 del atomic write (ventana ~250ms en el retry path de Windows) → mutación parcial; y `deriveNextKey` es TOCTOU (dos `createTask` concurrentes → el segundo rename **sobrescribe silenciosamente** el primer task).
- **Acción:** llamar `sweepAndRecover({bundleDir})` al tope de `loadActiveBundle`/`resumeFromPointer`/inspection (espejo del patrón ya existente en task-store.js:253); gitignore con patrones scoped (`state/.lock`, `state/**/*.tmp.*`, `tasks/*.tmp.*`) + spec `git check-ignore`; age-gate ~60s (mtime) en el sweep; documentar un único funnel de mutación (MCP server o advisory lock). Recordar rebuild de dist/.
- **Evidencia:** src/recovery.js:23 (cero callers); src/bundle.js:59-62; task-store.js:16-23,219-240,368-387; atomic-write.js:93-140. **Impacto alto / esfuerzo pequeño.**

**Q3 — `writeBundleSession` no valida schema: el bundle solo se valida en tests** *(hallazgo 10)*
- **Problema:** cualquier writer (checkpoints del loop, `setMode`, lifecycle) puede persistir un bundle schema-invalid y nada lo nota hasta que un consumidor falla — TASK-071 arregla un síntoma (enum del loop), no el guard ausente. En unattended nadie observa el drift.
- **Acción:** espejo del patrón task-store: compilar `bundleStateSchema` en src/bundle.js y validar en `writeBundleSession` antes de `atomicWriteFile` (`E_BUNDLE_INVALID` con paths de ajv). `loop_state` es `additionalProperties:true`, así que no le cuesta flexibilidad al loop. Incluir validate-and-repair one-time por si el bundle vivo ya trae campos drifted.
- **Evidencia:** src/bundle.js:67-72 vs task-store.js:59-77; writers sin validar en operating-mode.js:66, lifecycle.js:62/142/186/233. **Impacto medio / esfuerzo pequeño.**

**Q4 — KB lookup "determinista" que ningún agente puede ejecutar + telemetría de reuso muerta** *(hallazgo 21)*
- **Problema:** el researcher no tiene Bash, así que emula a mano tokenización + scoring 3-2-1 "determinísticamente" (no lo es, y el reviewer no tiene artefacto que reproducir); `recordKbReuse` no tiene ningún caller vivo, así que el tie-break por `last_seen_at` ordena sobre datos muertos. Los misses de KB son indistinguibles de knowledge ausente.
- **Acción:** exponer `kb_lookup` + `kb_record_reuse` (wrapping `lookupKnowledge`) — ojo: PROJECT.md Scope(out) dice "el MCP server solo amplía ticket CRUD", así que o se enmienda esa línea o se usa un vehículo alterno (CLI `bin/kb-lookup` que corre el orchestrator). Cambiar researcher.md paso 1 de "emula el algoritmo" a "llama al tool y lee los hits".
- **Evidencia:** researcher.md:5,22,34-42; mcp-server.js (6 tools, ninguno KB); knowledge.js:129-133,166-180. **Impacto alto / esfuerzo pequeño.**

**Q5 — Seam de notificación: un loop unattended que se detiene queda en silencio** *(hallazgo 17)*
- **Problema:** todo stop temprano (goalStuck, Gate 3 — nunca liftable ni con TASK-075 —, backstop, retries agotados) solo escribe `loop-stop-reason.txt` y "surface en la respuesta" de una terminal que nadie mira. Un stop al minuto 10 desperdicia toda la ventana planificada.
- **Acción:** seam `loop_notify` (template de comando en PROJECT.md frontmatter / Stop-hook / webhook-ntfy) invocado por el protocolo del loop cada vez que escribe stop-reason + al completar el run. Mínimo: receta de Stop-hook copy-paste en loop.md. Nota: los hooks nativos disparan por eventos del harness, no por loop-stops — el trigger debe vivir en el protocolo del loop.
- **Evidencia:** loop.md:105-107,153-161; grep sin ningún canal tras TASK-074. **Impacto medio / esfuerzo pequeño.**

**Q6 — Calibración G3 mayormente dead code + FLAGs de ruido garantizado sobre el KB** *(hallazgo 23)*
- **Problema:** el pre-filtro case-sensitive `line.includes('confirmed')` hace inalcanzables 3 de las 4 claim-words (decided/resolved/proven) y hasta 'Confirmed' capitalizado; y `validateTiers` flaggea todo archivo sin `source_tier` — ninguna entrada de knowledge/ lo tiene, y reviewer.md pone knowledge docs en scope. Sensor ciego Y ruidoso = sensor que se ignora.
- **Acción:** quitar el pre-filtro (o hacerlo match de las 4 palabras case-insensitive) + regression spec red-green; reconciliar scope de `source_tier` (añadirlo a knowledge/schema con default T2, o eximir knowledge/entries).
- **Evidencia:** src/calibration.js:38-39,94-100; reviewer.md:37,59. **Impacto medio / esfuerzo pequeño.**

**Q7 — Onboarding roto: paths de instalación y de plugin** *(merge de 29 + 30)*
- **Problema:** (a) README "First-time setup" omite `npm install` → `node bin/init.js` crashea con ERR_MODULE_NOT_FOUND('ajv') en el primer comando del usuario; existen bundles zero-install (`dist/init.cjs`). (b) commands/brain.md:19 usa `node bin/brain-launch.js` repo-relative — ENOENT para todo usuario plugin-installed (todos los demás commands usan `${CLAUDE_PLUGIN_ROOT}/dist/*.cjs`); además bypassa el bundle donde aterrizará TASK-079.
- **Acción:** apuntar el clone path a `dist/*.cjs` (o añadir `npm install` explícito); corregir brain.md a la convención `${CLAUDE_PLUGIN_ROOT}/dist/brain-launch.cjs`; doc-lint spec: toda invocación `node` en commands/*.md debe ser dist-prefixed.
- **Evidencia:** README.md:113-117,158-159,182; brain.md:19,36; task-store.js:31. **Impacto alto / esfuerzo pequeño.**

**Q8 — Bug reporter: scrubbing regex-only que no cubre credenciales en connection-strings + repo destino stale** *(hallazgo 37)*
- **Problema:** verificado empíricamente — `bolt://neo4j:PASSWORD@host` y `postgres://user:pass@host` pasan el scrub verbatim (exactamente la forma que produce el brain seam Neo4j/Qdrant, y el skill instruye "include verbatim"); `DEFAULT_REPO='lordiwa/agent-framework'` no es el remote actual (HexingBot/hivemind) — publicaría repro internos en un repo público ajeno; y el path de agente archiva sin confirm humano.
- **Acción:** patrón URI-userinfo (`\w+://[^/\s:@]+:[^/\s@]+@`) + fallback high-entropy; corregir el default de repo y hacerlo surfaced/confirmable; confirm-preview humano del body scrubbed antes de `ghIssueCreate` en el path agente.
- **Evidencia:** framework-bug-report.js:20-75,275; report-framework-bug.md:23-24,40-41. **Impacto medio / esfuerzo pequeño.**

**Q9 — Sensor de ids del knowledge graph + política honesta de manual sensors** *(merge de 22 + 28)*
- **Problema:** (a) graph.json mezcla `TASK-063`/`task-032` y dos formatos de decision-id — `neighbors()` es exact-match, así que queries fallan en silencio y el recipe de SKILL.md mintea duplicados. (b) El use case "Install as a plugin" se satisface con un spec cuyo único test es `it.skip` — el sensor anti-rot solo chequea `existsSync` (mitigante: plugin-deps.spec.js sí corre para el mismo use case).
- **Acción:** fast-tier sensor (ids `^TASK-\d+$`, una forma canónica de decision-id, todo `node.ref` resuelve a disco) + normalización one-time (reescribiendo también edges); extender use-case-policy.spec.js para exigir ≥1 `it(` no-skipped por spec referenciado (contar `it(` en general — plugin-deps usa `it.skipIf`) + sección "Manual verification" en USE-CASES.md.
- **Evidencia:** graph.json:5,23,71,131; knowledge-graph.js:331-344; use-case-policy.spec.js:187-212; e2e-install.spec.js:79-84. **Impacto medio / esfuerzo pequeño.**

---

## Estratégico (apuestas grandes que vale planificar)

**S1 — Enforcement determinista de gates en los seams de mutación + tool `close_task` atómico** *(merge de 2 + 5 + 16 — la apuesta central del pivot unattended)*
- **Problema:** los 5 gates del loop y el done-gate de uat-only son 100% prosa; `transitionStatus` y el tool MCP `transition_status` no chequean nada; el close-out per-ticket (el write más frecuente del workflow: status + comment + linked_commits + linked_prs + index) se hace con 6 Edits manuales bypasseando toda la validación/atomicidad que el store ya provee, y no existe tool para linked_commits/linked_prs. En un run largo lo único entre el loop y un close/push no autorizado es la memoria del modelo de la prosa de loop.md — exactamente lo que la compactación erosiona. Un lapse cierra un uat-only sin UAT o pushea commits que el humano quería locales.
- **Acción:** (a) guard en el close: `verification_tier:'uat-only'` + target `done` ⇒ exigir comment con author `uat` (throw si no) — en cualquier modo, es política CLAUDE.md ya escrita; (b) con `mode==='loop'`, exigir `loop_auth.auto_close_on_green_review` — ubicar el guard en la capa MCP/command o como policy hook inyectado, para no acoplar task-store al bundle; (c) tool `close_task` que aplica transición + comment + links + index en un solo pase validate-then-atomicWriteFiles (el punto natural de enforcement), reescribiendo SKILL.md para rutear TODOS los writes por MCP tools (Edit solo como fallback documentado); (d) PreToolUse/pre-push hook que bloquea `git push` en modo loop sin `auto_push_after_close`; (e) para unattended, rutear la ejecución de UAT delegado al reviewer fresh-context (que ya re-ejecuta comandos) en vez del orchestrator — coordinar con TASK-075, cuyo mecanismo de grant es la mitad sin enforcement de esto.
- **Evidencia:** task-store.js:300-360; mcp-server.js:166-180; loop.md:83-121; SKILL.md:86-90,380-392. **Impacto alto / esfuerzo medio.**

**S2 — Protocolo de crash-resume mid-ticket + el loop como use case de primera clase** *(merge de 14 + 27)*
- **Problema:** el checkpoint es solo per-ticket-completado; un crash entre `in_progress` y el close deja el ticket **invisible para siempre** a `selectNextTicket` (filtra `status==='todo'`) → goalStuck → STOP → humano requerido en cada crash — fatal para operación unattended. Los contadores `iteration`/`completedThisRun` no son durables, así que maxIterations y el gate de consolidación se resetean en silencio tras restart. Y el flow flagship post-pivot no tiene entrada en USE-CASES.md ni e2e del round-trip checkpoint→crash→resume (la propia política "suite tracks product surface" lo exige).
- **Acción:** contrato `loop_state` ({current_ticket, phase, iteration, completed_this_run, run_started_at}) escrito en cada phase boundary + regla de recovery al arrancar el loop (inspeccionar git y resumir en la fase grabada o resetear a todo con comment) como helper puro testeable (`resumePoint`); entrada "Drive a goal autonomously" en USE-CASES.md con e2e sobre los seams deterministas (write de checkpoint, read en proceso fresco, selectNextTicket sobre el estado restaurado), plegando las aserciones de enum de TASK-071 para respetar el test budget.
- **Evidencia:** loop.md:49,180; drive-loop.js:91-92,142-145,199; schemas.js:163-168; USE-CASES.md:14-36. **Impacto alto / esfuerzo medio.**

**S3 — Budgets reales para el loop: wall-clock, contexto y telemetría** *(hallazgo 15, empareja con Q5)*
- **Problema:** `shouldStop` cuenta solo iteraciones pero su stop-reason afirma acotar "token spend" — nada mide tiempo ni tokens; un ticket patológico cuesta más que diez limpios sin mover el contador. El failure mode más probable de un run largo es compactación silenciosa degradando la adherencia a los gates (que son prosa — ver S1), no llegar a iteración 20. El repo ya shippea el skill context-monitor y loop.md nunca lo referencia.
- **Acción:** `budgetCheck` puro con deadlines de run y per-ticket (timestamps en loop_state, ver S2); en cada checkpoint leer el porcentaje de contexto vía el bridge de statusline del skill (degradar con gracia si no está instalado) y pausar-con-HANDOFF sobre umbral; `artifacts/loop-journal.jsonl` (iteration, ticket, phase, ts, outcome) para que un watcher externo detecte hangs (complementa Q5).
- **Evidencia:** drive-loop.js:162-181; loop.md:66-72; skills/claude-code-context-monitor. **Impacto alto / esfuerzo medio.**

**S4 — Session-lock: cerrar la carrera de acquire y cubrir la exclusión mutua con tests de contención** *(merge del residuo de 9 + 12 + 24; la cadencia de renew y el stalenessMs de loop ya están en TASK-080)*
- **Problema:** `acquire()` es read-check-write — dos acquires casi simultáneos ambos "ganan" y el segundo rename sobrescribe el record del primero; la suite (líneas 80-618) es 100% secuencial, cero cobertura de contención para la única garantía del módulo. Los hallazgos se componen: mientras TASK-080 no aterrice, el lock está expirado la mayor parte de cada ticket, haciendo el stale-steal simultáneo materialmente plausible.
- **Acción:** create-exclusive (`openSync(lock,'wx')`) para primera adquisición + **verify-after-write** (releer tras escribir y throw E_LOCK_HELD si el record no es nuestro — cierra también la carrera del stale-steal y hace determinista el e2e); spec de contención con dos hijos `node -e` en loop. Secuenciar con/después de TASK-080 (mismo módulo y specs).
- **Evidencia:** session-lock.js:74-79,143-184; atomic-write.js renameSync incondicional; tests/e2e/session-lock.spec.js. **Impacto alto / esfuerzo medio.**

**S5 — Decisión de producto sobre el brain + capture de knowledge post-pivot** *(merge de 19 + 20 + 18)*
- **Problema:** todo el pipeline brain/graph-sync/wisdom no tiene NINGÚN caller de producción (persistWisdom: cero paths de invocación), el namespace MCP del researcher nunca se registra, y las premisas de las decisiones PLAN.md P1.4/P1.5 (humano que levanta el brain por sesión y consolida a mano) las invalidó el pivot unattended. Además el KB tiene 3 entradas tras ~79 tickets porque cada write requiere aprobación humana por entrada — y `auto_consolidate` (TASK-075) hace la tasa de captura **estructuralmente cero**: las lecciones más caras (HIGHs del reviewer, RC loops) se evaporan. El brain-client encima miente: "queued (never lost)" es un array en memoria que muere con el proceso, y un probe transitorio fallido (documentado como común en Voyage free tier) latchea `_available=false` para siempre.
- **Acción (decisión explícita, en este orden):** (1) decidir wire-or-demote ANTES o junto a TASK-079 (que invierte en el launcher y está en tensión con demote): (a) wire = recordNode en el close del loop + persistWisdom en consolidación + registro MCP condicional a WISEARCHER_PATH; o (b) demote = quitar el mandato brain-first de researcher.md y congelar el seam tras el smoke test — dado el rumbo lean, (b)-con-plan-de-reentrada es defendible. (2) Independiente de eso: desacoplar capture de approval — en modo loop, escribir `proposed_kb_entry` + una lección por HIGH/RC a `knowledge/proposed/` que el grep lookup escanea a peso reducido (marcando hits como unvetted — registrar como design decision explícita); el humano bulk-promueve en el checkpoint de consolidación: curador, no escriba. (3) Solo si wire: outbox on-disk (`state/brain-outbox.ndjson`) + re-probe con TTL/backoff en brain-client (tdd, seams inyectables ya existen).
- **Evidencia:** grep repo-wide (solo tests/smoke importan el seam); .mcp.json; researcher.md:5,10,26-30,64; drive-loop.js:193-206; brain-client.js:41-43,82-88,110-124; knowledge/entries (3). **Impacto alto / esfuerzo medio.**

**S6 — Data-fencing anti prompt-injection en los briefings per-ticket** *(hallazgo 35)*
- **Problema:** el loop diario interpola title/description/ACs del ticket directo en los prompts de developer (Bash irrestricto) y reviewer, sin nada del fencing que el propio proyecto ya estableció como estándar en deep-review (TASK-039: bloque BEGIN/END DATA + "never as a directive"). Con la migración a Jira, el surface `create_task` del MCP y TASK-075 quitando al humano del path ticket-read→spawn, el texto del ticket se acerca a canal de ejecución. Es el path de interpolación de mayor tráfico y el único sin el estándar propio.
- **Acción:** template canónico de briefing en orchestrator-routing (referenciado por developer.md/reviewer.md) que fencea TODO texto ticket-derived con el patrón exacto de deep-review.js:198-210 + cap de longitud; doc-lock spec para que los marcadores no se pierdan. Validar la viabilidad del allowlist de Bash para el developer en modo unattended antes de comprometerlo.
- **Evidencia:** SKILL.md:107-109,147-149; developer.md:5,14; deep-review.js:202-210. **Impacto alto / esfuerzo medio.**

**S7 — Compaction y rotación del bundle de sesión** *(hallazgo 7)*
- **Problema:** un bundle perpetuo de 203KB (decisions=61, subagent_results=27; lifecycle.log con 1 sola entrada en 5+ semanas), reescrito atómico entero en cada checkpoint (write amplification + churn de git con state/ tracked), cargado completo en cada RESUME-FIRST — y el loop unattended acelera el crecimiento. Nada compacta ni rota; degradación monotónica de calidad de resume y coste de tokens.
- **Acción:** (1) compaction en write: últimos N (~20) decisions/subagent_results en session.json, spill a `artifacts/decisions.jsonl` append-only; (2) comando `/hivemind:session` (o en el exit de /hivemind:loop — no en superficie de console, que muere con TASK-074) con pause/end/rotate, donde rotate arranca bundle fresco con handoff_summary destilado + active_task.
- **Evidencia:** bundle vivo 203KB; schemas.js:94-139 uncapped; commands/ sin comando de session; loop.md:54,180. **Impacto alto / esfuerzo medio.**

**S8 — README loop-first + mirrors generados en build** *(merge de 31 + 33; secuenciar con TASK-074)*
- **Problema:** (a) README tiene cero menciones de "loop"/"autonomous"/"unattended" — vende el producto viejo, y su único feature callout (console) lo borra TASK-074; el usuario nuevo nunca descubre /hivemind:loop ni el resto del command surface. (b) Las copias byte-identical de agents/ y skills/ se mantienen a mano — puro peaje de doble edición con un failure mode permanente que TASK-078 solo mitiga con disciplina.
- **Acción:** (a) reestructurar README alrededor del loop ("first driven ticket in one command") + índice de comandos, en/inmediatamente después del doc-cleanup de TASK-074. (b) `npm run sync:mirrors` en build-plugin que regenera las copias (parity spec pasa a staleness gate, como dist-parity) — ojo: TASK-021 registró decisión humana con .claude/ como source of truth dev (dirección de sync probablemente .claude/→plugin-root, re-confirmar), y los skill sets son intencionalmente asimétricos (11 solapan, 3 son one-sided) → manifest include/exclude explícito, no copia ciega.
- **Evidencia:** grep README; TASK-078 ACs; agility-review R3.4; listados de ambos dirs. **Impacto medio-alto / esfuerzo medio.**

---

## Descartar / vigilar (real pero de bajo valor ahora)

**V1 — shipped-bin.json drifted (omite report-framework-bug.cjs), solo containment-tested** *(34)* — Real pero documentario: nada rompe en runtime (el plugin install clona todo lo commiteado). **Esperar a que TASK-074 vuelva a batir el bundle set**, luego generar shipped-bin.json desde ENTRYPOINT_NAMES (o spec de set-equality) y corregir los comments "four bundles". Impacto bajo / esfuerzo pequeño.

**V2 — Strip de credenciales asimétrico entre brain-launch y orchestrator-bridge** *(36)* — TASK-074 probablemente borra orchestrator-bridge.js (ES el chat bridge del console), tras lo cual el fix se reduce a **una línea**: añadir el delete de `ANTHROPIC_AUTH_TOKEN` en brain-launch.childEnv + actualizar su spec. Hacerlo como rider de TASK-079 (mismo archivo). El helper compartido solo si sobreviven otros spawn sites. Impacto bajo-medio / esfuerzo trivial.

**V3 — Bump de versión lockstep en dos archivos sin script** *(32)* — Fricción real (el nombre fósil `exactly_0_1_1` + comment '0.1.0' prueban dos drifts), pero mitigada por `auto_version_bump_on_milestone` y solo duele en releases. Script `release:bump` que reescribe ambos sitios atómicamente (mantener el pin exacto — no debilitar el lock de TASK-027) + checklist en CLAUDE.md, cuando toque el próximo release. Impacto medio / esfuerzo pequeño.

**V4 — Refs del knowledge graph a disco** — la mitad "ref-rot" del hallazgo 22 resultó **latente, no viva** (todos los refs resuelven hoy); queda cubierta como parte del sensor de Q9, sin ticket propio.

---

## Corte de tickets sugerido (mintar PRIMERO, en este orden)

| # | Ticket | Racional (1 línea) | verification_tier |
|---|---|---|---|
| 0 | **Enmiendas E1 (→TASK-075) y E2 (→TASK-077)** — no son tickets nuevos | E1 desbloquea el preset unattended que hoy choca contra el schema; E2 cuesta solo prosa y cierra el self-grading loop del tier | (heredan el tier de su ticket) |
| 1 | **TASK-081 — Reparar el gate de re-verificación del reviewer (Q1: test:since base-ref + fast tier per-ticket + calibration allowlisted)** | Hoy el review gate reporta verde habiendo corrido cero tests en CADA ticket — todo lo demás del roadmap se verifica a través de este seam roto, así que va primero | `tests-after` (+ `test:all` obligatorio: toca test infra) |
| 2 | **TASK-082 — Enforcement determinista en los seams + `close_task` atómico (S1)** | Es la mitad de enforcement que le falta a TASK-075: sin guards en código, el pivot unattended descansa en prosa que la compactación erosiona | `tdd` |
| 3 | **TASK-083 — Resiliencia de estado: wire sweepAndRecover + gitignore runtime + age-gate del tmp sweep (Q2)** | Tres hardenings pequeños que cierran las clases de corrupción silenciosa que un loop sin humano no puede notar; el módulo de recovery ya existe y está testeado | `tdd` |
| 4 | **TASK-084 — Crash-resume del loop + use case e2e (S2)** | Un crash mid-ticket hoy requiere humano siempre — el defecto individual más fatal para la operación unattended, y salda la deuda del "suite tracks product surface" | `tdd` |
| 5 | **TASK-085 — Session-lock: acquire exclusivo + verify-after-write + spec de contención (S4)** | La única garantía del lock (exclusión mutua) es violable y tiene cero cobertura; se compone peligrosamente con la ventana de staleness hasta que TASK-080 aterrice — secuenciar junto a TASK-080 | `tdd` |
| 6 | **TASK-086 — Data-fencing en briefings per-ticket (S6)** | El path de interpolación de mayor tráfico carece del estándar de seguridad que el propio proyecto ya fijó en deep-review, justo cuando el humano sale del path | `tests-after` (prosa/template + doc-lock spec que prueba los marcadores) |

Siguiente ola (tras estos): S3 (budgets+telemetría, depende del loop_state de TASK-084), S5 (decisión brain — tomarla antes de que TASK-079 avance más), S7 (compaction del bundle), Q4-Q9, S8 (post-TASK-074).