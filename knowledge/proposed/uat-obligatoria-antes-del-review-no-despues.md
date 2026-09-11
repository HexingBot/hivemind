---
id: uat-obligatoria-antes-del-review-no-despues
problem: >-
  Un ticket con requires_uat true llego al review sin comentario uat y el
  reviewer lo bloqueo con un hallazgo HIGH puramente procedural, gastando una
  vuelta completa de review en algo que no era del diff.
symptoms:
  - >-
    El reviewer devuelve REQUEST-CHANGES con un HIGH que no señala ninguna linea
    de codigo
  - El ticket tiene requires_uat true y comments vacio al momento del review
  - El diff en si esta sano y el reviewer lo dice explicitamente
solution: >-
  Correr la UAT ANTES de despachar el reviewer, no despues: la lista de casos
  observables de la Regla 1 ya existe desde el paso 2 del workflow y es la misma
  que se reutiliza como script de UAT. El orquestador la ejecuta o la delega,
  registra el comentario uat con la convencion estricta, y recien entonces
  spawnea al reviewer. Asi el review gasta su turno en el diff y no en el
  proceso.
tags:
  - uat
  - workflow
  - review
  - requires-uat
projects:
  - hivemind
created_at: '2026-09-10T19:06:24.125Z'
last_seen_at: '2026-09-10T19:06:24.125Z'
---
Observado en TASK-218 (2026-09-10). El reviewer marco el hueco correctamente e incluso indico que no era un loop-back al developer sino una obligacion del orquestador — pero la vuelta ya estaba gastada. Relacionado con [[reviewer-verdict-provenance]] y con la lista de casos observables de la Regla 1.
