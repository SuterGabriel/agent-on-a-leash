# READMEALLES: traspaso del engine + backend (Agent on a Leash)

> **Para quien retoma (y para su Claude):** este archivo resume todo lo hecho el 24-09-2026 en la rama
> `feat/engine-integration`, el estado actual, los problemas abiertos y lo que proponemos hacer.
> Léelo entero antes de tocar código. Todo lo que dice aquí se verificó corriendo el código.

---

## 1. En 30 segundos

- **El engine de decisiones (Dev 1) está integrado en el backend (Dev 2)** y decide compras reales contra la API en vivo de Viseca.
- **Offline:** 45/45 compras públicas coinciden con la referencia · **85 tests** pasan · typecheck limpio.
- **En vivo:** corrimos los **10 escenarios (111 compras)**: 0 deadlines perdidos, 0 rechazos de la plataforma. Pero **89 de 111 decisiones son discutibles**, sobre todo porque **los clientes nuevos no tienen historial** (ver §5).
- **Nada está mezclado en `main` todavía.** Todo vive en `feat/engine-integration`.

## 2. Cómo arrancar

```bash
git checkout feat/engine-integration
npm install
cp .env.example .env            # pega TEAM_API_KEY (está en Slack). .env está en .gitignore: NUNCA lo subas.

npm test                        # 85 tests
npm run typecheck               # dos pasadas (ver §4)
npm run replay -- --all         # 45 compras públicas vs data/reference_decisions.csv → 45/45

npm run scenario -- SCEN0001                      # offline, engine real
npm run inspect-live                              # qué entiende el compilador de cada escenario en vivo (solo lectura)
npm run api-atlas                                 # descarga todo lo legible de la API → reports/api-atlas.md (solo GET)
npm run scenario -- SCEN0101 --live --answer decline   # ⚠️ EN VIVO: crea mandato + ejecución en Viseca
npm run live-results -- <run_id> [<run_id> …]     # tabla de compras con decisión/motivo → reports/live-results.md
```

`reports/` y `data/live/` están en `.gitignore`: son generados, y `reports/` incluye perfiles de clientes en vivo.

## 3. Qué hicimos (en orden)

| Commit | Qué |
|---|---|
| `6273755` | Engine copiado a `packages/engine` **sin cambiar su lógica**. El worker usa `decide()` a través de un adaptador (`packages/backend/src/engine/leashEngine.ts`), que traduce al formato de la app (`headline`, `because`, `checks`). **Un solo compilador** (`packages/shared/src/compiler.ts`); se borró `priceRule.ts`. Se aplica **la regla más estricta** entre el mandato congelado y el actual. |
| `c807d5c` | En modo live se descargan `bootstrap`, `reference-data` y el historial CSV, se guardan en caché en `data/live/` y los baselines se construyen desde ahí. `npm run inspect-live`. |
| `9534d7f` | El compilador entiende frases generales (**sin nada específico de escenarios**): montos en cualquier moneda, por noche/unidad, frecuencia, días, exclusiones, categorías nuevas, devoluciones/refundable, tiendas conocidas, sesión y dudas. **5 guards nuevos:** `perUnitLimit`, `orderFrequency`, `weekday`, `blocked`, `refundable`. Si la tarjeta tiene < 10 compras, se usa el historial de todas las tarjetas del cliente; si no hay nada, se **pregunta, nunca se rechaza**. |
| `466d516` | Worker: *backoff* ante compras reenviadas (2 s → 5 s → 15 s, **nunca más allá del fin de la ventana del cliente**). Antes hacía ~6,500 consultas en 2 min. `npm run api-atlas`. |
| *(este commit)* | **Lookalike** también contra todas las tiendas establecidas del emisor. Guard **`issuerLimits`** (límite por compra de la cuenta de la tarjeta → `over_card_limit`). `npm run live-results`. Este archivo. |

## 4. Mapa del código

```
packages/engine/src/        decide.ts (orquesta), guards/*.ts (1 archivo por regla), shoptext.ts (texto de la tienda = datos, nunca órdenes),
                            ledger.ts (memoria por ejecución: solo lo APROBADO cuenta como gasto), replay.ts (45 públicas)
packages/shared/src/        compiler.ts (instrucción → política + hard_rules), baselines.ts (historial → hábitos por tarjeta/cliente,
                            límites de tarjeta), types.ts / loaders.ts / csvEvent.ts / fxRates.ts (del engine)
                            event.ts / decision.ts / dataPack.ts / buildEvent.ts / fx.ts (del backend)  ← duplicados, ver §6
packages/backend/src/       worker.ts (sondea Viseca, decide, publica), engine/leashEngine.ts (adaptador + regla más estricta),
                            live/referenceData.ts (caché live), app/parseLeash.ts (lo que llamará /app/leash/parse),
                            cli/*.ts (scenario, inspect-live, api-atlas, live-results), atlas/report.ts
tests/                      engine.test.ts, redteam.test.ts, patterns.test.ts (frases INVENTADAS, nunca copiadas de escenarios)
```

