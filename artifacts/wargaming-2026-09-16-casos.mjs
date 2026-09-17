// Registra en cada ticket, en este orden (CLAUDE.md Workflow step 2):
//   1. el PEDIDO completado contra docs/PLANTILLA-PEDIDO.md
//   2. la lista de CASOS DE USO derivada del bloque 4
//   3. la CONSTANCIA DE APROBACION humana
// Todo por appendComment(), o sea por los mismos guards que el MCP.
import { appendComment } from '../src/task-store.js';

const repoRoot = '/opt/data/home/hivemind';

const APROBACION =
  'CONSTANCIA DE APROBACION HUMANA DE LOS CASOS DE USO (CLAUDE.md Workflow step 2, hard stop del 2026-09-16).\n\n' +
  'Aprobador: Mato. Momento: despacho del 2026-09-16, posterior al triaje del wargaming.\n\n' +
  'Cita verbatim de la autorizacion:\n' +
  '  "actualiza lo que tengas que actualizar y vamos a arreglar ese bug. Una vez el bug este\n' +
  '   arreglado, una vez todos los tickets o cosas que salieron de este wargaming esten\n' +
  '   arreglados, me avisas. Hacemos un bump a la version, actualizamos Hivemind, y hacemos el\n' +
  '   ejercicio de nuevo. Actualizamos en todos los proyectos."\n' +
  '  Mas, en el mismo despacho: "Mato autorizo arreglar todo."\n\n' +
  'ALCANCE EXACTO DE LO QUE ESTA APROBACION ES Y LO QUE NO ES, dicho para que no se lea despues\n' +
  'como mas de lo que fue:\n' +
  '  - LO QUE ES: una autorizacion en bloque y explicita para arreglar las 23 roturas del wargaming\n' +
  '    del 2026-09-16, sobre un triaje que Mato leyo. Los casos de uso de abajo NO son requisitos\n' +
  '    que yo invente: cada uno es un CAMINO YA REPRODUCIDO por el ataque, con su evidencia en\n' +
  '    ~/qa-agents/wargames/hivemind/2026-09-16/. El "espera Y" de cada caso es la conducta que el\n' +
  '    SUT promete y hoy incumple, no una funcionalidad nueva.\n' +
  '  - LO QUE NO ES: una aprobacion caso por caso de esta lista concreta. Mato no vio esta\n' +
  '    numeracion antes de que existiera. Se registra asi, y no como "Mato aprobo estos 6 casos",\n' +
  '    porque maquillarlo seria exactamente el registro falso que la politica del 2026-09-16 vino a\n' +
  '    eliminar.\n' +
  '  - CONSECUENCIA OPERATIVA: si al implementar un caso hay que CAMBIARLO, no se resuelve por\n' +
  '    criterio propio -- se escala a Mato, igual que manda la Regla 1. Esta constancia autoriza\n' +
  '    arreglar, no re-definir.';

