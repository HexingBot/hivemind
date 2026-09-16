# Plantilla de PEDIDO — la entrada del proyecto (y del ticket)

Esta es la **entrada** del flujo de hivemind. Existe por un motivo concreto: desde el
2026-09-16 TDD esta eliminado y los gates por proceso tambien, asi que la **definicion de
casos de uso / paths de uso** es la unica definicion de lo que el cambio tiene que hacer,
y el wargaming del final verifica contra ella. Unos casos de uso solo pueden ser tan buenos
como el pedido del que salieron. Esta plantilla es la forma de ese pedido.

**Quien la usa y cuando.**

- **Proyecto nuevo:** el Orquestador la recoge antes de `PROJECT.md` (intake), o la usa para
  completar lo que el humano ya conto en prosa.
- **Ticket:** el mismo formato, en chico. La descripcion y los criterios de aceptacion del
  ticket son la version ya estructurada de estos bloques.

**Regla de uso, no burocracia.** Un pedido en prosa suelta NO se rechaza. Se **completa contra
esta plantilla** y se devuelve completado para que el humano confirme. Lo que nunca se hace es
rellenar un bloque inventando: si un bloque no se puede completar sin suponer, se pregunta.

**Si el humano delega ("hacelo vos").** No se da nada por aprobado. El Orquestador redacta un
borrador del pedido completo, marcando explícitamente con la etiqueta **SUPUESTO** cada bloque
que tuvo que completar sin que el humano lo dijera, y lo somete a **confirmación explícita** antes
de derivar un solo caso de uso. El silencio no es aprobación — ni acá ni en la aprobación de la
lista de casos de uso misma (ver "Del pedido a los casos de uso" más abajo).

---

## Los bloques del pedido

### 1. Que se quiere — objetivo (1-2 lineas)

Que existe al final que hoy no existe. En una o dos lineas, en lenguaje del que pide, no del
que implementa.

> Ejemplo: "Que un usuario pueda exportar su historial de pagos a CSV desde la pantalla de
> cuenta, sin pedirselo a soporte."

### 2. Para quien — actor / usuario

Quien lo va a usar. Si son varios, cual es el principal. "Un usuario" a secas casi nunca
alcanza: el actor decide que caminos existen.

> Ejemplo: "El titular de la cuenta (no el staff de soporte, que ya tiene su propia via)."

### 3. El problema que resuelve — contexto

Que pasa hoy sin esto, y por que duele. Este bloque es el que despues permite decir si una
solucion sirvio: sin problema escrito, cualquier cosa que se entregue "cumple".

> Ejemplo: "Hoy el usuario abre un ticket de soporte y espera ~2 dias. Son ~40 pedidos por mes
> y el 100% termina en el mismo CSV armado a mano."

### 4. Que caminos / acciones espera — **el bloque del que salen los casos de uso**

El bloque central. Que hace el usuario, paso a paso, y que espera que pase. **No solo el camino
feliz**: aca van tambien los caminos alternativos y los de fallo, porque son exactamente los que
el wargaming va a atacar despues.

Una forma que funciona, una linea por camino:

- Camino principal: hace X → espera Y.
- Alternativo: si pasa A, hace X' → espera Y'.
- Fallo: si falta / falla B → espera que le pase Z (no "que no pase nada").

> Ejemplo:
> - Principal: entra a Cuenta → Exportar → espera bajar un CSV con sus pagos.
> - Alternativo: no tiene ningun pago → espera un CSV con encabezado y cero filas, no un error.
> - Alternativo: tiene 50.000 pagos → espera que igual termine, aunque tarde o llegue por mail.
> - Fallo: se cae a mitad de la descarga → espera poder reintentar sin que se duplique nada.
> - Fallo: pide el CSV de otra cuenta cambiando el id en la URL → espera que NO se lo den.

**Si este bloque queda vacio, o queda como una repeticion de los criterios de aceptacion, es un
hueco a cerrar con el humano ANTES de despachar a implementacion — no despues.** Una linea por
criterio de aceptacion no es una definicion de paths de uso.

### 5. Criterios de "hecho" del usuario

Que tiene que poder hacer el usuario al final para que esto se de por hecho. Escrito como algo
observable por una persona (ver "Observable-by-a-person criterion" en `CLAUDE.md`), no como una
afirmacion sobre el codigo.

> Ejemplo: "Puedo bajar mi CSV yo solo, en menos de un minuto, sin abrir un ticket."

### 6. Restricciones / entorno (si aplica)

Lo que acota la solucion y no se puede negociar sin volver a preguntar: plataforma, stack, datos
sensibles, plazos, integraciones existentes, cosas que NO hay que tocar.

