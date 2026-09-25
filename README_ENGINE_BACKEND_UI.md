# Agent on a Leash: engine, backend y UI, explicado completo

> Qué hace cada parte, cómo decide, de dónde saca los datos, cómo se probó y qué números medimos.
> Primero el **engine y la lógica** (el corazón), después el **backend** y al final la **UI**.
> Rama: `feat/ui-real`. Todo lo que dice este archivo se verificó corriendo el código.

---

## 0. En una frase

Viseca simula a un agente de IA que compra con una tarjeta. **Nosotros somos el guardia**: convertimos lo que el
cliente quiere en reglas y juzgamos cada intento de pago en milisegundos con tres respuestas posibles:
**approve** (pasa), **step_up / ask** (se le pregunta al cliente en la app) o **decline** (se rechaza).

```
Cliente escribe / acepta sus reglas ──► Compilador ──► Mandato en Viseca (instrucción + reglas duras)
                                                              │
Agente simulado de Viseca intenta pagar ──► evento ──► ENGINE (22 guardias) ──► approve / ask / decline ──► Viseca
                                                              │
                                     Cliente contesta "sí / no" ──► Memoria aprende ──► menos preguntas después
```

---

## 1. El engine (la lógica de decisión)

Código: `packages/engine/src/` (`decide.ts` y `guards/`). Es **TypeScript puro, sin red, sin IA y sin base de datos**:
recibe hechos y devuelve una decisión. Por eso es rápido, repetible y explicable.

### 1.1 Cómo decide
1. **Recibe los hechos** de un intento de pago: tienda, categoría, país, monto, artículos, dispositivo, hora, texto
   de la tienda, el mandato (las reglas del cliente), el historial de compras de la tarjeta, la memoria aprendida y,
   si el cliente es nuevo, la pista de "clientes como tú".
2. **Pasa por 22 guardias**, cada una independiente. Cada guardia responde `PASS`, `STEP_UP`, `DECLINE`,
   `UNCERTAIN` o `SKIP` (no aplica).
3. **Gana la respuesta más estricta**: con un solo DECLINE se rechaza; si no hay DECLINE pero hay un STEP_UP,
   se pregunta; si todo pasa, se aprueba.
4. **La duda se trata según lo que eligió el cliente**: "ask me when unsure" pregunta y "decline when unsure"
   rechaza. Un cliente sin historial **nunca** se rechaza solo por ser nuevo: se le pregunta.
5. **Devuelve la decisión con su explicación**: códigos de razón (`over_order_limit`, `lookalike_shop`…), un
   titular en lenguaje humano ("Not a shop you know") y la lista de checks con el hecho que falló.

### 1.2 Las 22 guardias
| Familia | Guardias | Qué atrapa |
|---|---|---|
| Dinero | `perOrderLimit`, `issuerLimits`, `perUnitLimit`, `periodBudget`, `orderFrequency`, `splitOrder` | límite por compra, límites de la tarjeta del banco, precio por unidad, presupuesto en X días, demasiadas compras, un pedido partido en varios para esquivar el límite |
| Cuándo | `allowedWeekday`, `nightPurchase` | días permitidos; noche (23:00–05:00), que se rechaza o se pregunta según la app |
| Artículo y condiciones | `itemScope`, `blockedItems`, `requestedItem`, `unrequestedAddon`, `returnTerms`, `refundableOrder`, `destination` | categoría o artículo equivocado, prohibidos, algo añadido que no pediste (seguros, "protection plan"), sin devolución, no reembolsable, destino y noches de viaje |
| Tienda | `merchantType`, `blockedShop`, `merchantFamiliarity`, `lookalikeMerchant` | tipo de tienda, tiendas bloqueadas, "solo tiendas que conozco", **tiendas que imitan un nombre** ("PixelHarbour" ≠ "PixelHarbor") |
| Repeticiones y manipulación | `duplicateOrder`, `shopTextManipulation` | el mismo pedido dos veces; **texto de la tienda que da órdenes** ("ignora el límite", "pre-autorizado") |
| Sesión ("pareces tú") | `sessionIntegrity` | teléfono nuevo, hora rara, país nuevo, ráfaga de pagos en minutos, tiendas nunca usadas; **un teléfono al que dijiste "no fui yo" se rechaza siempre** |

### 1.3 Reglas de oro del diseño
- **El texto de la tienda nunca cambia las reglas.** Se guarda en cuarentena y se muestra, pero no se obedece.
- **Las reglas del cliente mandan.** El engine puede ser más estricto que el mandato, nunca más flojo.
- **Ninguna IA decide un pago.** Un test revisa que ningún archivo del engine ni del camino de decisión importe
  el cliente del LLM.
- **Sin atajos para el examen:** el engine no contiene IDs de escenarios de Viseca. Los tests usan frases,
  tiendas y clientes inventados.

