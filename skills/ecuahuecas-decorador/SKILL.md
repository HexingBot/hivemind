---
name: ecuahuecas-decorador
description: Carga cuando Mato envía texto crudo de una reseña de ecuahuecas por Telegram y pide decorarlo. Reescribe la reseña en 4 estilos (Formal/descriptivo, Jerga ecuatoriana/directa, Corto/viral, Ejecutivo/Arquitecto de software), Mato elige, y el texto elegido se guarda en Firestore como reseña final.
---

# Decorador de Reseñas — Ecuahuecas

Este skill transforma el texto crudo de una reseña de ecuahuecas (restaurantes ecuatorianos) en
**4 versiones estilizadas** para que Mato elija la que mejor encaje. El flujo completo es:

1. Mato envía el texto crudo de la reseña por Telegram
2. El skill recibe el texto y lo reescribe en 4 estilos
3. Mato elige qué versión usar
4. El texto elegido se persiste en Firestore como la reseña final del local

---

## Contrato de entrada

**Input:** texto crudo en español, normalmente describiendo la experiencia en una ecuahueca.
Puede incluir: qué se pidió, sabor, atención, ambiente, precio, ubicación, recomendaciones.
Puede ser una frase suelta, un párrafo largo, o viñetas.

**Output para Mato:** 4 versiones del mismo texto, claramente separadas y numeradas,
para que Mato responda con el número de la elegida.

---

## Los 4 estilos — prompt de transformación

Cada estilo se aplica por separado al mismo texto de entrada.
El skill **nunca añade información que no esté en el original** — solo cambia tono, estructura
y vocabulario. Fidelidad al contenido original es el primer principio.

### 1. Formal / Descriptivo

```
Reescribe el siguiente texto como una reseña formal y descriptiva,
como para Google Maps o una guía gastronómica seria.

- Usa vocabulario preciso y mesurado
- Describe los platos con adjetivos concretos (textura, sazón, temperatura, frescura)
- Menciona el servicio y el ambiente con objetividad
- Estructura: apertura → descripción de la comida → servicio + ambiente → cierre
- Sin exageraciones ni superlativos vacíos ("el mejor del mundo", "increíble")
- Sin emojis
- Extensión: equivalente al original, sin inflar

Texto original:
---TEXTO_CRUDO---
```

### 2. Jerga ecuatoriana / Directa

```
Reescribe el siguiente texto como una reseña en jerga ecuatoriana
callejera, como si la contara un comensal en la misma hueca.

Reglas de estilo:
- Usa jerga ecuatoriana real y natural: "qué bestia", "de ley", "a morir",
  "chuta", "pura miel", "fino", "causa", "vale verga" (solo cuando aplique),
  "al chazo", "cayó como anillo al dedo", "es un manjar", "sabe a gloria",
  "qué chimba", "tremendo", "es un duro"
- El tono es directo, sin rodeos, como se lo cuentas a un amigo en la mesa
- Mantén la honestidad: si algo estaba mal, sé crudo; si estaba bueno, sé efusivo con jerga
- Puedes incluir 1-2 emojis relevantes (🇪🇨, 🥟, 🔥, 😋, 👌)
- Estructura suelta: arranque con sensación fuerte → el plato → el veredicto
- Extensión: equivalente al original, sin inflar

Texto original:
---TEXTO_CRUDO---
```

### 3. Corto / Viral

```
Reescribe el siguiente texto como un micro-post viral para redes
(TikTok, Instagram Reel, Twitter/X, WhatsApp status).

Reglas de estilo:
- Máximo 2 oraciones o 40 palabras
- Lenguaje rápido, pegajoso, compartible
- Si el original es positivo: tono de hype, descubrimiento, "te estás perdiendo esto"
- Si el original es mixto/negativo: tono de alerta honesta pero sin drama
- Debe sonar como algo que alguien envía a un grupo de amigos
- Puede incluir 1 emoji fuerte (🤯, 🇪🇨, 🫘, 🔥, 👀, 🤤, 🚫)
- **No uses hashtags**, ni llamadas a "like/comparte", ni "link en bio"
- Estructura: gancho → punchline

Texto original:
---TEXTO_CRUDO---
```

### 4. Ejecutivo / Arquitecto de software

```
Reescribe el siguiente texto como lo escribiría un arquitecto de software
senior o un CTO: alguien que evalúa la hueca como quien evalúa un sistema
en producción, y que reporta a pares técnicos que no tienen tiempo que perder.

Reglas de estilo:
- Vocabulario preciso. Cada palabra carga información. Cero relleno.
- Frases cortas. Impacto por brevedad, no por adjetivo.
- Combina las dos capas: el valor (¿vale la pena ir? ¿por qué?)
  y la profundidad técnica (qué exactamente hace bueno o malo al plato)
- **El "por qué" antes del "cómo"**: abre con el juicio y su razón,
  después el detalle que lo sostiene. Nunca al revés.
- Usa analogías de ingeniería cuando el original las habilite, sin forzarlas:
  sistemas distribuidos (la cocina como servicio bajo carga, la fila como cola
  de pedidos, la hora pico como pico de tráfico), tolerancia a fallos (qué pasa
  cuando el plato estrella se acaba, si el local degrada con gracia o se cae),
  diseño por contrato (la carta es el contrato: qué promete y si lo cumple;
  la precondición del cliente, la poscondición del plato)
- Una sola analogía por reseña. Dos ya es disfraz, no claridad.
- Sin emojis. Sin jerga. Sin hype.
- Si algo falla, nómbralo como se nombra un defecto: qué falló,
  bajo qué condición, y qué consecuencia tuvo para el comensal
- Estructura: veredicto → la razón → la evidencia concreta → el costo/beneficio
- Extensión: equivalente al original, sin inflar

Texto original:
---TEXTO_CRUDO---
```

