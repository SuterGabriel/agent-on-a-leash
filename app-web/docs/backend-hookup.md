# Hooking the app up to the backend

For Dev 2 (backend) and Dev 1 (engine). The app at `/prototype` runs fully on mock data today. Point it at your backend with one variable and the same screens run live. Nothing in the screens knows the difference: they all read from the reducer, and the reducer is fed either by the demo buttons (mock) or by your feed and stream (live).

## 1. One switch

```bash
cd app/web
echo "VITE_API_BASE=http://localhost:8080" > .env.local
npm run dev
```

Unset → mock (demo buttons visible). Set → live (buttons hidden, "Data: live" in the side panel, decisions arrive from `/app/stream`).

CORS: the app calls you from `http://localhost:5173` (or 5174). Allow that origin, `GET/POST/PATCH/DELETE`, `Content-Type`.

## 2. Where the adapter lives

| File | What |
|---|---|
| `src/features/shopping-card/api/types.ts` | Request and response types. **This is the contract.** Change it here first if you change the API |
| `src/features/shopping-card/api/client.ts` | `api.*` functions, one per endpoint, mock and live in the same signatures |
| `src/features/shopping-card/api/use-live-feed.ts` | Loads `GET /app/feed` once, then turns SSE events into reducer actions |
| `src/features/shopping-card/prototype-state.tsx` | The reducer. `INGEST` is the one action that adds a decision; `sideEffects()` calls your API when the customer acts |
| `src/types/decision.ts` | The `Decision` object (shared with `06_product/07-api-contract.md`) |
| `src/mocks/decisions.json` | Our proposed answers for all 45 purchases, in the exact `Decision` shape. Use it as your expected table |

## 3. Endpoints the app calls

Base path `/app`. JSON in and out. Errors as `{ "error": { "code", "message" } }` with a non-2xx status.