### 1.4 Velocidad
Medido en el replay de las 45 compras públicas: **p50 = 0.06 ms por decisión, máximo 3 ms.** El plazo de Viseca
es de varios segundos, así que sobra margen.

---

## 2. Qué puede escribir o elegir el cliente (el input)

| Cómo | Qué se convierte en regla |
|---|---|
| **Reglas propuestas desde su historial** (pantalla 1.3) | Miramos los últimos 90 días de la tarjeta y proponemos límite por compra y presupuesto de 30 días ("tu compra más grande fue CHF 266 → límite de 300"). El cliente acepta o cambia los valores. |
| **Ajustes inteligentes** (1.4) | Duda: preguntar o rechazar · Noche: rechazar o preguntar · Tiendas nuevas: preguntar o solo conocidas · Aprender de mis respuestas: sí o no. |
| **Sus propias palabras, en cualquier idioma** (1.4) | Inglés y alemán los lee directo nuestro compilador; francés, italiano y suizo alemán pasan antes por Apertus, que los traduce. Ejemplos que entiende: "up to CHF 150 per order", "300 CHF every seven days", "only from shops I have used before", "no purchases at night", "ask me in case of doubt", "size 41", "nothing I didn't ask for", "refundable only", "never from shop X". |
| **Lo que el agente dice que va a comprar** (la tarea) | Viene con la corrida del escenario; se compila igual y se suma a las reglas de la tarjeta. |
| **Respuestas a preguntas** | "Sí" (con Face ID) aprueba y enseña a la memoria. "No" rechaza y puede ofrecer una regla aprendida ("¿rechazar siempre cuando la tienda dé órdenes?"). |
| **"¿Fuiste tú?"** tras una ráfaga | "Sí" confía en ese teléfono (con Face ID). "No" congela la tarjeta y rechaza ese teléfono para siempre. |

**Endurecer una regla es un toque; aflojarla pide Face ID** (subir un límite, desbloquear una tienda,
descongelar la tarjeta, permitir compras de noche).

**El compilador** (`packages/shared/src/compiler.ts` + `packages/backend/src/compiler/compile.ts`) es uno solo
para todo el sistema: convierte las frases en reglas duras con el formato de Viseca
(`authorization.billing_amount_chf <= 150`, `merchant.merchant_id not_in [...]`, `authorization.night = decline`…).
Lo que no entiende no lo inventa: lo devuelve en `not_understood` para que el cliente lo vea.

---

## 3. Datos: ¿hay base de datos? ¿qué usamos de la API de Viseca?

### 3.1 Qué usamos de la API de Viseca
| Para qué | Endpoints |
|---|---|
| **Extraer datos** al arrancar en modo vivo | `GET /v1/bootstrap` (clientes, cuentas, tarjetas, límites del banco), `GET /v1/reference-data` y `GET /v1/reference-data/authorization-history.csv` (historial de compras) |
| **Crear las reglas del cliente** | `POST /v1/mandates` (borrador) → `POST /v1/mandates/:id/confirm`; `GET/DELETE /v1/mandates/:id` |
| **Correr un escenario** | `POST /v1/scenario-runs`, `GET /v1/scenario-runs/:id` |
| **Recibir los pagos y contestar** | `GET /v1/decision-requests/next?wait=…` (long-poll), `POST /v1/authorizations/:id/decision`, `POST /v1/authorizations/:id/resolve` (cuando el cliente contesta una pregunta), `GET /v1/events` |

El worker que recibe los pagos reintenta con backoff (2 s, 5 s, hasta 15 s) y no guarda muestras repetidas.
`npm run api-atlas` documenta toda la API de Viseca usando **solo GET** (no crea nada).

### 3.2 Dónde se guarda todo: archivos locales, sin base de datos
No hay base de datos: para un hackathon, **archivos JSON locales** bastan y se pueden inspeccionar a mano.
Se escriben de forma atómica (primero un archivo temporal y luego rename), y si uno se corrompe se aparta y se
empieza limpio.

| Archivo (todo en `data/live/`, fuera de git) | Qué guarda |
|---|---|
| caché de bootstrap, reference-data e historial | lo descargado de Viseca, para no pedirlo cada vez |
| `memory-<mode>.json` | **la memoria que aprende**: tiendas, teléfonos, países y horas confirmados, tiendas bloqueadas, teléfonos "no fui yo". Sobrevive reinicios. `LEASH_MEMORY_FILE=off` la apaga. |
| `llm-cache.json` | respuestas de Apertus, para no preguntar dos veces lo mismo |

Las llaves (`TEAM_API_KEY`, `APP_SECRET`, `APERTUS_API_KEY`) viven en `.env`, que **nunca se sube** a git.

**Offline** (sin internet) el backend usa el data pack público de `data/` (CSVs) y un Viseca simulado, así que
todo se puede demostrar sin red.

