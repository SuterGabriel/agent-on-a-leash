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
| `packages/backend/src/engine/port.ts` | `Engine` interface, `stubEngine` (always step_up, for tests), fallback verdict |
| `packages/backend/src/engine/leashEngine.ts` | Ara's engine (`packages/engine`) behind the port: policy from the stricter mandate, one ledger per run, verdict for the app |
| `packages/backend/src/worker.ts`, `asks.ts`, `store.ts` | Worker loop, customer answers, in-memory store + event bus |
| `packages/shared/src/leash.ts` | App shapes: `ParseResult`, `LeashRule`, `LeashView`, `Budget`, `Suggestion`, `TightenRequest` (for Kim) |
| `packages/shared/src/ruleFields.ts` | **Rule conventions between compiler and engine** (hard_rule field names, rule keys, built-in protections). Ara reads these. |
| `packages/backend/src/compiler/compile.ts` | Policy compiler (Step 5) |
| `packages/backend/src/leash/` | `LeashService` (leash, runs, asks, tighten, pause, revoke, judge), rolling budget, D1 suggestions |
| `packages/backend/src/http/server.ts` | App API + SSE stream (Step 6), plain `node:http` |
| `packages/backend/src/tokens/vault.ts` | Decision-bound tokens (demo), see below |
| `packages/backend/test/` | 47 tests: compiler, worker, retries, timeouts, resolve, expiry, PATCH rules, live response shapes, tokens, full API flow over HTTP |

`npm test` runs them. `npm run api` starts the app API on http://localhost:8787 with Ara's engine (offline; `npm run api -- --live` for Viseca, which loads the live scenarios and card history).
`npm run scenario -- SCEN0001 --answer approve` runs a scenario from the command line.

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

## Step 2 — Worker, end to end ✅ done (with Ara's engine)

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

## Step 5 — Policy compiler ✅ done — differentiator D2

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

Done: reads all 5 scenario instructions completely (no `not_understood`, correct offsets), plus the app's example wording
("max CHF 120 per order", "CHF 300 per week"). Open question ids: `q_split_orders`, `q_other_card`, `q_close_after_first`;
answers go in `POST /app/leash {answers}` and can only add or narrow rules. Every rule is sent to Viseca as a hard_rule with the
field names in `ruleFields.ts`, so it travels with each purchase event to the engine.
Assumptions go to Viseca as `guidance`; if Viseca rejects that format (undocumented), the leash is created without them.

`assumptions` and `warnings` are missing in the App API contract today; add them there.

## Step 6 — App API ✅ done (offline-tested over HTTP; live pending a working key)

| Method | Path | Screen | Calls Viseca |
|---|---|---|---|
| POST | `/app/leash/parse` | S1 → S2 | no |
| POST | `/app/leash` | S3 confirm | `POST /v1/mandates` + `/confirm` |
| GET | `/app/leash` | S4, S7 | `GET /v1/mandates/{id}` (cached); includes `budget`, `status`, `token`, learned rules, known shops |
| PATCH | `/app/leash/rules` | S8 tighten | `PATCH /v1/mandates/{id}` (add rules only, or uncertainty → decline) |
| DELETE | `/app/leash` | S9 revoke | `DELETE /v1/mandates/{id}` |
| POST | `/app/leash/pause {hours}` / `/app/leash/resume` | S7 | no: while paused every purchase is declined (`leash_paused`) |
| GET | `/app/feed` | S4 | no |
| GET | `/app/decisions/:id` | S5 | no |
| GET | `/app/asks` | S4, S6 | no |
| POST | `/app/asks/:id/resolve` | S6 | `POST /v1/authorizations/{id}/resolve` |
| POST | `/app/suggestions/:id/accept` / `/dismiss` | S5, S6 | `PATCH /v1/mandates/{id}` (learned rule added as hard_rule; D1) |
| GET | `/app/stream` | all | no — SSE events `decision`, `ask`, `ask_expired`, `leash_changed` |
| GET | `/judge/decisions?run_id=` | Judge view | no |
| POST | `/api/runs {scenario_id}` | demo control | `POST /v1/scenario-runs` — *add to contract* |
| GET | `/api/status` | demo control | `GET /v1/scenario-runs/{id}` — *add to contract* |
| GET | `/api/scenarios` | demo control | no — the 5 scenarios with instructions |

Details that matter for the app:
- `POST /api/runs {scenario_id}` creates a fresh leash from the scenario's instruction and starts the run (worker runs in the background).
  `{scenario_id, use_current_leash: true}` keeps the leash the customer built in S1–S3 instead.