> Ejemplo: "El CSV no puede incluir el numero de tarjeta completo. Tiene que andar en el portal
> actual, sin app nueva."

### 7. Fuera de alcance (opcional, pero barato)

Lo que explicitamente NO entra. Una linea aca ahorra una discusion entera despues.

---

## Del pedido a los casos de uso — el mapeo

El Orquestador deriva la lista de casos de uso (Workflow paso 2 de `CLAUDE.md`) **de este pedido**,
no del codigo. El mapeo es directo, y es lo que hace que la plantilla no sea decoracion:

| Bloque del pedido | A donde va en los casos de uso |
|---|---|
| 1. Objetivo | El encabezado de la lista: contra que se juzga el conjunto |
| 2. Actor | El sujeto de cada caso ("el titular de la cuenta hace X") |
| 3. Problema | El criterio para descartar casos que no le sirven a nadie |
| 4. Caminos esperados | **Un caso de uso por camino**, incluidos los alternativos y los de fallo |
| 5. Criterios de hecho | El "espera Y" de cada caso, y el guion de UAT si `requires_uat: true` |
| 6. Restricciones | Casos de uso negativos: que NO tiene que poder pasar |
| 7. Fuera de alcance | Lo que el wargaming no ataca, dicho de antemano |

La lista resultante se presenta al humano y **el humano la aprueba antes de que exista una sola
linea de codigo** (hard stop, decision de Mato del 2026-09-16). Sin esa aprobacion no se despacha
al Developer, y el wargaming del final no tiene contra que verificar.

---

## Formulario en limpio (copiar y completar)

```
PEDIDO

1. Objetivo (1-2 lineas):
2. Actor / usuario:
3. Problema que resuelve:
4. Caminos y acciones esperadas:
   - Principal: hace ... -> espera ...
   - Alternativo: ... -> espera ...
   - Fallo: ... -> espera ...
5. Criterios de "hecho" del usuario:
6. Restricciones / entorno:
7. Fuera de alcance:
```

## Que bloques son portantes para la derivacion (y que pasa si faltan)

No todos los bloques pesan igual para el paso de derivar casos de uso. Nombrarlo evita que dos
sesiones distintas resuelvan distinto que hacer si falta un bloque:

- **Bloques 4 y 5 — portantes, sostienen el "hace X / espera Y" de cada caso.** El bloque 4 da el
  "hace X"; el bloque 5 da el "espera Y". Si cualquiera de los dos esta vacio, o el 4 es una mera
  repeticion de los criterios de aceptacion, **eso bloquea el despacho** — es el mismo hueco que ya
  nombra la seccion 4 mas arriba, no una regla nueva.
- **Bloque 2 — portante, da el sujeto.** Sin actor no hay a quien atribuirle cada caso ("un
  usuario" a secas no alcanza). Un bloque 2 vacio se completa preguntando antes de derivar, igual
  que el 4 y el 5.
- **Bloque 6 — portante para los casos negativos.** Si falta, simplemente no hay casos negativos
  explicitos en la lista derivada — no bloquea el despacho, pero es un hueco a nombrar en la lista
  presentada para aprobacion, no a rellenar en silencio.
- **Bloques 1, 3 y 7 — dan contexto, no bloquean la derivacion mecanica.** Un objetivo (1),
  problema (3) o fuera-de-alcance (7) pobre no impide escribir "hace X, espera Y"; degrada la
  calidad del pedido igual, y se pregunta si falta, pero no es, por si solo, un hueco que frene el
  despacho.

## Que NO es esta plantilla

- **No es un gate por proceso nuevo.** No hay una casilla separada que tildar ni un paso de
  proceso adicional: el unico punto de bloqueo es el que ya existe — el hard stop de aprobacion
  humana de la lista de casos de uso (ver mas abajo) — y los bloques portantes de arriba son lo que
  hace que esa lista llegue completa a ese hard stop, no una puerta previa distinta.
- **El wargaming NO detecta un bloque 4 pobre.** Es al reves: el adversario ataca exactamente lo
  que el bloque 4 enumero, asi que un bloque 4 vacio o pobre produce una lista de casos pobre y una
  pasada de wargaming que la aprueba trivialmente porque no hay nada mas contra que atacar — el
  problema queda invisible despues, no expuesto. Por eso los bloques 4 y 5 bloquean el despacho en
  vez de dejarse para que "se note" mas adelante.
- **No reemplaza los criterios de aceptacion del ticket.** Los alimenta.
- **No fija el COMO.** El pedido dice que se quiere y que caminos existen. Como se construye es
  territorio libre del desarrollo — ver "Movimiento libre en el desarrollo" en `CLAUDE.md`.

## La otra punta

Lo que se entrega al final tiene su propia forma: `docs/PLANTILLA-ENTREGA.md`.
