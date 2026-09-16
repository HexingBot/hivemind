# Plantilla de ENTREGA — la salida del proyecto (y del ticket)

Esta es la **salida** del flujo de hivemind, la otra punta de `docs/PLANTILLA-PEDIDO.md`.
Existe por la misma razon que la de entrada: con los gates por proceso eliminados
(2026-09-16), lo que prueba que algo se hizo bien no es una casilla tildada sino **el
resultado medido contra los casos de uso que el humano aprobo al principio**. La entrega es
donde se muestra ese cierre de circuito.

**Quien la escribe y cuando.** El Orquestador, al cierre — despues de que la review este verde
y despues de la pasada de wargaming, antes o junto al `close_task`. Para un proyecto entero, el
mismo formato agregando los tickets.

**Regla de tamaño.** Terso. Una linea por caso, evidencia solo si se pide. Un reporte de entrega
que nadie lee no entrega nada.

---

## Los bloques de la entrega

### 1. Casos de uso aprobados — la referencia

La lista que el humano aprobo al principio, **citada, no reescrita**. Es la referencia contra la
que se juzga todo lo demas, asi que se copia tal cual quedo aprobada (o se apunta al comentario
del ticket donde quedo registrada) mas la fecha y quien la aprobo.

Por cada caso, una linea con su estado final: **cumplido / no cumplido / cambiado (con la
escalada que lo cambio)**. Un caso que cambio sin escalada es un hallazgo, no una nota al pie.

### 2. Resultado de la implementacion

Que quedo hecho, en terminos del usuario y no del diff:

- Que puede hacer ahora el actor que antes no podia.
- Donde quedo (archivos, comandos, pantallas, endpoints — lo que corresponda).
- Commits y/o PR.
- Lo que quedo AFUERA a proposito, y por que. Explicito: un alcance recortado en silencio es lo
  mismo que un alcance no cumplido.

### 3. Reporte del wargaming — **la verificacion de registro**

Esta es la verificacion real del flujo, asi que este bloque no puede ser una linea que diga
"paso". Tres cosas, siempre las tres:

- **Que se ataco.** Contra que casos aprobados y contra que paths alternativos/fallo se fue el
  adversario. Un caso aprobado que no fue atacado **no esta verificado**, y se dice asi.
- **Que sobrevivio.**
- **Que NO sobrevivio.** Cada hallazgo con su severidad. Un HIGH bloquea el cierre: vuelve al
  Developer y no hay entrega hasta que se resuelva.
- **Los e2e afectados corridos aca** (nombrados y con su resultado), porque desde el 2026-09-16
  se ejecutan en este paso y no antes.
- **Veredicto.**

### 4. UAT — solo si se pidio o se necesito

- Si `requires_uat: true` (o el ticket es `uat-only`): el guion de UAT es **la misma lista de
  casos de uso aprobados**, reusada sin re-derivar, con el veredicto por paso y el resultado
  general, en la convencion exacta que el guard acepta (ver la "UAT procedure" de la SKILL de
  orchestrator-routing).
- Si no se pidio: se escribe **"UAT no solicitado"** y por que. No se omite el bloque en
  silencio — un bloque ausente se lee despues como "se hizo y no se anoto".

### 5. Estado y deudas

Lo que queda abierto: hallazgos MEDIUM/LOW no accionados, residuales aceptados, tickets que se
abrieron a partir de esto. Nombrados, no insinuados.

---

## Formulario en limpio (copiar y completar)

```
ENTREGA — <TICKET o PROYECTO>

1. CASOS DE USO APROBADOS (aprobados por <quien> el <fecha>)
   1. <caso> -> cumplido | no cumplido | cambiado (escalado el <fecha>)
   2. ...

2. RESULTADO
   - El actor ahora puede: ...
   - Donde quedo: ...
   - Commits / PR: ...
   - Fuera de alcance a proposito: ...

3. WARGAMING
   - Atacado: <casos y paths>
   - Sobrevivio: ...
   - No sobrevivio: <hallazgo> (<severidad>)
   - E2E corridos aca: <specs> -> <resultado>
   - Veredicto: ...

4. UAT
   - Solicitado: si | no (<motivo>)
   - <guion reusado + veredictos, si aplica>

5. ESTADO Y DEUDAS
   - ...
```

## El invariante que hace que esto sirva

**Un bloque de esta plantilla no se completa con "OK".** Los tres que se prestan a eso son los
que mas importan: un caso de uso sin estado, un wargaming sin lo que se ataco, y un UAT ausente
sin decir que no se pidio. Los tres se leen despues como trabajo verificado cuando no lo esta —
que es exactamente el modo de falla que la politica del 2026-09-16 existe para eliminar.

**Sobre esto, honestidad: no hay sensor automatico que verifique el contenido de un cierre.** Un
comentario de cierre cuyo cuerpo literal es "OK" pasa todos los guards existentes — el unico
sensor automatico de este par de plantillas verifica que los ARCHIVOS de la plantilla existan y
tengan sus bloques (`tests/request-delivery-templates-docs.spec.js`), no que una entrega concreta
los haya completado de verdad. El control de que los 4 bloques de una entrega esten realmente
llenos es **humano** — quien lee la entrega — y hoy es una deuda de auditoria abierta, no un
gate por proceso: la politica del 2026-09-16 prohibe agregar un matcher de strings sobre el
cuerpo del comentario de cierre para "resolverla" por codigo.

## La otra punta

Lo que se recoge al principio tiene su propia forma: `docs/PLANTILLA-PEDIDO.md`.