- `PATCH /app/leash/rules` bodies: `{type:"lower_order_limit", value}`, `{type:"block_shop", merchant_id}`, `{type:"block_category", category}`, `{type:"unsure_decline"}`. A looser limit is refused with `not_tighter`.
- `POST /app/asks/:id/resolve {decision, accept_suggestion?}`. After a decline, the decision carries `suggestion {id, text}` ("Never buy cosmetics") when one fits.
- Checks come back with `your_words` filled from the leash (the backend adds them; the engine only returns keys).
- Errors: `{error: {code, message}}`. 400 bad input, 404 unknown, 409 conflict (revoked leash, already answered, run in progress), 410 ask expired, 502 Viseca error.
- Known shops = approved purchases on the scenario card in the history, plus shops the customer approved (`new: true`). A one-item leash (`q_close_after_first: "Yes"`) revokes itself after the first approval.

Realtime is **SSE from our backend**, not Supabase Realtime: it carries `ask_expired` and `leash_changed`, and the Supabase service key never leaves the server.

## Engine integration ✅ done

Ara's engine (`packages/engine`, leash-0.2.0) decides in the app API, the scenario runner and the token demo.
- **One contract for rules:** the compiler writes hard_rules with the field names the engine reads (`ruleFields.ts`).
  A rule the engine can't read is never ignored: the purchase is asked (`rule_not_applied`). Guarded by
  `test/app-engine.test.ts`: compiler → mandate → worker → engine matches the reference on 45/45.
- **Customer's words on checks:** the engine names checks after its guards (`per_order_limit`, `item_scope`, …);
  `CHECK_TO_RULE` in `leash/service.ts` maps them to the leash rules so `your_words` shows on the decision card.
- **Not readable by the engine yet (ask Ara):** `items.item_category not_in` (block a category, "Never buy cosmetics"),
  `merchant.merchant_id not_in` (block a shop) and the learned flags. Tighten still writes them, which makes later
  purchases asks; suggestions only offer rules the engine reads (today: no add-ons, known shops only).
- **Live mode:** the live API has its own scenarios (e.g. `SCEN0101`) and card history; `npm run api -- --live` loads
  them, `/api/scenarios` lists them, and the card is read from the first purchase.

## Decision-bound tokens (demo) ✅ done

Our rules decide; the token enforces the decision. After every approval (automated or by the customer) the agent gets
a token for exactly that purchase: one shop (`merchant_id`), one maximum, 15 minutes, one payment. A fooled or hijacked
agent can't spend more, somewhere else, later, or twice. Revoking the leash kills every unused token at once.

- **The maximum never breaks the leash:** approved + 5 % rounding room, capped at the per-order limit and at what's left of
  the budget (approved CHF 120 at a CHF 120 limit → max CHF 120, so AU0004's CHF 126 would be refused). Each token says why
  in one sentence (`max_reason`).
- **No card numbers:** IDs are `tok_demo_…`, labels `DEMO token ••ab12`. Nothing touches a network.
- **Scope, honestly:** in Viseca's simulator the purchase we approve already *is* the payment, so tokens don't change the jury's
  numbers. They show what happens in production, where the agent pays with a credential after the approval. They limit the
  damage of an approval; whether to approve is still decided by the rules.

| Method | Path | What |
|---|---|---|
| GET | `/app/tokens`, `/app/tokens/:id` | All tokens / one token with its history |
| POST | `/demo/tokens/:id/charge {merchant_id?, amount_chf?, later?}` | Simulated merchant charge. Defaults to the bound shop and approved amount; override to show the refusals (`wrong_merchant`, `over_amount`, `token_expired` with `later: true`, `token_used`, `token_revoked`) |
| POST | `/demo/tokens/:id/refund {amount_chf?}` | Refund after use; never more than was charged |

Decisions carry `token` once approved; the stream sends a `token` event on every change. `npm run demo:tokens` tells the
whole story on SCEN0004 data for the pitch or the backup recording.

Pitch line: *"Our rules decide what's allowed. Every approval becomes a token for one shop, one amount, one use, so even a
fooled agent can't spend more, somewhere else, later, or twice."*

## Step 7 — Resilience checklist

- Decision post fails → retry once after 250 ms, then log `post_failed`. ✅
- Engine throws or runs out of time → post `step_up`. ✅
- Duplicate delivery → stored answer, counted once. ✅
- Human window expires → mark `expired`, send nothing, emit `ask_expired`. ✅
- Revoke with pending step_up → do not fake a cancellation (expert question Q5). ✅ (asks stay as they are)

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