---

## 4. Predecir con los patrones de otros clientes (cold start): sí, lo hicimos

Problema: un cliente nuevo no tiene compras, así que no hay nada que comparar.

Solución (`packages/backend/src/coldstart/`):
1. **Leemos su perfil en texto** (preferencias, gasto típico, viajes, estilo de presupuesto). Lo lee **Apertus**,
   el modelo suizo; si no responde, lo lee un lector de palabras clave. El resultado son señales como: categorías
   probables, compra de noche, países de viaje, prefiere tiendas conocidas, prefiere reembolsables.
2. **Buscamos sus 5 vecinos más parecidos** (k-nearest neighbours) entre los clientes con al menos 10 compras,
   por similitud de perfil, presupuesto, región y categorías.
3. **Predecimos a partir de lo que esos vecinos hacen de verdad**: categorías con porcentaje de confianza, monto
   típico y alto, gasto mensual, horas, países y tiendas que usan.
4. **Proponemos reglas iniciales** en 1.3 y lo decimos claramente: "5 customers like you usually pay up to CHF 212".

**Regla de seguridad: los vecinos solo son pista, nunca aprueban.** Aunque todos tus vecinos compren en una
tienda, tu primera compra ahí te pregunta, y el mensaje lo dice ("4 of 5 customers like you buy there"). Tus
respuestas reemplazan pronto la pista.

Ejemplo real: CU1217 (Omar Chen) → groceries 68 %, food delivery, household.

---

## 5. Apertus (la IA suiza): dónde sí y dónde no

Apertus 1.5 70B en la plataforma de Swisscom (compatible con OpenAI). **Solo en dos lugares y nunca decide**:
1. **Leer el perfil de clientes nuevos** para el cold start (leyó los 10 clientes nuevos).
2. **Entender una correa en DE, FR, IT o suizo alemán**: la traduce al inglés y **nuestro compilador** la lee.
   Verificamos que cada número y cada moneda del original sigan iguales en la traducción; si cambia algo aparece
   un "please check" y la app no deja crear la tarjeta. Atrapó un caso real: "1'500" traducido como "1,500".
   Las etiquetas vuelven traducidas al idioma del cliente.

Protecciones: caché en disco, cola con una espera mínima entre llamadas, reintento cuando el servicio limita las
llamadas (429), corte automático si falla varias veces seguidas, validación del JSON (categorías de una lista
cerrada, países ISO) y **respuesta de respaldo sin IA** si algo falla. Si Apertus se cae, nada se rompe.

---

## 6. La memoria que aprende

- **"Sí" a una pregunta** → recuerda la tienda, el teléfono, el país y la hora. La próxima vez esa tienda pasa
  como "confirmed by you".
- **"No fui yo"** → ese teléfono se rechaza siempre y la tarjeta se congela.
- **Bloquear una tienda** → se rechaza siempre.
- **"Learn from my answers" en off** → no aprende ni ofrece reglas nuevas.
- Se puede **ver y olvidar** lo aprendido: en la app (6.3) y en `GET/DELETE /v4/app/memory…`.

**Medido** sobre las 111 compras reales de las corridas en vivo (`npm run live-review`, contestando como lo haría
el cliente): **preguntas 65 → 45, aprobaciones 9 → 29, y 0 rechazos convertidos en aprobación.** Aprender quita
preguntas sin abrir agujeros.

---

## 7. Cómo lo probamos

| Prueba | Cómo | Resultado |
|---|---|---|
| **Examen de Viseca** | `npm run replay -- --all`: las 45 compras públicas del data pack contra `data/reference_decisions.csv` | **45/45** |
| **Tests automáticos** | `npm test` (vitest): compilador, cada guardia, memoria, cold start, Apertus con respuestas grabadas, API de la app, seguridad y rendimiento. Con datos **inventados**. | **291/291** |
| **Red team** | tienda que dice "ignora el límite", tiendas que imitan un nombre, duplicados, pedidos partidos, aflojar sin Face ID, escribir sin el secreto (401) | ningún ataque pasa |
| **Rendimiento** | decisiones en ms; una instrucción de 200 KB debe compilar en menos de 1 s (sin regex que se cuelgue) | p50 0.06 ms, máx 3 ms; 200 KB en ~720 ms |
| **Typecheck** | `npm run typecheck` (2 pasadas estrictas) | limpio |
| **En vivo contra Viseca** | los 10 escenarios, 111 compras reales en el servidor de Viseca | 111/111 a tiempo, 0 rechazos de la plataforma |
| **Aprendizaje** | `npm run live-review` repasa esas 111 compras con la memoria encendida | 65 → 45 preguntas |

Honesto: el test de 200 KB está cerca del límite y, con toda la suite en paralelo, a veces pasa de 1 s. Si falla,
se repite; no se subió el límite.