- **Dos typechecks:** `tsconfig.json` (estricto, para el código del backend) y `tsconfig.engine.json` (con la configuración original del engine, para el engine y los archivos que lo importan). `npm run typecheck` corre los dos. Si un archivo nuevo importa el engine, agrégalo al `exclude` de `tsconfig.json`.
- **Test anti-trampa:** si aparece `SCENxx` o `AUxxx` en el engine, en `compiler.ts` o en `baselines.ts`, falla.

## 5. Resultados en vivo (24-09-2026, `--answer decline`)

| Escenario | Compras | Aprobadas | Preguntadas | Rechazadas | ⚠️ |
|---|---|---|---|---|---|
| SCEN0101 Connection check | 2 | 0 | 1 | 1 | 2 |
| SCEN0135 Household budget | 12 | 0 | 9 | 3 | 12 |
| SCEN0130 Hiking boots | 13 | 4 | 2 | 7 | 1 |
| SCEN0106 Session integrity | 12 | 0 | 10 | 2 | 12 |
| SCEN0122 Camera lens | 13 | 0 | 10 | 3 | 13 |
| SCEN0136 Subscriptions | 12 | 0 | 10 | 2 | 12 |
| SCEN0104 Cross-border | 10 | 0 | 6 | 4 | 10 |
| SCEN0113 Meal delivery | 12 | 0 | 1 | 11 | 12 |
| SCEN0124 Hotel | 12 | 7 | 1 | 4 | 2 |
| SCEN0117 Exclusions | 13 | 0 | 6 | 7 | 13 |
| **Total** | **111** | **11** | **56** | **44** | **89** |

Motivos más frecuentes: `no_shop_history` (86 compras), `over_order_limit` (15), `lookalike_shop` (12), `session_not_you` (12), `unrequested_addon` (15), `blocked_item` (10).
IDs de ejecución: `run_4a8650d42bd342b3` (0101), `run_a98c91581ddc6d14` (0135), `run_cc365f1a0e04cb61` (0130), `run_8f78c78d0ff99b0d` (0106), `run_f53db8fe41ed072d` (0122), `run_70f433545f023352` (0136), `run_1e299283aa005bc3` (0104), `run_5553472a141e3853` (0113), `run_877e41928ce836d2` (0124), `run_05861faded96d1d1` (0117). La tabla completa se regenera con `npm run live-results -- <esos ids>`.

## 6. Problemas abiertos y lo que proponemos

### 🔴 P0: bloquean buenos resultados en vivo

1. **Los 10 clientes nuevos no tienen historial.** El historial en vivo (4,701 filas) solo cubre CU0001–CU0020. Los clientes de los escenarios (CU1016, CU1052, CU1217, CU1308, CU1363, CU1373, CU1376, CU1415, CU1448, CU1475) tienen **0 filas**, y no hay otra fuente: lo revisamos todo con `api-atlas` (`/docs`, `/openapi.json` y `/v1` dan 404; listar mandatos o ejecuciones da 405). Por eso toda instrucción con "shops I use / already know" termina en `no_shop_history` (preguntar).
   **Propuesta:** (a) preguntar a Viseca en Slack si ese historial se publicará o qué esperan cuando no lo hay; (b) mientras tanto, contar como "conocida" una tienda que el cliente ya aprobó **dentro de la misma ejecución**, porque el ledger ya lo sabe; (c) opcional: usar el texto del perfil (`shopping_preferences`) solo para decidir si preguntar, nunca para aprobar.

2. **Lookalike ampliado: probable falso positivo.** En SCEN0113, "Night Owl Kitchen" (ME0172, Sion, 0 compras) se compara con "NightOwl Kitchen" (ME0016, Ginebra, 104 compras). Tras normalizar, la similitud es **1.0** y se rechazan 10 compras de lo que seguramente es el servicio habitual del cliente. En cambio, "PixelHarbour" vs "PixelHarbor" (SCEN0106) sí parece la imitación clásica.
   **Propuesta:** cuando el parecido es solo contra el emisor (no contra tiendas del propio cliente), **preguntar (`STEP_UP`) en vez de rechazar**, o rechazar solo si el nombre difiere en 1–2 letras (similitud < 1.0) y la tienda no tiene compras. Hay que agregar un test con este caso.

