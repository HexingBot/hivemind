---
id: storage-schema-vs-write-policy-enum-conflation
problem: >-
  Retirar un valor de un enum que sirve a DOS proposas a la vez — describir los
  datos que ya existen en disco y hacer cumplir la politica de asignacion de
  valores nuevos — congela toda escritura sobre los registros historicos que
  llevan ese valor.
symptoms:
  - >-
    Un cambio de politica que solo deberia afectar registros NUEVOS rompe
    operaciones sobre registros VIEJOS.
  - >-
    appendComment / transitionStatus sobre un ticket historico fallan con
    "payload failed schema validation: /verification_tier must be equal to one
    of the allowed values".
  - >-
    La suite de tests queda verde: ningun spec ejercita una escritura sobre un
    registro con el valor retirado, porque las fixtures se escriben con valores
    actuales.
  - >-
    El dano se subestima como "riesgo latente sobre tickets cerrados" hasta que
    se cuenta y aparece un registro VIVO con el valor viejo (TASK-211, en status
    todo).
solution: >-
  Separar los dos enums, que casi siempre estan fundidos en uno por accidente
  historico. El schema de DATOS ALMACENADOS describe todo lo que legitimamente
  existe en disco, incluidos los valores retirados, marcados en su description
  como write-frozen y no asignables. La politica de ASIGNACION se hace cumplir
  en las capas de ESCRITURA (en hivemind: VERIFICATION_TIERS de
  src/task-store.js y el z.enum de src/mcp-server.js). Regla general: un
  validador que corre en CADA escritura no puede usarse para expresar una
  politica sobre valores nuevos, porque revalida el objeto completo y castiga
  retroactivamente a todo registro preexistente. Lock de regresion
  imprescindible: mutar un registro preexistente que lleva el valor retirado. El
  diseno necesita ademas un drift-guard que falle en AMBAS direcciones — si se
  re-narrowea el schema de datos, y si un valor retirado reaparece en la capa de
  asignacion.
tags:
  - schema
  - ajv
  - migracion
  - enum
  - datos-historicos
  - validacion
projects:
  - hivemind
created_at: '2026-09-09T20:00:00.000Z'
last_seen_at: '2026-09-09T20:00:00.000Z'
---

