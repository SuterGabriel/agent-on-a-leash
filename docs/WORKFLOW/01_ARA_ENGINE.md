# Dev 1 — Decision engine

You own the brain: given one purchase event, the confirmed policy and memory of earlier decisions,
return `approve`, `decline` or `step_up` with reason codes, a customer message and evidence, in < 50 ms.
Pure functions, no network. Dev 2 calls you from the worker.

---

## Step 0 — Setup (30 min)

```bash
git clone <team repo> && cd agent-on-a-leash
mkdir -p packages/engine/src/guards packages/shared/src tests data
# copy the Viseca data pack unchanged
git clone https://github.com/START-Hack/viseca-2026 /tmp/viseca && cp -r /tmp/viseca/data/* data/
cd packages/engine && npm init -y && npm i -D typescript tsx vitest @types/node && npm i csv-parse ajv
npx tsc --init
```

Read, in this order (45 min, do not skip):
1. `data/README.md` — how files join.
2. `data/scenario_catalogue.csv` — the 5 instructions.
3. `data/scenario_fixtures/example_authorization_request.json` — the exact event you will receive.
4. `data/data_dictionary.md` — currencies, nulls, time rules.

## Step 1 — Work the problem on paper (45 min)

Open `purchase_attempts.csv` filtered to SCEN0001 (10 rows, sort by `replay_order`).
For each row write: amount in CHF, merchant, basket lines, your decision, the one rule that decides it.
This table **is** your spec. Only then write code.

## Step 2 — Data layer (1 h)

`packages/shared/src/`
- `loaders.ts` — load all CSVs once at startup into typed maps keyed by ID.
- `fx.ts` — fixed rates from `fx_rates.csv`. Use the row's currency, never the shop's country. `billing_amount_chf` already includes delivery: never add delivery again.
- `baselines.ts` — from `authorization_history.csv`, per card and per customer:
  approved purchase count per merchant, devices seen, countries seen, hour-of-day histogram (Swiss local time), refunds per merchant.
- `buildEvent.ts` — turn a CSV purchase attempt + its cart lines + merchant into an event shaped exactly like the example JSON (for offline replay).

## Step 3 — Engine core (1 h)

```
packages/engine/src/
  types.ts        Verdict = PASS | STEP_UP | DECLINE | UNCERTAIN | SKIP; GuardResult
  facts.ts        buildFactSheet(event, policy, baselines, ledger)
  shoptext.ts     quarantine merchant text → facts + injection flags
  guards/*.ts     one file per guard, each a pure function (facts) => GuardResult
  aggregate.ts    strictest wins; UNCERTAIN → uncertainty_policy; guard error → at least step_up
  message.ts      reason code → customer message + evidence list
  ledger.ts       per-run memory: approved spend window, seen IDs, item signatures
  decide.ts       decide(event, policy, ctx) → Decision
```

Rule of aggregation: `approve < step_up < decline`. The final answer is the strictest verdict.

## Step 4 — Guards, in build order

Build one, test it, commit, next. Target reason codes are in the spec §3.4.

| Order | Guard | Scenario it unlocks |
|---|---|---|
| 1 | Retry (same live ID → same stored answer, counted once) | all |
| 2 | Per-order limit (+ small-overshoot band) | 0, 1 |
| 3 | Rolling period budget (approved only, simulated time) | 1 |
| 4 | Split order | 1 |
| 5 | Item scope (every basket line) | 1 |
| 6 | Shop-text quarantine + injection flag | 4 |
| 7 | Lookalike merchant (normalised name similarity) | 4 |
| 8 | Duplicate order (same merchant + item signature + amount) | 4 |
| 9 | Unrequested add-on | 2, 4 |
| 10 | Requested item + size | 2, 4 |
| 11 | Return terms | 2 |
| 12 | Merchant type | 2 |
| 13 | Merchant familiarity (this card / other card / new) | 3, 4 |
| 14 | Session integrity (device, hour, velocity, country) | 3 |
| 15 | Re-quote note, gift card / cash-like | 4 |

Missing fact is never permission: `null` or `"unknown"` → `UNCERTAIN`.

## Step 5 — Replay harness (build it right after guard 2)

`packages/engine/src/replay.ts`
```bash
npx tsx src/replay.ts --scenario SCEN0001      # prints a table: order, CHF, decision, reasons, expected, match
npx tsx src/replay.ts --all --compare           # 45 rows + totals + latency p50/max
```
- Feed events in `replay_order`. Keep the ledger across the scenario.
- For step_ups, apply the assumed customer answer from the oracle so budget state stays realistic.
- The oracle (`data/reference_decisions.csv`) is for **tests only**. The engine must never read it.

## Step 6 — Tests (vitest, run on every commit)

- Boundaries: exactly 120.00 approves, 300.00 approves, 14 days approves; FX EUR/USD/GBP conversions.
- Same live ID twice → one ledger entry.
- Approving a step_up changes the next purchase's budget verdict.
- Every injection sample (public + our red-team) never yields `approve`.
- Model off → identical decisions.
- A guard that throws → at least `step_up`.
- Grep test: no `SCEN00` or `AU00` literals in `packages/engine/src`.

## Step 7 — Differentiators you own

**D1 — Learning leash (only tighter).** `suggest.ts`: after each human answer, look at the reason code and the answer. Examples:
- declined `unrequested_addon` twice → propose rule `items.item_category not_in [subscriptions, membership]`
- declined `new_shop` → propose "only shops used on this card"
- approved `shop_used_other_card` → propose nothing (loosening is never automatic; it needs a new leash)
Output: `{proposed_rules, reason, based_on:[authorization_ids]}`. Dev 2 turns an accepted proposal into a PATCH.
Demo metric: ask rate run 1 vs run 2 of the same scenario with the tightened mandate.

**D4 — Red-team suite.** `tests/redteam/*.json`: 20–30 events built from real rows with modified text or merchants:
injections in German/French, zero-width characters, "System:" markers, lookalikes with swapped letters, split orders across 9 minutes.
Script prints: attacks, approved (must be 0), asked, declined.

## Definition of done

- `replay --all --compare` → 45/45 or each mismatch explained in `docs/DIFFS.md`.
- p50 < 50 ms, max < 1 s.
- Red-team: 0 approved.
- Every decision has ≥ 1 reason code, a customer message and evidence.

## Checkpoints

| When | You show |
|---|---|
| Thu 17:30 | Guards 1–3, replay prints SCEN0001 |
| Thu 21:00 | SCEN0001 + SCEN0004 match |
| Fri 01:00 | 45/45 |
| Fri 09:00 | D1 suggestions + red-team report |
