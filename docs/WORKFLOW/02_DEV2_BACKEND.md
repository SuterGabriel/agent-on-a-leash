# Dev 2 — Backend, Viseca API, worker, database

You own everything that talks to the outside: Viseca's API, Supabase, the app API and the worker loop that calls Dev 1's engine.

Stack: **Node + TypeScript** (npm workspaces). Engine, backend and worker run in **one process**; the engine is a function call, not a service.
Types live in `packages/shared` and are imported by the engine, the backend and the React app. The optional model service is Python + FastAPI (see Step 8).

The app API is defined by the **App API contract** (Notion). This file follows it; if the two disagree, the contract wins and this file gets fixed.

---

## Step 0 — Prove the key works (first 20 min, before anything else)

```bash
cp .env.example .env            # paste TEAM_API_KEY from Slack, never commit .env
npm install
npm run check-key               # /healthz, /v1/bootstrap, prints deadlines and human window
```
The key comes as `team3:<token>`; the API only accepts the token. `config.ts` strips the prefix, so paste it as you got it.
The bootstrap response holds the decision deadline (8 s) and the human window (120 s). Read them, do not hard-code.

## Where the code is

| Path | What |
|---|---|
| `packages/shared/src/event.ts` | Live event types (from `data/schemas/authorization_event.schema.json`) |
| `packages/shared/src/decision.ts` | `EngineVerdict`, `Check`, `Decision` (from the App API contract), shared with engine and app |
| `packages/shared/src/dataPack.ts`, `buildEvent.ts`, `fx.ts` | CSV loaders, CSV row → live event, half-even CHF conversion |
| `packages/backend/src/viseca/` | `VisecaApi` interface, live HTTP client |
| `packages/backend/src/offline/platform.ts` | Offline clone of the platform |
| `packages/backend/src/engine/port.ts` | `Engine` interface Dev 1 implements, `stubEngine` (always step_up), fallback verdict |
| `packages/backend/src/worker.ts`, `asks.ts`, `store.ts` | Worker loop, customer answers, in-memory store + event bus |
| `packages/backend/test/` | 20 tests: event building, FX, worker, retries, timeouts, resolve, expiry, PATCH rules, real live response shapes |

`npm test` runs them. `npm run scenario -- SCEN0001 --answer approve` runs a scenario offline.

**Confirmed on the live API (24 Sep 2026, SCEN0000 + SCEN0001 green, 31–157 ms per decision):**
- The key works **without** the `team3:` prefix; `config.ts` strips it, so paste the key as you got it.
- `draft_id`, `mandate_id`, `run_id` are at the top level of the responses.
- Run status is `running` → `completed`. Counters are flat fields (`generated_event_count`, `delivered_event_count`, `queued_event_count`, `pending_event_count`, …); `toRunInfo()` collects them.
- **`evidence` must be a list of objects.** Strings are rejected with 422. We send one object per check (`key, label, source, result, fact`), and Viseca stores them as sent.
- A step_up answer contains `step_up_expires_at`; the worker uses it as the end of the customer window.
- `event_id` in the poll envelope is a number.
- Real responses are kept as test fixtures in `packages/backend/test/fixtures/live/`. Live runs write new ones to `live-samples/` (git-ignored).

**Still assumptions in the offline clone:** the period for `approved_spend_in_period_chf` is the longest period rule (else 7 days); an unanswered ask ends as `cancelled`.

## Step 1 — Viseca client ✅ done (tested live)

`packages/backend/src/viseca/client.ts`: typed wrappers for every endpoint in `technical_details.md`
(bootstrap, reference data, mandates create/confirm/get/patch/delete, scenario runs, decision-requests/next, decision, resolve, authorizations, events, team reset).
30 s timeout, errors thrown as `VisecaError` with status and body. The client and the offline platform implement the same `VisecaApi` interface.

## Step 2 — Worker, end to end ✅ done (with stub engine)

`packages/backend/src/worker.ts`
```
loop while run has work:
  GET /v1/decision-requests/next?wait=25
  204 → check run progress, continue
  200 → validate event, look up live authorization_id
        seen before?  → re-post stored answer, never a second decision
        else          → load current mandate (cached) → engine.decide(event, ctx)
                        engine throws or runs out of time → step_up
        POST /v1/authorizations/{id}/decision   (retry once after 250 ms)
        store the full decision (incl. checks[]), emit it to the app
```
- **Current mandate:** Viseca freezes the mandate at run start; a PATCH only reaches later runs. The worker therefore passes both the snapshot (in the event) and the latest mandate we hold to the engine. Dev 1 applies the stricter of the two, so "Tighten" works immediately. *(Proposal, confirm with the team.)*
- **What goes to Viseca:** `decision`, `reason_codes`, `customer_message` (= `because`), `evidence` (one object per check), `engine_version`. The full `checks[]` stays in our store.

Run it: `npm run scenario -- SCEN0000` (offline) or `npm run scenario -- SCEN0000 --live`.
**Milestone: SCEN0000 decided live by our worker.** Tell the team.

## Step 3 — Offline platform clone ✅ done

`packages/backend/src/offline/platform.ts` serves the same `VisecaApi` in-process from `data/` (the 45 purchases):
mandates, runs, a queue in `replay_order`, live IDs, real-clock deadlines, the human window, `context.approved_spend_in_period_chf` and `recent_authorizations`.
`LEASH_MODE=offline|live` switches. Same worker, same engine, same screens in both modes.

