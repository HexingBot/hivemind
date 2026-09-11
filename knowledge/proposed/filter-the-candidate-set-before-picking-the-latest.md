---
id: filter-the-candidate-set-before-picking-the-latest
problem: >-
  Un chequeo de plausibilidad temporal colocado DESPUES de elegir el registro
  mas reciente no restringe la eleccion: la anula. Si entre los candidatos hay
  uno genuinamente comparable y otro posterior mal atribuido, el pick se queda
  con el posterior, el chequeo dispara sobre ese, y el registro correcto se
  descarta sin que nadie lo mire. En una herramienta de corroboracion el efecto
  es que una discrepancia REAL — una transcripcion forjada — se convierte en
  no-se-pudo-verificar. El falso no-se-pudo-verificar es indistinguible de la
  ausencia honesta de evidencia, asi que el defecto no deja rastro.
symptoms:
  - >-
    Un pre-chequeo o post-chequeo devuelve unverifiable para un ticket que si
    tiene un registro comparable
  - >-
    El A/B por ticket entre dos versiones del modulo muestra un corroborated que
    se degrada a unverifiable
  - >-
    Los agregados (totales por desenlace) coinciden antes y despues mientras un
    ticket individual se movio: la compensacion entre buckets tapa el movimiento
  - >-
    El spec nuevo pasa con la version buggy Y con la correcta, o sea que no
    discrimina la unica diferencia que importa
solution: >-
  Restringir el CONJUNTO DE CANDIDATOS antes de elegir, no filtrar la eleccion
  despues. En concreto: eligibleRecords = filtrar los candidatos por la
  condicion temporal, y solo si el conjunto elegible queda VACIO devolver el
  desenlace de no-se-pudo-verificar; recien despues aplicar pickLatest sobre el
  conjunto ya restringido. Dos corolarios verificados en TASK-217: (1) los
  registros sin timestamp parseable siguen siendo elegibles, porque excluirlos
  seria adivinar; (2) el guard de null del lado del comentario es load-bearing,
  porque en JS null < x es true (null coerce a 0) y sin el guard TODO comentario
  sin at parseable se degrada. Y la medicion correcta del antes/despues es un
  diff POR TICKET cargando las dos versiones del modulo lado a lado contra el
  MISMO board y el MISMO log — nunca comparar agregados contra numeros
  capturados en otro momento, que es exactamente lo que escondio este defecto
  una ronda entera.
tags:
  - corroboracion
  - parsing
  - orden-de-operaciones
  - falso-negativo
  - medicion
projects:
  - hivemind
created_at: '2026-09-11T00:52:15.139Z'
last_seen_at: '2026-09-11T00:52:15.139Z'
source_tier: T1
---
Encontrado en TASK-217 (2026-09-11) por el reviewer en contexto fresco, reproducido sobre los datos reales del repo con TASK-221 y confirmado en la ronda siguiente por un segundo reviewer independiente. Costo dos rondas de fix con hallazgo HIGH.

El caso concreto: src/reviewer-verdict-provenance.js devolvia unverifiable/comment-predates-record. La rama corria despues de pickLatestRecordByCapturedAt. TASK-221 tenia su registro verdadero 287 s antes del comentario, mas cuatro registros posteriores mal atribuidos por active_task obsoleto; el pick se quedaba con uno de esos cuatro y la corroboracion real se perdia. Con el cuerpo del comentario invertido a proposito (transcripcion forjada), la version buggy devolvia unverifiable donde la correcta devuelve not-corroborated/verdict-mismatch: el defecto silenciaba exactamente la fabricacion que la herramienta existe para detectar.

La leccion de medicion vale tanto como la de codigo: el hand-off habia afirmado cero movimiento por ticket, y era falso. Los totales coincidian porque se los habia comparado contra numeros capturados en otro momento, y entre medio el board habia ganado un comentario. Ver [[live-probe-counts-age-while-you-document-them]] y [[never-read-a-process-failure-as-a-state-answer]].
