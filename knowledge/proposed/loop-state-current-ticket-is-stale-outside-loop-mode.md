---
id: loop-state-current-ticket-is-stale-outside-loop-mode
problem: >-
  Leer loop_state.current_ticket del bundle de sesion para saber que ticket esta
  en curso devuelve un valor CONFIADAMENTE FALSO en harness mode. loop_state
  solo lo mantiene el drive loop de /hivemind:loop; en harness mode, que es el
  modo por defecto, nadie lo actualiza nunca y queda congelado en lo ultimo que
  toco un loop. Es peor que no tener el dato: null dice honestamente no se,
  mientras que un valor rancio afirma con confianza algo falso, y un consumidor
  no puede distinguir un registro bien atribuido de uno mal atribuido.
symptoms:
  - >-
    loop_state.current_ticket nombra un ticket con status done, a veces de dias
    atras
  - bundle.mode es harness pero loop_state.run_started_at tiene fecha vieja
  - >-
    Registros, logs o atribuciones automaticas apuntan todos al mismo ticket
    equivocado
  - active_task del bundle dice una cosa y loop_state.current_ticket dice otra
solution: >-
  Usar active_task como fuente primaria: es campo REQUERIDO en
  state/bundle.schema.json (string|null, patron ^TASK-[0-9]{3,}$) y el contrato
  RESUME-FIRST lo mantiene en ambos modos. Precedencia correcta: (1)
  bundle.active_task si es string no vacio; (2) si no, y SOLO si bundle.mode ===
  loop, bundle.loop_state.current_ticket si es string no vacio; (3) si no, null.
  La guarda de mode en el paso 2 es load-bearing: sin ella se vuelve a leer el
  valor rancio en cuanto active_task sea null, que es justo el estado de una
  sesion en reposo. Un bundle legacy sin campo mode resuelve a null, que es la
  direccion segura. Verificado en TASK-219 contra el estado real:
  loop_state.current_ticket = TASK-197 (done, nueve dias) mientras active_task =
  TASK-219.
tags:
  - session-state
  - bundle
  - atribucion
  - harness-mode
  - loop-state
  - empty-result-contract
  - stale-data
projects:
  - hivemind
created_at: '2026-08-15T18:30:00.000Z'
last_seen_at: '2026-08-15T18:30:00.000Z'
---

