# Engineering backlog

Everything that has to be built behind the screens: engine, backend, API integration, judge view, tests. P0 = needed for the demo. "Done when" is the check.

## Key fact for engineers

Every purchase event from `/v1/decision-requests/next` contains the confirmed mandate snapshot: `instruction` (exact words), `hard_rules`, `uncertainty_policy`. `guidance` and `open_questions` are not in the event. PATCH only affects later runs. Details in `04-rules-settings-why.md` section 1.

## Engine (Dev 1)

| Item | What it does | Priority | Done when |
|---|---|---|---|
| Worker loop | Long-poll, validate envelope, decide, POST decision before `deadline_at`. Same `authorization_id` twice returns the saved answer | P0 | SCEN0000 decided live in under 1 s |
| Generic rule evaluator | Reads `hard_rules` (field path, operator, scope, period_days). Uses `billing_amount_chf` only | P0 | Edge values 120.00, 300.00, 399.90 pass |
| State store | Final approvals per leash, 7-day window on simulated time, asks excluded until resolved | P0 | AU0009 declined, AU0011 approved |
| History signals | Known shop per card, other card, known device, lookalike name (1-2 letters, other merchant_id), burst (10 min, night, new device) | P0 | AU0039, AU0044, AU0027-30 match proposed answers |
| Shop text quarantine | Extract facts (size, return days) with regex. Flag instructions ("ignore", "System:", "pre-authorised"). Never raises a decision to approve | P0 | AU0037, AU0040 flagged and quoted |
| Checks list output | For every rule: `result` pass / fail / unsure, `fact`, rule `key`. Plus reason codes, customer message, evidence | P0 | App renders the checklist from live data |
| Purpose and item match | Category + keywords first. Model optional with 5 s cut-off, then the uncertainty policy | P1 | AU0007, AU0017 are asks with model on and off |
| Stricter of snapshot and live | Read latest mandate + learned rules, apply the stricter one | P1 | Tighten during a run changes the next decision |

## Backend and app API (Dev 2)

| Item | What it does | Priority | Done when |
|---|---|---|---|
| Parse instruction | `POST /app/leash/parse`: text to rules + label + "your words" span per rule + open questions. Model with JSON schema, regex fallback | P0 | All 5 instructions parse, fallback gives amounts and periods |
| Mandate lifecycle | Create draft, confirm, PATCH (add rules, ask to decline), DELETE. Store our metadata next to `mandate_id` | P0 | Create, tighten, revoke work from the app |
| Decisions store + feed | Save every decision with checks. `GET /app/feed`, `GET /app/decisions/:id` | P0 | S4 and S5 load live data |
| Live updates | `GET /app/stream` (Server-Sent Events) pushes new decisions and asks | P0 | New row appears without refresh |
| Asks | `GET /app/asks` with deadline. `POST /app/asks/:id/resolve` forwards to `/v1/.../resolve` | P0 | Approve and decline accepted by the platform |
| Learned rules | Store suggestions and accepted rules. `POST /app/suggestions/:id/accept`. Engine reads them | P1 | "Always decline add-ons" changes the next decision |
| Burst grouping | Give decisions from one unusual session the same `group_id` | P1 | AU0027-30 appear as one alert |
| Pause and done-after-one | Pause flag the engine checks. Auto-revoke after first approval if set | P1 | Paused leash declines everything |

## Demo and judge view (Dev 2 + Kim)

| Item | What it does | Priority | Done when |
|---|---|---|---|
| Run control | Start a scenario run with the current mandate, team reset (dev only) | P0 | One button starts SCEN0001 |
| Judge view data | `GET /judge/decisions`: purchase, decision, reasons, checks, time taken | P0 | Web page lists all decisions of a run |
| Replay mode | Plays mock or recorded events into the app without the live API | P0 | Demo works with Wi-Fi off |
| Per-scenario score | Our decision vs proposed answer, per scenario | P1 | Table shows 45 of 45 or the differences |

## Tests (everyone)

| Test | How | Priority |
|---|---|---|
| Offline replay of 45 | Build events from CSV, run engine, diff with `app/web/src/mocks/decisions.json` | P0 |
| Retry | Same `authorization_id` twice counts once | P0 |
| Human path | Ask to approve, ask to decline, no answer for 120 s | P0 |
| Model off | Same answers for every hard rule, no crash | P0 |
| Injection | Shop text never turns a decision into approve | P0 |
| Tighten and revoke | PATCH then next run uses it. DELETE then new runs rejected | P0 |
| 5-second test | Someone outside the team reads a declined card and says why | P0 |

`app/web/src/mocks/decisions.json` holds our proposed answer for all 45 purchases in the exact decision shape. The UI uses it as mock data and the engine can use it as the expected table.
