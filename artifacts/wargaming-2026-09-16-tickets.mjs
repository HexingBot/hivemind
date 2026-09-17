// Crea los 5 tickets del wargaming QA-vs-Hivemind 2026-09-16.
// Pasa por createTask() de src/task-store.js, o sea por los MISMOS guards
// (ajv, enums, cap de ACs) que el servidor MCP, que sigue caido.
import { createTask } from '../src/task-store.js';

const repoRoot = '/opt/data/home/hivemind';

const tickets = [
  {
    title: 'RAIZ: publicar la politica a la superficie que la ejecuta (propagacion del plugin)',
    description:
      'WG-H4-001 es la rotura que ORDENA toda la campana del 2026-09-16. El plugin instalado es ' +
      'v0.22.0 (sha 468f5a2, instalado 2026-08-26) y los agentes que Claude Code spawnea salen de ' +
      'ahi, no del repo. En ese agente viejo el grep de approv|aprob|use.case|hard stop da CERO y ' +
      'verification_tier sigue declarado como "(tdd, tests-after, o uat-only; absent means tdd)", o ' +
      'sea que precede tambien a la eliminacion de TDD del 2026-08-13. Medido en vivo por la ola 4: ' +
      'tres Developers reales recibieron el mismo pedido variando solo la constancia de aprobacion ' +
      '(P1 sin lista, P2 con lista sin constancia, P3 con un "dale, segui" ajeno) y se negaron 0 de ' +
      '3, implementaron 3 de 3. El veredicto NO es indisciplina del Developer: la regla de negarse ' +
      'NO EXISTE en el agente ejecutado. Confirmacion en primera persona: la skill ' +
      'orchestrator-routing que el propio Orquestador auditor cargo al arrancar era la vieja. ' +
      'HALLAZGOS CUBIERTOS: WG-H4-001 (alta, la raiz), WG-H4-002 (alta, consecuencia observable), ' +
      'WG-H4-003 (alta, el gate tampoco tiene contraparte del lado del Orquestador), WG-H4-004 ' +
      '(baja, encadenado: el red-green planting que fabrica los temporales es obligatorio SOLO en el ' +
      'agente de la era TDD), WG-H-017 (media, vitest.config.all.js sigue instruyendo correr los e2e ' +
      'ANTES del hand-off, contra la decision del 2026-09-16), WG-H-018 (media, las dos listas de ' +
      'e2e afectados del unico ticket bajo la politica nueva se contradicen). El repo YA tiene la ' +
      'politica correcta; lo que falta es que llegue al consumidor y un sensor que detecte la deriva.',
    acceptance_criteria: [
      'El mecanismo real de publicacion queda escrito y verificado, no asumido: marketplace git hivemind-marketplace -> github.com/HexingBot/hivemind.git, cache por version en ~/.claude/plugins/cache/hivemind-marketplace/hivemind/<version>, scope user, y el hecho de que .claude/agents|skills de un proyecto OVERRIDEA al plugin.',
      'Existe un sensor ejecutable que falla cuando una superficie enviada al consumidor (agents/, skills/, commands/) contradice la politica vigente: cero ocurrencias de "absent means tdd" / tests-first como gate, y presencia obligatoria del gate de aprobacion humana y del wargaming final en developer.md, reviewer.md y orchestrator-routing/SKILL.md.',
      'WG-H-017: vitest.config.all.js deja de instruir que los e2e corren antes del hand-off y dice lo que la politica dice desde el 2026-09-16 (los e2e corren en el paso de wargaming).',
      'WG-H-004 del lado del Orquestador (WG-H4-003): la SKILL de orchestrator-routing lleva escrito el hard stop de aprobacion en el punto donde el Orquestador despacha, no solo como politica general.',
      'Los tickets historicos con verification_tier tdd NO se reescriben (TASK-212 sigue vigente); el sensor solo mira superficies de instruccion, no el board.',
      'npm test y npm run test:all verdes con el sensor nuevo incluido.',
    ],
    priority: 'high',
    verification_tier: 'tests-after',
    requires_uat: true,
    labels: ['wargaming-2026-09-16', 'raiz', 'propagacion'],
  },
  {
    title: 'Guardas de cierre: el doble cierre escribe, el cuerpo "OK" pasa, y un HIGH no bloquea',
    description:
      'Siete roturas sobre el mismo seam: lo que hace falta para que un ticket se declare cerrado. ' +
      'WG-H-006 (ALTA, reproducida por el Orquestador sobre copia efimera): el segundo close_task ' +
      'sobre un ticket ya done, sin review nueva y sin pasar por in_review, DEJA 3 comentarios y ' +
      'agrega el segundo linked_commit. src/task-store.js saltea checkCloseEvidence y ' +
      'checkDonePredecessorState porque status === done, y se justifica con el comentario "a no-op ' +
      're-affirmation" / "Not a loophole". Las guardas se saltean pero LA ESCRITURA OCURRE: cualquiera ' +
      'puede adjudicar commits arbitrarios a un ticket cerrado y dejar el ultimo comentario -- el que ' +
      'un lector y el censo toman como "el cierre" -- sin ninguna verificacion. El comentario es ' +
      'falso y hay que corregirlo junto con el codigo. WG-H-001 (alta, confiesa TASK-231): un cierre ' +
      'con el cuerpo literal "OK" pasa todas las guardas. WG-H-002 (alta, nueva): los cuatro ' +
      'encabezados de docs/PLANTILLA-ENTREGA.md con NADA debajo pasan igual. WG-H-003 (alta, nueva): ' +
      'un registro de wargaming que no nombra ni un caso ni un path pasa igual. WG-H-004 (alta, ' +
      'verificada): src/close-guard.js no tiene NI UNA referencia a wargaming -- no es que la guarda ' +
      'falle, no existe. WG-H-005 (media): degradar un HIGH a MEDIUM no deja rastro ni exige ' +
      'justificacion. WG-H-011 (media): linked_commits valida la forma y no la existencia, asi que un ' +
      'SHA inventado satisface la evidencia de cierre. WG-H-020 (alta, de LEGIBILIDAD): hoy un lector ' +
      'del board no puede distinguir un cierre verificado de uno que no lo esta.',
    acceptance_criteria: [
      'WG-H-006: un segundo closeTask sobre un ticket ya done NO escribe -- ni comentario, ni linked_commits, ni updated_at. El comentario "Not a loophole" se corrige para decir lo que el codigo hace de verdad.',
      'WG-H-001/WG-H-002/WG-H-003: el cierre exige un cuerpo con contenido real bajo los bloques de docs/PLANTILLA-ENTREGA.md -- un cuerpo "OK", los encabezados vacios, o un bloque de wargaming que no nombra ningun caso ni path atacado son RECHAZADOS con un error nombrado y accionable.',
      'WG-H-004: un hallazgo HIGH registrado en el propio ticket (review o wargaming) BLOQUEA el cierre, igual que un HIGH de review bloquea el paso 6.',
      'WG-H-005: degradar un HIGH deja rastro -- la degradacion exige justificacion registrada y es detectable despues.',
      'WG-H-011: la evidencia de cierre distingue un SHA que existe en el repo de uno inventado; si no puede verificarlo lo reporta como no verificable en vez de aceptarlo en silencio (contrato de resultado vacio, TASK-192).',
      'WG-H-020: existe una forma mecanica de distinguir en el board un cierre verificado de uno que no lo esta, y la herramienta que lo reporta nunca colapsa "no se puede saber" en "verificado".',
      'Ningun ticket historico ya done se re-valida retroactivamente ni queda un-rewritable: las guardas nuevas rigen para cierres NUEVOS.',
      'Candados de regresion para cada rotura, reusando las reproducciones del wargaming. npm test y test:all verdes.',
    ],
    priority: 'high',
    verification_tier: 'tests-after',
    requires_uat: true,
    labels: ['wargaming-2026-09-16', 'close-guard'],
  },
  {
    title: 'Concurrencia del task-store: el segundo escritor que la premisa omite (bin/task-board.js)',
    description:
      'WG-H-008 y WG-H-009 (ALTAS, alcance corregido por el Orquestador). El atacante los reporto como ' +
      'roturas de concurrencia; el SUT declara la premisa en su propio codigo (src/task-store.js:16-23: ' +
      '"the framework currently runs exactly one orchestrator per repo"), asi que bajo esa premisa ' +
      'forzar concurrencia seria fabricar el hallazgo. PERO LA PREMISA ES FALSA EN EL PRODUCTO QUE SE ' +
      'ENTREGA: bin/task-board.js es un PROCESO APARTE -- el kanban que la propia skill task-status le ' +
      'dice al usuario que levante -- y sus endpoints POST llaman a transitionStatus y createTask, las ' +
      'mismas funciones no race-safe (src/task-board.js:58, :1308, :1389). Ese segundo escritor no es ' +
      'un orquestador, asi que la premisa no lo contempla. Medicion del atacante entre procesos: 8 ' +
      'llamadas aceptadas -> 4 en disco, y 6 cierres -> 1 en el indice. La precondicion es alcanzable ' +
      'con solo tener el board abierto mientras el orquestador cierra un ticket, que es el flujo que ' +
      'el propio producto documenta. Lo que se reporta NO es "el task-store tiene una carrera" (eso ' +
      'esta declarado), sino que la premisa que lo declara seguro omite un escritor que el framework ' +
      'mismo entrega. Se suma WG-H-012 (media): una referencia colgante en depends_on rompe listReady ' +
      'para TODO el board, y el ciclo no se detecta.',
    acceptance_criteria: [
      'La premisa de src/task-store.js:16-23 se corrige para nombrar a bin/task-board.js como segundo escritor real en otro proceso -- el comentario deja de declarar seguro lo que no lo es.',
      'WG-H-008: dos escritores concurrentes en PROCESOS distintos no pierden mutaciones en silencio; una mutacion aceptada o queda en disco o falla con un error nombrado (nunca aceptada-y-perdida). Reproducible con la medicion del atacante (N llamadas aceptadas -> N en disco).',
      'WG-H-009: tasks/index.json queda consistente con el conjunto de archivos tras cierres concurrentes, o el desajuste se detecta y se reporta en vez de quedar silencioso.',
      'WG-H-012: una referencia colgante en depends_on no rompe listReady para todo el board -- se reporta nombrando el ticket colgante; un ciclo en depends_on se detecta en vez de colgar o mentir.',
      'El arreglo no serializa el camino de lectura ni degrada el tiempo del board de forma perceptible; si hay un costo se mide y se escribe.',
      'Candados de regresion con procesos reales (tier e2e), reusando la reproduccion del atacante. npm test y test:all verdes.',
    ],
    priority: 'high',
    verification_tier: 'tests-after',
    requires_uat: false,
    labels: ['wargaming-2026-09-16', 'concurrencia', 'task-store'],
  },
  {
    title: 'Fail-open del modo: corromper un archivo de estado convierte un cierre DENEGADO en PERMITIDO',
    description:
      'WG-H-007 (ALTA, reproducida por el Orquestador). Con el bundle sano y mode: loop, getMode ' +
      '(src/operating-mode.js:24) devuelve loop. Con el bundle TRUNCADO A LA MITAD devuelve harness ' +
      '-- sin lanzar, sin avisar, sin dejar rastro. Y la guarda de cierre autonomo (Gate 1, ' +
      'loopModeCloseGuard en src/close-guard.js:487) solo actua cuando el modo es loop. O sea: ' +
      'corromper un archivo de estado convierte un cierre denegado en permitido. Es una guarda de ' +
      'seguridad que falla HACIA ABIERTO, que es la direccion equivocada -- y el propio doc comment ' +
      'de close-guard.js:518 declara el default a harness "on any error" como si fuera benigno. Se ' +
      'suma WG-H-010 (media): el puntero de sesion no se valida, asi que un bundle fantasma ' +
      '(active_session_id apuntando a un directorio inexistente) y una schema_version desconocida ' +
      'pasan sin ruido -- el mismo defecto de degradacion silenciosa en el seam de al lado.',
    acceptance_criteria: [
      'WG-H-007: un bundle ilegible, truncado o con JSON invalido NO se degrada en silencio a harness. getMode distingue "no hay sesion / no hay modo declarado" (legitimo -> harness) de "el estado existe y esta corrupto" (error nombrado), y el llamador puede distinguirlos -- contrato de resultado vacio (TASK-192).',
      'La guarda de cierre autonomo deja de fallar hacia abierto: ante un estado corrupto DENIEGA o escala, nunca permite. Un cierre que era denegado con el bundle sano sigue denegado con el bundle truncado.',
      'WG-H-010: el puntero state/session.json se valida -- un active_session_id que apunta a un bundle inexistente y una schema_version desconocida se reportan con un error nombrado en vez de pasar.',
      'El doc comment de src/close-guard.js que describe el default a harness "on any error" se corrige para decir lo que el codigo hace despues del arreglo.',
      'No se rompe el arranque legitimo: un repo sin state/, sin puntero o con active_session_id null sigue siendo harness sin error (es el estado idle documentado).',
      'Candados de regresion para las dos direcciones (sano -> permitido segun politica; corrupto -> nunca mas permisivo que sano). npm test y test:all verdes.',
    ],
    priority: 'high',
    verification_tier: 'tests-after',
    requires_uat: false,
    labels: ['wargaming-2026-09-16', 'fail-open', 'close-guard'],
  },
  {
    title: 'Paridad: project-context.md exento del unico mecanismo de coherencia, y los pares no lockeados',
    description:
      'WG-H-013 (MEDIA, verificada por el Orquestador en tests/agents-parity.spec.js:48): el filtro es ' +
      '.filter((n) => n.endsWith(".md") && n !== "project-context.md"). Es el UNICO archivo del ' +
      'directorio explicitamente exento, y es precisamente el briefing de proyecto que se le inyecta a ' +
      'TODOS los subagentes -- o sea que dos copias contradictorias del texto que gobierna a cada ' +
      'subagente pueden convivir con la suite en verde. WG-H-014 (media, anticipado por UC-12 path 4): ' +
      'los pares NO lockeados divergen libremente, incluida la skill con la que se corre el wargaming. ' +
      'WG-H-015 (baja): una seccion que se autodeclara "locked -- verbatim in intent, unchanged from ' +
      'the framework variant" no es identica y nada la lockea. NOTA A FAVOR DEL SUT, que se registra ' +
      'porque el informe corrigio a su propio atacante: WG-H-016 es definicion_equivocada y NO es un ' +
      'defecto nuestro -- el guard de paridad SI descubre agentes nuevos comparando el conjunto de ' +
      'archivos, verificado en las dos direcciones; la definicion de qa-agents estaba mal y ya se ' +
      'corrigio alla.',
    acceptance_criteria: [
      'WG-H-013: project-context.md deja de estar exento del mecanismo de coherencia -- o entra al guard de paridad, o queda cubierto por un mecanismo propio que detecte dos copias contradictorias. Si hay un motivo real para la exencion (contenido por-proyecto), el mecanismo cubre la parte que NO es por-proyecto y el motivo queda escrito.',
      'WG-H-014: el inventario de pares espejo se vuelve exhaustivo por descubrimiento en vez de por lista escrita a mano -- un par nuevo queda cubierto sin que nadie lo agregue, o su ausencia del lock se reporta.',
      'La skill orchestrator-routing (skills/ vs .claude/skills/) queda lockeada: es la superficie con la que se corre el wargaming y hoy puede divergir sin un rojo.',
      'WG-H-015: la seccion que se autodeclara "locked" o bien es identica y esta lockeada de verdad, o bien deja de autodeclararse locked. No se deja una afirmacion falsa en el texto.',
      'El arreglo no rompe la escritura: el guard de rutas sensibles del harness impide escribir .claude/** con la herramienta directa; el mecanismo de sincronizacion documentado (node -e con fs.copyFileSync) sigue siendo viable y queda escrito.',
      'Candados de regresion para las tres roturas. npm test y test:all verdes.',
    ],
    priority: 'medium',
    verification_tier: 'tests-after',
    requires_uat: false,
    labels: ['wargaming-2026-09-16', 'paridad'],
  },
];

for (const t of tickets) {
  const { key } = await createTask({ repoRoot, ...t });
  console.log(`${key}  ${t.title}`);
}