## Step 4 — Database (Supabase, 45 min)

Supabase is storage for the backend only. The app never reads it directly; it gets everything through the app API and the stream.

| Table | Holds |
|---|---|
| `mandates` | instruction, hard_rules, uncertainty_policy, status, Viseca IDs |
| `rules` | per rule: key, label, `your_words` (text + start/end offsets), group, source (`you` / `built_in` / `learned`) |
| `answers` | answers to open questions |
| `learned_rules` | accepted suggestions, `added_at`, removable |
| `suggestions` | open "Always do this?" offers |
| `known_shops` | merchant, times used, first seen |
| `runs` | run ID, scenario, mandate, status |
| `decisions` | PK = live authorization_id, full `Decision` JSON incl. `checks[]`, status, latency, model status |
| `audit_events` | everything the customer or the worker did |

Why so much: every purchase event carries only `instruction`, `hard_rules` and `uncertainty_policy`. Labels, `your_words`, answers and learned rules exist only in our store.
The engine returns a check `key`; **the backend adds `your_words`** from `rules` before storing and sending to the app.

Writes never block a decision: decide and post first, write after.

## Step 5 — Policy compiler (2 h) — differentiator D2

`POST /app/leash/parse {instruction}` →
```
{ instruction, rules[], built_in[], uncertainty_policy, open_questions[], not_understood[], assumptions[], warnings[] }
```
- `rules[]`: `key`, `label` ("Each order CHF 120 or less, delivery included"), `your_words {text, start, end}`, `hard_rule` (Viseca rule format).
- Regex compiler always runs (amounts, "per order", "any seven days", "including delivery", categories, size, return days, "shops I have used", "nothing extra", "ask/decline when uncertain").
- **Assumptions**: every interpretation in plain words ("I read 'regularly' as: at least 1 approved purchase on this card").
- **Open questions**: known ambiguities (split orders, other card counts as known?, one item only?).
- Unknown instruction → never silent: `not_understood` + questions instead of a policy that declines everything.
- `internal_policy` (our extra rules) stays in our store; it is not sent to the app or Viseca.
- Optional model (P1): only after regex works; must agree on numbers or the rule is marked "please check".

`assumptions` and `warnings` are missing in the App API contract today; add them there.

## Step 6 — App API (from the App API contract)

| Method | Path | Screen | Calls Viseca |
|---|---|---|---|
| POST | `/app/leash/parse` | S1 → S2 | no |
| POST | `/app/leash` | S3 confirm | `POST /v1/mandates` + `/confirm` |
| GET | `/app/leash` | S4, S7 | `GET /v1/mandates/{id}` (cached); includes `budget`, `status`, `token`, learned rules, known shops |
| PATCH | `/app/leash/rules` | S8 tighten | `PATCH /v1/mandates/{id}` (add rules only, or uncertainty → decline) |
| DELETE | `/app/leash` | S9 revoke | `DELETE /v1/mandates/{id}` |
| POST | `/app/leash/pause` | S7 | no (engine flag) — P1 |
| GET | `/app/feed` | S4 | no |
| GET | `/app/decisions/:id` | S5 | no |
| GET | `/app/asks` | S4, S6 | no |
| POST | `/app/asks/:id/resolve` | S6 | `POST /v1/authorizations/{id}/resolve` |
| POST | `/app/suggestions/:id/accept` | S5, S6 | no (learned rule, engine-side; D1) |
| GET | `/app/stream` | all | no — SSE events `decision`, `ask`, `ask_expired`, `leash_changed` |
| GET | `/judge/decisions?run_id=` | Judge view | no |
| POST | `/api/runs {scenario_id}` | demo control | `POST /v1/scenario-runs` — *add to contract* |
| GET | `/api/status` | demo control | `GET /v1/scenario-runs/{id}` — *add to contract* |

Realtime is **SSE from our backend**, not Supabase Realtime: it carries `ask_expired` and `leash_changed`, and the Supabase service key never leaves the server.

## Step 7 — Resilience checklist

- Decision post fails → retry once after 250 ms, then log `post_failed`. ✅
- Engine throws or runs out of time → post `step_up`. ✅
- Duplicate delivery → stored answer, counted once. ✅
- Human window expires → mark `expired`, send nothing, emit `ask_expired`.
- Revoke with pending step_up → do not fake a cancellation (expert question Q5).

## Step 8 — Model service client (P1, after Thu 21:00)

Python + FastAPI service, owned with Dev 1: `POST /classify` (shop text → SAFE / INJECTION) and `POST /extract` (text → JSON facts via llama-server).
Node calls it with hard timeouts (classifier ~300 ms, model 2.2 s / 5 s). Timeout or error → continue without it, record the model status per decision.
The model can only make a check `unsure`, never `pass`. Model off → identical decisions.

## Checkpoints

| When | You show |
|---|---|
| Thu 16:00 | bootstrap answers |
| Thu 17:30 | SCEN0000 live via our worker |
| Thu 21:00 | offline clone + resolve from app, app API on mock engine |
| Fri 01:00 | compiler with assumptions/questions, tighten, revoke |
| Fri 09:00 | clean reset, final live runs of all 5 scenarios |