| Method | Path | When the app calls it | Returns |
|---|---|---|---|
| GET | `/app/leash/suggest` | 1.3 Rules from your shopping (P1: today the screen uses the built-in analysis) | `SuggestResponse`: analysis numbers, 4 rules with `evidence` and `hard_rule`, smart defaults with evidence, `instruction_generated` |
| POST | `/app/leash` | 1.4 "Create card with Face ID" | `Leash`. You create the Viseca draft (`instruction` + `hard_rules` + `uncertainty_policy`) and confirm it |
| GET | `/app/leash` | 3.1, 6.1 on load (live) | `Leash` |
| PATCH | `/app/leash/rules` | 6.2 Save, smart setting changed, "Block" a shop | `Leash`. **Stricter** (lower value, ask→decline, block a shop) = Viseca `PATCH /v1/mandates/{id}` (add rule). **Looser** is only accepted with `face_id_confirmed: true` and the Viseca API can't loosen an active mandate, so: `POST /v1/mandates` with the new rules + `/confirm`, store the new `mandate_id`, then `DELETE` the old one. The app doesn't care which path you took, it only reads the returned `Leash` |
| POST | `/app/leash/pause` | 8.1 Pause | 204. Engine declines everything for 24 h |
| DELETE | `/app/leash` | 8.2 Turn off | 204. Viseca `DELETE /v1/mandates/{id}` |
| GET | `/app/feed` | on load (live) | `{ decisions: Decision[], asks: Decision[] }`, newest first |
| GET | `/app/decisions/:id` | 5.2 (when the row isn't in memory) | `Decision` |
| POST | `/app/asks/:id/resolve` | 4.1 Approve / Decline | 204. Forward to Viseca `POST /v1/authorizations/{id}/resolve` |
| POST | `/app/suggestions/:id/accept` | 4.4 "Yes, always", 5.2 suggested rule | 204. `:id` is the decision id; you map its reason code to the learned rule (table in `06_product/04-rules-settings-why.md` §4) |
| GET | `/app/stream` | on load (live), stays open | Server-Sent Events, below |

## 4. The stream

`text/event-stream`. One event per line pair: `event: <type>` then `data: <json>`.

```
event: decision
data: {"decision": { ...Decision with decision "approve" or "decline" }}

event: ask
data: {"decision": { ...Decision with decision "step_up", status "waiting_for_you" }, "deadline_at": "2026-09-25T10:12:00Z"}

event: ask_expired
data: {"id": "AU0040"}

event: leash_changed
data: {"leash": { ...Leash }}
```

The app treats `decision` and `ask` the same way: `INGEST`. A push banner appears only for `reason_codes` in `["lookalike_shop","shop_text_manipulation","session_not_you","wrong_item","unrequested_addon"]` and for asks. Limit and budget declines are quiet rows (concept v4, "Overnight: quiet, not silent"). Decisions with the same `group_id` collapse into one "We stopped 4 payments" alert.

## 5. What the `Decision` must contain for the screens to work

| Field | Screen | Note |
|---|---|---|
| `headline` | row subtitle, 5.2 | 4 to 6 words, customer language ("Not a shop you know") |
| `because` | 4.1 "Why we ask", 5.2 sentence | one sentence, rule + fact |
| `checks[]` | 4.2, 5.2 checklist | one per rule, `result` pass/fail/unsure, `fact` in customer words ("PixelHarbour, never used"), `your_words` on rules from the instruction. **Failing and unsure first** is done by the app |
| `shop_text_quarantine` | grey box | the quoted shop text, only when it tried to give orders |
| `items[0].name` | 4.1, 5.2 | what the agent is buying |
| `amount.chf`, `merchant.name` | everywhere | |
| `group_id` | 7.2 | same id for the 4 burst payments |
| `deadline_at` | 4.1 countdown | asks only |
| `suggestion` | 4.4, 5.2 | optional; if absent the app derives it from `reason_codes` |

Reason codes the app knows: `all_checks_passed`, `over_order_limit`, `over_period_budget`, `lookalike_shop`, `shop_text_manipulation`, `duplicate_order`, `unrequested_addon`, `wrong_item`, `shop_used_other_card`, `new_shop`, `possible_split_order`, `session_not_you`. Unknown codes still render (headline + because), they just don't push.

## 6. Test it without the app

```bash
# 1. the feed shape
curl -s $VITE_API_BASE/app/feed | jq '.decisions[0] | {id, decision, headline, because, checks: (.checks | length)}'

# 2. the stream (leave it open, then start a scenario run in another shell)
curl -N $VITE_API_BASE/app/stream

# 3. an ask, answered
curl -s -X POST $VITE_API_BASE/app/asks/AU0040/resolve -H 'Content-Type: application/json' -d '{"decision":"decline"}' -i | head -1

# 4. tighten, then check
curl -s -X PATCH $VITE_API_BASE/app/leash/rules -H 'Content-Type: application/json' -d '{"rules":{"orderLimit":350}}' | jq .rules
```

Compare your decisions with ours: `src/mocks/decisions.json` has the proposed answer for every `AU` id. A diff script is P0 in `06_product/05-engineering-backlog.md` ("Offline replay of 45").

## 7. Test it with the app (checklist for the demo)

| Check | How | Pass when |
|---|---|---|
| Quiet approval | run SCEN0004, first purchase | row appears in Activity, budget bar moves, **no** banner |
| Push on risky decline | AU0039 lookalike | banner "We stopped a payment at PixelHarbour", tap → 5.2 with the failing check first |
| Ask me | AU0040 | banner, "Waiting for you" row with live countdown, sheet shows `because`, checks, shop text |
| Resolve | tap Decline | `POST /app/asks/AU0040/resolve` received, row becomes "You declined", learned-rule offer appears |
| Learned rule | "Yes, always" | `POST /app/suggestions/AU0040/accept` received, rule visible under Rules → Learned from your answers |
| Tighten | Rules → Each payment → lower → Save | `PATCH` received, value updated on 6.1 and 1.3 |
| Loosen | raise a value | app asks Face ID first, then `PATCH` with `face_id_confirmed: true` |
| Turn off | Rules → Turn off Agent Card | `DELETE /app/leash`, card tab shows the banner again |
| Time's up | wait 120 s on an ask, or send `ask_expired` | "Time's up. Nothing was bought." |
| Offline | stop the backend | info card "Payments paused. Nothing will be bought until we're back." |
| Replay backup | unset `VITE_API_BASE`, "Play SCEN0004" | all 11 purchases play every 2.5 s without a network |

## 8. Judge view (web, laptop)

Not in the phone. `GET /judge/decisions?run_id=` returns every decision of a run with purchase, decision, reasons, checks, and `took_ms`. Kim builds the page from the same `Decision` type; start with a table.

## 9. Trade-offs we made (so nobody re-argues them at 3 a.m.)

- **SSE, not WebSockets.** One direction is enough, `EventSource` reconnects for free.
- **The app never sees the Viseca API.** One key, one place. The app can't leak it and the engine can change without touching screens.
- **Mock and live share `INGEST`.** The demo buttons and the stream produce the same state, so what we rehearse is what runs.
- **Card rules are separate from the task.** Card rules (`orderLimit`, `monthBudget`, shops, smart) are the wallet policy set in Viseca one. The task (`instruction`, item, add-ons) arrives with the scenario run. Send both to the engine; stricter wins.
- **Learned rules only tighten.** They live in our store, not in the Viseca mandate, and are applied before it.
