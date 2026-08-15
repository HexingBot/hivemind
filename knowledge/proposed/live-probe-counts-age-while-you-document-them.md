---
id: live-probe-counts-age-while-you-document-them
problem: >-
  Una sonda instrumentada que sigue corriendo mientras se documentan sus
  resultados convierte cualquier conteo crudo en un blanco movil. La cifra queda
  vieja entre que se mide y que se escribe, y despues vuelve a quedar vieja
  entre que la revisa un reviewer y que se corrige. El riesgo real no es la
  imprecision: es que una observacion fechada se lea despues como una constante
  del sistema.
symptoms:
  - >-
    La doc dice N de M y al recontar da otra cosa, sin que nadie haya cambiado
    codigo
  - Reviewer y autor reportan cifras distintas y los dos tienen razon
  - >-
    La muestra crecio porque la propia herramienta de medicion capturo a los
    agentes que la estaban revisando
  - >-
    Una frase tipo muestra de 18 payloads sobre 5 subagentes quedo obsoleta
    dentro del mismo ticket que la escribio
solution: >-
  Afirmar el CORRELATO ESTRUCTURAL, no la fraccion. Un correlato del tipo todo X
  observado cumplio Y se sostiene entre rondas de medicion; un porcentaje no. En
  TASK-219 la afirmacion durable fue que todo SubagentStop con agent_type vacio
  llego sin ningun SubagentStart previo para ese agent_id (se sostuvo 3 de 3 y
  despues 4 de 4), mientras la cifra de casos vacios se corrigio tres veces. Si
  ademas hace falta dar un numero, darle alcance explicito y fecha (N de M en
  una muestra de tantos registros capturada el AAAA-MM-DD durante TASK-XXX) para
  que se lea como observacion y no como invariante. Y retirar la sonda apenas
  termina la investigacion: dejarla viva contamina las mediciones posteriores y,
  si esta cableada en settings, puede volver momentaneamente falsas afirmaciones
  de la doc sobre el estado de configuracion del repo.
tags:
  - investigacion-empirica
  - documentacion
  - hooks
  - calibracion
  - sonda
  - metodologia
projects:
  - hivemind
created_at: '2026-08-15T18:30:00.000Z'
last_seen_at: '2026-08-15T18:30:00.000Z'
---