---

## 8. El backend (el servidor)

Código: `packages/backend/src/`. Node + TypeScript.

- **`leash/service.ts`**: el cerebro del servidor. Crea y actualiza el mandato, guarda las decisiones, maneja las
  preguntas con su plazo de 2 minutos, las reglas aprendidas, la memoria, pausar/congelar y apagar la tarjeta.
- **`worker.ts`**: escucha los intentos de pago de Viseca, llama al engine y contesta a tiempo.
- **`engine/leashEngine.ts`**: adaptador entre el engine y el backend (endurece reglas, titulares humanos, checks).
- **`memory/`**, **`coldstart/`**, **`llm/`**: memoria, clientes parecidos, Apertus.
- **`http/server.ts` + `http/appV4.ts`**: la API que usa la app.

API de la app (`/v4/app/...`), todo lo que la UI puede hacer:
`GET leash/suggest` (reglas propuestas; `?customer_id=` para un cliente nuevo) · `POST leash/understand` (correa
en cualquier idioma) · `POST leash` (crear tarjeta) · `GET leash` · `PATCH leash/rules` (endurecer o aflojar;
aflojar pide Face ID) · `POST leash/pause` · `POST leash/resume` · `POST leash/unblock-shop` · `DELETE leash` ·
`GET feed` · `GET stream` (eventos en vivo, SSE) · `GET decisions/:id` · `POST asks/:id/resolve` · `POST
decisions/:id/was-me` · `POST suggestions/:id/accept` · `GET memory` · `DELETE memory/shops/:id` · `DELETE
memory/devices/:id` · `GET profile/customers` · `GET profile/insight`. Para la demo: `GET /v4/api/scenarios`,
`POST /v4/api/runs`, `GET /v4/api/status`.

Seguridad: toda escritura necesita el secreto de la app (sin él, 401). En local, el proxy de Vite lo agrega del
lado del servidor y nunca llega al navegador.

---

## 9. La UI (app-web)

React 19 + Vite, diseño de la compañera (Figma "UI mobile v3"). Dos modos:
- **Mock** (sin backend, como en Vercel): compras de ejemplo, y el panel lo dice ("Mock replay (not the engine)").
- **Vivo** (`VITE_API_BASE=/v4`): cada pantalla lee el backend real.

| Pantalla | Qué muestra en vivo |
|---|---|
| 1.3 Reglas | propuesta desde el historial de la tarjeta; con un cliente nuevo, "customers like you" con categorías predichas, por qué esos vecinos y qué tiendas usan |
| 1.4 Ajustes | evidencia real de cada ajuste + "Anything else? In your own words" en cualquier idioma, con las reglas leídas y el aviso "please check" |
| 1.5 Tarjeta lista | los últimos 4 dígitos reales |
| 3.1 Inicio | presupuesto, fecha en que se libera, pregunta abierta con cuenta regresiva real, la tarea del agente, actividad |
| 4.x Preguntar | aprobar (Face ID) o rechazar, checks y la regla aprendida que ofrece el backend |
| 5.2 Detalle del pago | por qué, checks por familia y **barra de evidencia** (tus reglas / tu historial / lo que enseñaste / clientes como tú / lo que no se podía saber) |
| 6.1 Reglas | reglas, ajustes, tarea (con tus palabras originales si era otro idioma), reglas aprendidas |
| 6.3 Detalles | tiendas conocidas (historial + las que aprobaste), bloquear/desbloquear, teléfonos conocidos con "Forget" |
| 7.x Ráfaga | notificación "We stopped N payments", qué se vio raro (señales reales), "¿fuiste tú?" sí/no al backend; descongelar con Face ID |

Panel lateral: demo guiada, elegir escenario y "Start run", **selector de cliente nuevo** (cold start) y voz
(ElevenLabs).

---

## 10. Cómo correrlo

```bash
npm install && (cd app-web && npm install)
# .env en la raíz: TEAM_API_KEY, APP_SECRET, APERTUS_API_KEY, APERTUS_BASE_URL, APERTUS_MODEL (nunca se sube)
printf 'VITE_API_BASE=/v4\n' > app-web/.env.local
npm run api        # backend en :8787 (offline por defecto)
npm run web        # app en :5173
npm test && npm run typecheck && npm run replay -- --all
```

## 11. Límites conocidos
- En Vercel solo corre la app en modo demo: el modo vivo necesita el backend encendido en un servidor.
- En el selector de cliente nuevo, la tarjeta se crea para la tarjeta configurada del backend; el cliente nuevo
  cambia solo la propuesta de 1.3.
- Una regla aprendida no se puede quitar en vivo (Viseca no borra reglas de un mandato): se quita apagando la
  tarjeta.
- La UI en modo vivo se verificó con typecheck, build y pruebas de la API; falta probarla clic a clic en el
  navegador.