### 🟠 P1

3. **Alguien más usa la llave del equipo.** Hubo una segunda ejecución de SCEN0101 (`run_bf67d8a8d823e30c`) con otra versión del engine. Cada mandato nuevo **reemplaza** (`superseded`) al anterior del mismo cliente, y `/v1/decision-requests/next` es **para todo el equipo**: si dos personas corren a la vez, sus workers se quitan compras entre sí. **Propuesta:** acordar quién corre en vivo y cuándo.
4. **Una pregunta sin respuesta termina como rechazo.** Si nadie contesta en 120 s, Viseca la cierra con `decision_source: timeout`. En demo, la app (Kim) tiene que contestar, o hay que correr con `--answer`.
5. **Huecos del compilador** (se ven con `npm run inspect-live`): la **ciudad y las fechas** del hotel (en SCEN0124 se aprobó SummitStay, en Suiza, para "a hotel in Munich", y una reserva de CHF 139.51 que quizá no cubre 3 noches), el **país** de la tienda ("Austrian retailer"), "**If a price changes**, ask me", "dinners" como **hora del día**, "buy **one** item" y "under CHF 80" (hoy se trata como ≤).
6. **SCEN0106 dice "stop and ask me"**, pero el guard de sesión **rechaza** con 3 señales o más. Probablemente debería preguntar.
7. **`per night`** compara el precio unitario de cada línea. Si una tienda cobra 3 noches como 1 unidad, se rechazaría. Hay que revisarlo con los datos de SCEN0124.

### 🟡 P2: deuda técnica

8. **Tipos duplicados:** `types.ts` (engine) vs `event.ts` (backend), y dos `buildEvent` (`csvEvent.ts`) y dos `fx`. Unificarlos requiere tocar los imports del engine.
9. **Falta el backend de la app:** no hay servidor HTTP (`/app/leash/parse` es una función, sin ruta), ni Supabase, ni SSE (ver `docs/02_DEV2_BACKEND.md`, pasos 4–6).
10. **Cambio local sin decidir:** alguien movió `docs/WORKFLOW/*.md` a `docs/` (y renombró `01_ARA_ENGINE` a `01_DEV1_ENGINE`). **No se subió**, porque deshace el commit `1ba9b90`. Hay que decidir si se queda.
11. **`main` no tiene nada de esto.** Falta abrir el PR: https://github.com/SuterGabriel/agent-on-a-leash/pull/new/feat/engine-integration

## 7. Decisiones tomadas (por si quieres cambiarlas)

- **El engine nunca aprueba por falta de un dato.** Si falta información, pregunta (o rechaza si el cliente dijo "decline when unsure"). Excepción: sin historial, la familiaridad **siempre pregunta**.
- **Regla que el engine no entiende en un mandato** → al menos preguntar (`rule_not_applied`). Mandato revocado → rechazar.
- **"purchases … up to CHF 300 each"** = límite por orden, no por unidad.
- **La frecuencia cuenta solo compras aprobadas**, y "un día" es el día calendario en hora suiza.
- **Palabras bloqueadas:** se buscan en el nombre, la categoría y las frases **limpias** del texto de la tienda; "no insurance included" no cuenta como mención.
- **El backoff nunca duerme más allá del fin de la ventana del cliente:** Viseca encola la siguiente compra en ese instante, y su deadline de 8 s arranca ahí.
- `issuerLimits`: por encima del límite por compra de la cuenta → `decline` (`over_card_limit`). Si no se conoce el límite, no se revisa.

## 8. Prompt sugerido para tu Claude

> Estoy retomando la rama `feat/engine-integration` de agent-on-a-leash. Lee primero `READMEALLES.md` entero.
> Reglas: no cambies la lógica del engine sin tests; nunca escribas IDs de escenarios ni frases copiadas en el engine o en el compilador
> (hay un test que lo detecta); los tests usan frases inventadas; después de cada cambio corre `npm test`,
> `npm run typecheck` y `npm run replay -- --all` (tiene que seguir en 45/45). No corras nada en vivo
> (`--live`) sin avisarme, porque crea mandatos que no se pueden borrar. Nunca imprimas ni subas la llave.
> Empieza por los P0 de la §6: (1) contar como conocidas las tiendas ya aprobadas en la misma ejecución y
> (2) que el lookalike contra el emisor pregunte en vez de rechazar. Muéstrame el efecto con `npm run inspect-live`
> y los tests antes de hacer commit.