---

## Flujo operativo para el agente

### Paso 1 — Recibir y validar

Si Mato envía texto crudo sin especificar más, asume que es una reseña de ecuahuecas para decorar.
Si pide explícitamente decorar otro contenido, confirma antes de proceder.

Valida que el texto tenga contenido sustancial (>10 caracteres). Si está vacío o es muy corto,
pide a Mato que amplíe.

### Paso 2 — Aplicar los 4 estilos

Toma el texto de entrada y sustitúyelo en `---TEXTO_CRUDO---` en cada uno de los 4 prompts.
Genera las 4 versiones.

Presenta el resultado a Mato así:

```
═══ TEXTOS DECORADOS ═══

── 1. FORMAL / DESCRIPTIVO ──
[versión generada]

── 2. JERGA ECUATORIANA / DIRECTA ──
[versión generada]

── 3. CORTO / VIRAL ──
[versión generada]

── 4. EJECUTIVO / ARQUITECTO DE SOFTWARE ──
[versión generada]

═════════════════════════

Mato, ¿cuál te gusta? Responde 1, 2, 3 o 4.
```

### Paso 3 — Recibir la elección

Mato responde con el número (1, 2, 3 o 4) o con un comentario ("la 2 pero cambia X").
- Si es solo un número: ese texto es el definitivo.
- Si hay un comentario adicional (ej. "la 2 pero suena muy fuerte, suaviza"): aplica el ajuste
  sobre la versión elegida y muestra el resultado corregido, pidiendo confirmación.

### Paso 4 — Guardar en Firestore

Una vez confirmado, el texto elegido se guarda en Firestore como la reseña final del local.
Cada documento debe incluir al menos:
- `restaurant_id` o `nombre_del_local`
- `texto_resena` (el texto decorado final)
- `estilo_usado` (1, 2, 3 o 4)
- `created_at` / `updated_at`

El agente que ejecute este paso debe tener las credenciales de Firestore o usar el MCP server
configurado para la base de datos del proyecto.

### Paso 5 — Publicar el sitio (snapshot + build + deploy)

**Guardar en Firestore NO publica nada.** El sitio público de ecuahuecas es SSG: se construye
con `vite-ssg` a partir de `src/content-snapshot.json`, un archivo que se genera leyendo
Firestore en tiempo de build. Escribir la reseña en Firestore actualiza el contenido *vivo* que
el navegador lee por `onSnapshot`, pero **no crea la página estática ni el HTML de SSR**, y la
lista de slugs que `vite.config.ts` prerenderiza sale de ese mismo snapshot. Sin este paso la
reseña nueva no tiene página propia: sólo el rewrite de SPA, sin HTML servido.

Por eso, después de que el texto elegido quede guardado en Firestore, hivemind **debe** correr,
desde la raíz del repo (`~/ecuahuecas`):

```bash
npm run snapshot   # regenera src/content-snapshot.json desde Firestore
npm run build      # vite-ssg build → dist/ (prerenderiza los slugs del snapshot)
firebase deploy --only hosting
```

O en una sola línea:

```bash
npm run snapshot && npm run build && firebase deploy --only hosting
```

Notas operativas:

- **Credenciales.** `npm run snapshot` usa el Admin SDK: necesita
  `GOOGLE_APPLICATION_CREDENTIALS` apuntando al service account JSON, o credenciales
  por defecto de la aplicación. El script nunca imprime el contenido de la credencial.
- **El orden importa.** `build` consume el snapshot que `snapshot` acaba de escribir; invertirlos
  o saltarse `snapshot` publica el contenido anterior y el síntoma es engañoso —
  el sitio se ve "bien", sólo que sin la reseña nueva.
- **`src/content-snapshot.json` es un artefacto regenerable** y está en `.gitignore`. No se
  commitea; el estado durable vive en Firestore.
- **Verificar, no asumir.** Después del deploy, comprobar que la URL pública de la reseña
  responde 200 y que su HTML *estático* contiene el texto nuevo (no basta con que se vea en el
  navegador: eso puede ser el `onSnapshot` en vivo tapando un SSG desactualizado).
- Si además se tocaron imágenes o Cloud Functions, el deploy de hosting no las cubre —
  los skills `deploy-functions` / `deploy-all` del proyecto son los que corresponden.

---

## Notas importantes

- **Fidelidad sobre estilo.** Ninguna versión debe inventar platos, precios ni experiencias
  que no estén en el original. Si el original es muy escueto, las 4 versiones serán escuetas
  también — el estilo cambia el tono, no alarga el contenido.
- **No traducir.** Siempre en español ecuatoriano. No mezcles jergas de otros países.
- **Firestore no es responsabilidad de este skill.** Este skill produce el texto final;
  la persistencia la maneja el calling agent (Orchestrator o el agente que despachó el skill).
  El skill solo declara el esquema esperado.
- **No produce código.** Este skill es un contrato de transformación de texto + prompt,
  no una implementación backend. No hay scripts, ni handlers, ni pipelines.
- **Reutilizable.** Cualquier agente del ecosistema hivemind puede cargar este skill
  y ejecutar el flujo completo. El skill no depende de infraestructura específica.