const items = [
  {
    key: 'TASK-233',
    pedido:
      'PEDIDO COMPLETADO contra docs/PLANTILLA-PEDIDO.md (bloque 4 portante).\n\n' +
      '1. OBJETIVO: que la politica que el repo ya escribio (TDD eliminado, gate de manifiestos\n' +
      'eliminado, casos de uso obligatorios con aprobacion humana, wargaming al final) RIJA para los\n' +
      'agentes que efectivamente corren, y que la deriva entre repo y superficie ejecutada sea\n' +
      'detectable en vez de descubrirse por un wargaming.\n\n' +
      '2. ACTOR: el Orquestador y los subagentes de cualquier proyecto que tenga el plugin instalado\n' +
      '(11 proyectos con PROJECT.md en esta maquina). Secundario: Mato, que lee el reporte.\n\n' +
      '3. PROBLEMA: el plugin instalado es v0.22.0 del 2026-08-26. Las decisiones humanas del 13-ago\n' +
      '(eliminar TDD) y del 16-sep (eliminar el gate de manifiestos, aprobacion de casos, wargaming)\n' +
      'nunca llegaron al consumidor. Medido: grep de approv|aprob|use.case|hard stop = 0 en el agente\n' +
      'ejecutado; todavia declara "absent means tdd". Tres Developers reales implementaron sin lista\n' +
      'aprobada, 3 de 3.\n\n' +
      '4. CAMINOS Y ACCIONES ESPERADAS -- de aca salen los casos:\n' +
      '   PRINCIPAL: se publica una version nueva y el consumidor la toma; el agente spawneado trae\n' +
      '     la regla de negarse sin lista aprobada.\n' +
      '   ALTERNATIVO A: un proyecto tiene copias locales en .claude/agents|skills que OVERRIDEAN al\n' +
      '     plugin; actualizar el plugin no lo alcanza y hay que resincronizarlo aparte.\n' +
      '   ALTERNATIVO B: alguien edita CLAUDE.md con una politica nueva y se olvida de las\n' +
      '     superficies enviadas al consumidor; la deriva tiene que dar rojo.\n' +
      '   FALLO A: una superficie enviada al consumidor sigue instruyendo lo retirado (tests-first,\n' +
      '     "absent means tdd", e2e antes del hand-off) y nadie lo nota porque la suite esta verde.\n' +
      '   FALLO B: el sensor se escribe tan laxo que pasa con la superficie vieja (candado vacuo).\n\n' +
      '5. CRITERIOS DE HECHO DEL USUARIO: Mato spawnea un Developer en cualquier proyecto sin lista\n' +
      'de casos aprobada y el Developer SE NIEGA.\n\n' +
      '6. RESTRICCIONES: .claude/** no se escribe con la herramienta directa (guard de rutas\n' +
      'sensibles del harness); el mecanismo viable es node -e con fs.copyFileSync. El MCP de tareas\n' +
      'esta caido: las mutaciones van por src/task-store.js llamado por node.\n\n' +
      '7. FUERA DE ALCANCE: re-tierear los 100 tickets historicos con tdd (TASK-212 lo prohibe\n' +
      'explicitamente); re-atacar UC-03 contra el agente nuevo (eso es el re-wargaming, va en el\n' +
      'despacho siguiente).',
    casos: [
      'CU1 (camino principal). Se corta y publica una version nueva del plugin y un consumidor la toma. Espera Y: el agente developer que se spawnea contiene la regla de negarse sin lista de casos aprobada y ya NO contiene "absent means tdd".',
      'CU2 (alternativo A). Un proyecto tiene .claude/agents/developer.md propio con la politica vieja. Espera Y: el inventario lo DETECTA y lo nombra como no alcanzado por la actualizacion del plugin; no se lo da por actualizado.',
      'CU3 (alternativo B). Alguien cambia la politica en CLAUDE.md y no toca agents/ ni skills/. Espera Y: el sensor da ROJO nombrando la superficie que quedo atras.',
      'CU4 (fallo A, WG-H-017). vitest.config.all.js instruye correr los e2e antes del hand-off, contra la decision del 2026-09-16. Espera Y: el texto dice lo que la politica dice (los e2e corren en el paso de wargaming) y una reintroduccion da rojo.',
      'CU5 (fallo A, WG-H4-003). El hard stop de aprobacion existe como politica general pero no en el punto donde el Orquestador despacha. Espera Y: la SKILL de orchestrator-routing lo lleva escrito EN el punto de despacho, y borrarlo da rojo.',
      'CU6 (fallo B, el candado vacuo). Se muta la superficie enviada al consumidor reintroduciendo el texto retirado. Espera Y: el sensor MUERE el mutante -- si sobrevive, el sensor no verifica nada y no cuenta como hecho.',
      'CU7 (negativo, bloque 7). Se corre el sensor sobre el board. Espera Y: NO toca ni reescribe ningun ticket historico con verification_tier tdd; solo mira superficies de instruccion.',
    ],
  },
  {
    key: 'TASK-234',
    pedido:
      'PEDIDO COMPLETADO contra docs/PLANTILLA-PEDIDO.md (bloque 4 portante).\n\n' +
      '1. OBJETIVO: que "ticket cerrado" signifique "ticket verificado" -- que el cierre exija la\n' +
      'evidencia que la politica dice que exige, y que no se pueda escribir sobre un cierre ya hecho.\n\n' +
      '2. ACTOR: el Orquestador que cierra; y todo lector del board (Mato, el censo, el reviewer de la\n' +
      'proxima corrida) que lee un ticket done y concluye que se verifico.\n\n' +
      '3. PROBLEMA: siete roturas sobre el mismo seam. La mas grave (WG-H-006, reproducida): el\n' +
      'segundo close_task sobre un ticket ya done saltea checkCloseEvidence y\n' +
      'checkDonePredecessorState pero ESCRIBE IGUAL -- 3 comentarios y un segundo linked_commit, sin\n' +
      'review nueva y sin pasar por in_review. El codigo se justifica con el comentario "Not a\n' +
      'loophole", que es falso. Ademas un cuerpo literal "OK" pasa, los cuatro encabezados vacios\n' +
      'pasan, un wargaming que no nombra nada pasa, un HIGH no bloquea, degradar un HIGH no deja\n' +
      'rastro, y un SHA inventado satisface la evidencia.\n\n' +
      '4. CAMINOS Y ACCIONES ESPERADAS -- de aca salen los casos:\n' +
      '   PRINCIPAL: un cierre legitimo (review verde, wargaming corrido, entrega completa) pasa.\n' +
      '   ALTERNATIVO A: alguien llama close_task por segunda vez sobre un ticket ya done.\n' +
      '   ALTERNATIVO B: el cierre viene con la plantilla de entrega pero con bloques vacios.\n' +
      '   FALLO A: el cuerpo del cierre es "OK" o equivalente sin contenido.\n' +
      '   FALLO B: hay un HIGH registrado en el ticket y se intenta cerrar igual.\n' +
      '   FALLO C: se degrada un HIGH a MEDIUM para destrabar el cierre.\n' +
      '   FALLO D: linked_commits trae un SHA con forma valida que no existe en el repo.\n' +
      '   NEGATIVO: un ticket historico ya done no se puede volver un-rewritable por las reglas nuevas.\n\n' +
      '5. CRITERIOS DE HECHO DEL USUARIO: Mato mira el board y puede distinguir mecanicamente un\n' +
      'cierre verificado de uno que no lo esta, y ninguna de las siete roturas se puede reproducir.\n\n' +
      '6. RESTRICCIONES: superficie peligrosa (categoria 4, mutacion de estado persistido compartido,\n' +
      'y categoria 3, forma del estado). Las reglas nuevas rigen para cierres NUEVOS; los ~208 done\n' +
      'historicos no se re-validan retroactivamente. El contrato de resultado vacio (TASK-192) aplica\n' +
      'a la verificacion de SHAs: "no se puede saber" nunca colapsa en "verificado".\n\n' +
      '7. FUERA DE ALCANCE: reescribir cierres pasados; migrar el board.',
    casos: [
      'CU1 (principal). Cierre legitimo: ticket en in_review, comentario de reviewer, entrega con los cuatro bloques con contenido real, wargaming que nombra casos y paths. Espera Y: cierra.',
      'CU2 (alternativo A, WG-H-006). Segundo closeTask sobre un ticket ya done. Espera Y: NO escribe -- ni comentario, ni linked_commits, ni updated_at. Y el comentario del codigo deja de afirmar "Not a loophole" y dice lo que hace.',
      'CU3 (alternativo B, WG-H-002). Cierre con los cuatro encabezados de la plantilla y NADA debajo. Espera Y: rechazado con un error nombrado que dice cual bloque esta vacio.',
      'CU4 (fallo A, WG-H-001). Cierre con el cuerpo literal "OK". Espera Y: rechazado con un error nombrado.',
      'CU5 (fallo A, WG-H-003). Cierre cuyo bloque de wargaming no nombra ni un caso ni un path atacado. Espera Y: rechazado -- un wargaming que no dice que ataco no es un wargaming.',
      'CU6 (fallo B, WG-H-004). Hay un hallazgo HIGH registrado en el ticket (review o wargaming) y se intenta cerrar. Espera Y: BLOQUEA, igual que un HIGH de review bloquea el paso 6.',
      'CU7 (fallo C, WG-H-005). Se degrada un HIGH a MEDIUM. Espera Y: la degradacion exige justificacion registrada y queda detectable despues; no desaparece sin rastro.',
      'CU8 (fallo D, WG-H-011). linked_commits trae un SHA con forma valida inexistente. Espera Y: se distingue de uno que existe; si no se puede verificar se reporta como no verificable, nunca como verificado.',
      'CU9 (legibilidad, WG-H-020). Un lector abre el board. Espera Y: hay una forma mecanica de distinguir un cierre verificado de uno que no lo esta, y la herramienta que lo reporta nunca colapsa "no se puede saber" en "verificado".',
      'CU10 (negativo). Se toca un ticket historico ya done (append de comentario, transicion). Espera Y: sigue siendo escribible -- las guardas nuevas no lo vuelven un-rewritable.',
    ],
  },
  {
    key: 'TASK-235',
    pedido:
      'PEDIDO COMPLETADO contra docs/PLANTILLA-PEDIDO.md (bloque 4 portante).\n\n' +
      '1. OBJETIVO: que el task-store no pierda mutaciones en silencio cuando escribe el segundo\n' +
      'escritor que el propio framework entrega, y que la premisa escrita en su codigo deje de\n' +
      'declarar seguro lo que no lo es.\n\n' +
      '2. ACTOR: cualquier usuario que levante el kanban con /hivemind:task-status y lo deje abierto\n' +
      'mientras el Orquestador trabaja. Es el flujo que el producto documenta, no un caso forzado.\n\n' +
      '3. PROBLEMA: src/task-store.js:16-23 declara "the framework currently runs exactly one\n' +
      'orchestrator per repo". Es falso en el producto entregado: bin/task-board.js es un proceso\n' +
      'aparte y sus POST llaman a transitionStatus y createTask, las mismas funciones no race-safe.\n' +
      'Medido entre procesos: 8 llamadas aceptadas -> 4 en disco; 6 cierres -> 1 en el indice.\n\n' +
      '4. CAMINOS Y ACCIONES ESPERADAS -- de aca salen los casos:\n' +
      '   PRINCIPAL: un unico escritor muta el board; todo queda en disco y el indice coincide.\n' +
      '   ALTERNATIVO A: el board abierto y el Orquestador cerrando a la vez (dos procesos).\n' +
      '   ALTERNATIVO B: dos mutaciones concurrentes sobre tickets DISTINTOS.\n' +
      '   FALLO A: una mutacion es aceptada por la API y no queda en disco (perdida silenciosa).\n' +
      '   FALLO B: tasks/index.json queda desincronizado del conjunto de archivos.\n' +
      '   FALLO C: depends_on con una referencia colgante o un ciclo.\n' +
      '   NEGATIVO: el arreglo no puede serializar la lectura ni hacer el board perceptiblemente lento.\n\n' +
      '5. CRITERIOS DE HECHO DEL USUARIO: con el board abierto, N mutaciones aceptadas producen N\n' +
      'mutaciones en disco -- o un error nombrado, nunca una aceptacion perdida.\n\n' +
      '6. RESTRICCIONES: superficie peligrosa (categoria 4). Toda escritura pasa por\n' +
      'src/atomic-write.js. El costo del arreglo se mide, no se estima.\n\n' +
      '7. FUERA DE ALCANCE: rehacer el modelo de almacenamiento; migrar a una base.',
    casos: [
      'CU1 (principal). Un solo escritor muta el board. Espera Y: todo queda en disco y tasks/index.json coincide con el conjunto de archivos.',
      'CU2 (alternativo A, WG-H-008). Board abierto + Orquestador cerrando, dos PROCESOS reales, N llamadas aceptadas. Espera Y: N mutaciones en disco, o un error nombrado por cada una que no entro. Nunca aceptada-y-perdida.',
      'CU3 (alternativo B). Dos mutaciones concurrentes sobre tickets DISTINTOS. Espera Y: ambas quedan; no se pisan por compartir el indice.',
      'CU4 (fallo B, WG-H-009). Cierres concurrentes. Espera Y: el indice queda consistente, o el desajuste se DETECTA y se reporta en vez de quedar silencioso.',
      'CU5 (fallo C, WG-H-012). Un depends_on apunta a un ticket inexistente. Espera Y: listReady NO se rompe para todo el board -- reporta nombrando el ticket colgante.',
      'CU6 (fallo C, WG-H-012). Un ciclo en depends_on. Espera Y: se detecta y se nombra, en vez de colgar o de mentir con una lista incompleta.',
      'CU7 (negativo). Se mide el tiempo del board antes y despues. Espera Y: sin degradacion perceptible; si hay costo se MIDE y se escribe en el hand-off, no se estima.',
      'CU8 (la premisa). Se lee src/task-store.js:16-23. Espera Y: el comentario nombra a bin/task-board.js como segundo escritor real en otro proceso y deja de declarar seguro lo que no lo es.',
    ],
  },
  {
    key: 'TASK-236',
    pedido:
      'PEDIDO COMPLETADO contra docs/PLANTILLA-PEDIDO.md (bloque 4 portante).\n\n' +
      '1. OBJETIVO: que una guarda de seguridad no falle hacia abierto -- que corromper un archivo de\n' +
      'estado no pueda convertir un cierre denegado en permitido.\n\n' +
      '2. ACTOR: el Orquestador en modo loop (autonomo, sin humano mirando, que es justo el modo donde\n' +
      'la guarda importa) y Mato, que confia en que el Gate 1 del loop lo protege.\n\n' +
      '3. PROBLEMA: getMode (src/operating-mode.js:24) devuelve harness ante cualquier error, en\n' +
      'silencio. Reproducido: bundle sano con mode loop -> loop; bundle truncado a la mitad ->\n' +
      'harness. Y loopModeCloseGuard (src/close-guard.js:487) solo actua cuando el modo es loop. O sea\n' +
      'que truncar un archivo apaga la guarda. El doc comment de close-guard.js:518 declara ese\n' +
      'default "on any error" como si fuera benigno. Al lado, el mismo defecto: el puntero de sesion\n' +
      'no se valida (bundle fantasma y schema_version desconocida pasan).\n\n' +
      '4. CAMINOS Y ACCIONES ESPERADAS -- de aca salen los casos:\n' +
      '   PRINCIPAL: bundle sano con mode loop -> la guarda actua y deniega lo que debe denegar.\n' +
      '   ALTERNATIVO A: no hay sesion, no hay puntero, o active_session_id es null -> harness\n' +
      '     legitimo, sin error (es el estado idle que la doc describe).\n' +
      '   ALTERNATIVO B: el bundle existe y no declara modo -> harness legitimo.\n' +
      '   FALLO A: el bundle esta truncado o con JSON invalido -> hoy degrada a harness en silencio.\n' +
      '   FALLO B: active_session_id apunta a un bundle inexistente (fantasma).\n' +
      '   FALLO C: schema_version desconocida.\n' +
      '   NEGATIVO: el arreglo no puede romper el arranque legitimo de un repo sin state/.\n\n' +
      '5. CRITERIOS DE HECHO DEL USUARIO: un cierre que era denegado con el bundle sano sigue denegado\n' +
      'con el bundle truncado.\n\n' +
      '6. RESTRICCIONES: superficie peligrosa (categorias 2 y 4). Aplica el contrato de resultado\n' +
      'vacio (TASK-192): "no hay modo declarado" y "el estado esta corrupto" tienen que ser\n' +
      'distinguibles por el llamador, sin inferencia.\n\n' +
      '7. FUERA DE ALCANCE: rediseniar el modelo de sesiones; la migracion v1->v2 del bundle.',
    casos: [
      'CU1 (principal). Bundle sano, mode loop, cierre que la politica deniega. Espera Y: denegado.',
      'CU2 (fallo A, WG-H-007). El MISMO cierre con el bundle truncado a la mitad. Espera Y: sigue denegado. La guarda nunca es mas permisiva con el estado corrupto que con el sano.',
      'CU3 (fallo A). getMode sobre un bundle truncado o con JSON invalido. Espera Y: distingue "no hay modo declarado" (legitimo -> harness) de "el estado existe y esta corrupto" (error nombrado); el llamador puede distinguirlos sin inferir.',
      'CU4 (alternativo A, negativo). Repo sin state/, sin puntero, o con active_session_id null. Espera Y: harness sin error -- el estado idle documentado sigue funcionando.',
      'CU5 (alternativo B, negativo). Bundle sano que no declara modo. Espera Y: harness sin error.',
      'CU6 (fallo B, WG-H-010). active_session_id apunta a un bundle inexistente. Espera Y: error nombrado, no silencio.',
      'CU7 (fallo C, WG-H-010). schema_version desconocida en el puntero. Espera Y: error nombrado, no silencio.',
      'CU8 (la afirmacion falsa). Se lee el doc comment de src/close-guard.js sobre el default a harness "on any error". Espera Y: dice lo que el codigo hace despues del arreglo, no lo que hacia antes.',
    ],
  },
  {
    key: 'TASK-237',
    pedido:
      'PEDIDO COMPLETADO contra docs/PLANTILLA-PEDIDO.md (bloque 4 portante).\n\n' +
      '1. OBJETIVO: que el unico mecanismo de coherencia entre las dos copias (repo de desarrollo y\n' +
      'copia enviada al consumidor) no tenga exentos -- empezando por el archivo que se le inyecta a\n' +
      'todos los subagentes.\n\n' +
      '2. ACTOR: todo subagente que recibe el briefing de proyecto; y el que edita una copia creyendo\n' +
      'que el guard le avisa si se olvida de la otra.\n\n' +
      '3. PROBLEMA: tests/agents-parity.spec.js:48 filtra .filter((n) => n.endsWith(".md") && n !==\n' +
      '"project-context.md"). Es el UNICO archivo explicitamente exento, y es precisamente el briefing\n' +
      'que gobierna a cada subagente: dos copias contradictorias pueden convivir con la suite en\n' +
      'verde. Ademas los pares NO lockeados divergen libremente, incluida la skill con la que se corre\n' +
      'el wargaming; y una seccion que se autodeclara "locked -- verbatim in intent, unchanged from\n' +
      'the framework variant" no es identica y nada la lockea.\n\n' +
      '4. CAMINOS Y ACCIONES ESPERADAS -- de aca salen los casos:\n' +
      '   PRINCIPAL: se edita una copia de un par espejo y no la otra -> rojo.\n' +
      '   ALTERNATIVO A: project-context.md tiene contenido legitimamente por-proyecto; el mecanismo\n' +
      '     tiene que cubrir la parte que NO lo es, no exentar el archivo entero.\n' +
      '   ALTERNATIVO B: aparece un par espejo NUEVO que nadie agrego a la lista.\n' +
      '   FALLO A: dos project-context.md contradictorios conviven y la suite queda verde.\n' +
      '   FALLO B: skills/orchestrator-routing vs .claude/skills/orchestrator-routing divergen sin rojo.\n' +
      '   FALLO C: una seccion se autodeclara locked y no lo esta (afirmacion falsa en el texto).\n' +
      '   RESTRICCION DE ENTORNO: .claude/** no se escribe con la herramienta directa.\n\n' +
      '5. CRITERIOS DE HECHO DEL USUARIO: no queda ningun archivo exento sin un motivo escrito, y el\n' +
      'inventario de pares no depende de que alguien se acuerde de agregarlo.\n\n' +
      '6. RESTRICCIONES: el guard de rutas sensibles del harness impide escribir .claude/** con la\n' +
      'herramienta directa; el mecanismo viable documentado es node -e con fs.copyFileSync.\n\n' +
      '7. FUERA DE ALCANCE: unificar las dos copias en una sola (es un cambio de arquitectura del\n' +
      'plugin, no de este ticket). NOTA A FAVOR DEL SUT: WG-H-016 es definicion_equivocada del\n' +
      'atacante y NO es defecto nuestro -- el guard SI descubre agentes nuevos comparando el conjunto\n' +
      'de archivos; ya se corrigio en la definicion de qa-agents.',
    casos: [
      'CU1 (principal). Se edita agents/developer.md y no .claude/agents/developer.md. Espera Y: rojo (esto ya funciona; el caso existe para no romperlo).',
      'CU2 (fallo A, WG-H-013). Se hacen contradictorios los dos project-context.md. Espera Y: ROJO. Hoy la suite queda verde.',
      'CU3 (alternativo A). project-context.md tiene contenido legitimamente por-proyecto. Espera Y: el mecanismo cubre la parte que NO es por-proyecto y el motivo de lo que queda afuera esta ESCRITO; no se exenta el archivo entero en silencio.',
      'CU4 (fallo B, WG-H-014). Divergen skills/orchestrator-routing/SKILL.md y su copia en .claude/skills/. Espera Y: ROJO -- es la superficie con la que se corre el wargaming.',
      'CU5 (alternativo B, WG-H-014). Aparece un par espejo nuevo que nadie agrego a ninguna lista. Espera Y: queda cubierto por descubrimiento, o su ausencia del lock se REPORTA. No pasa desapercibido.',
      'CU6 (fallo C, WG-H-015). Una seccion se autodeclara "locked -- verbatim in intent" y no es identica. Espera Y: o es identica y esta lockeada de verdad, o deja de autodeclararse locked. No se deja una afirmacion falsa en el texto.',
      'CU7 (restriccion de entorno). Se sincroniza una copia bajo .claude/**. Espera Y: el mecanismo documentado (node -e con fs.copyFileSync) sigue siendo viable y queda escrito; el arreglo no exige una herramienta que el guard bloquea.',
    ],
  },
];

for (const it of items) {
  await appendComment({ repoRoot, key: it.key, author: 'orchestrator', body: it.pedido });
  const lista =
    'LISTA DE CASOS DE USO / PATHS DE USO (CLAUDE.md Workflow step 2, Regla 1). Derivada del bloque 4\n' +
    'del pedido registrado en el comentario anterior, un caso por camino, incluidos alternativos y de\n' +
    'fallo. Esta es la lista contra la que el Developer programa y contra la que el WARGAMING ataca al\n' +
    'final. Un caso que no pase como esta escrito se ESCALA, no se cambia en silencio.\n\n' +
    it.casos.map((c, i) => `${i + 1}. ${c}`).join('\n');
  await appendComment({ repoRoot, key: it.key, author: 'orchestrator', body: lista });
  await appendComment({ repoRoot, key: it.key, author: 'orchestrator', body: APROBACION });
  console.log(`${it.key}: pedido + ${it.casos.length} casos + constancia de aprobacion registrados`);
}
