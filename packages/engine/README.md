# Agent on a Leash — decision engine

Wallet control layer for the Viseca challenge. This is the **decision engine** (Dev 1), running offline on Viseca's data pack.

**Status:** 45/45 public purchases match the reference, **reason codes included** · 17 approve / 13 ask / 15 decline · 24 tests passing, including 12 red-team attacks the public set does not contain · p50 ≈ 0.1 ms per decision (deadline 8,000 ms).

## Start

```bash
npm install
npm run replay -- --all                            # all 45, table + totals + latency
npm run replay -- --scenario SCEN0004 --verbose    # one scenario, with the customer messages
npm test                                           # 24 tests
npm run typecheck
```

## How it works

```
instruction ──compilePolicy()──▶ Policy (+ assumptions, open questions) ─┐
                                                                          ▼
CSV row / live event ──▶ event ──▶ decide() ──▶ quarantine shop text ──▶ 14 guards ──▶ strictest wins
                                     ▲    ▲                                            ▼
                                  Ledger  Baselines (card history)        approve / step_up / decline
                               (this run)                                 + reasons, message, evidence
```

- **Rules decide.** No model in the decision path. Same answers every run.
- **Shop text is data.** Sentences aimed at the agent are quoted, never obeyed, and facts are never taken from them.
- **A missing fact is never permission.** `null` / `unknown` → the customer's uncertainty policy (ask).
- **Fail closed.** A crashed guard → at least `step_up`.
- **No hard-coding.** A test fails if engine code mentions `SCEN00…` or `AU00…`.

## Files

| File | What it does |
|---|---|
| `packages/shared/src/compiler.ts` | Instruction → policy + platform `hard_rules`, with assumptions and open questions (for screen ②) |
| `packages/shared/src/baselines.ts` | From history: known shops per card and per customer, devices, Swiss local hours (recurring payments excluded), countries, issuer-wide shop use |
| `packages/shared/src/buildEvent.ts` | CSV row → live-shaped event (live ID ≠ source ID) |
| `packages/engine/src/shoptext.ts` | Quarantine: NFKC + zero-width strip, injection patterns (EN/DE/FR), fact extraction from clean sentences only |
| `packages/engine/src/decide.ts` | Retry check → guards → aggregate → message → ledger |
| `packages/engine/src/guards/*` | One file per guard (below) |
| `packages/engine/src/replay.ts` | Offline replay + comparison with `data/reference_decisions.csv` |
| `tests/engine.test.ts` | Compiler, boundaries, FX, retry, state, fail-closed, all 45, no hard-coding |
| `tests/redteam.test.ts` | D4: 12 attacks built from a clean purchase; none may be approved |

## Guards

| # | Guard | Verdict | Reason code |
|---|---|---|---|
| 1 | Retry (same live ID) | stored answer | — |
| 2 | Per-order limit, ≤ 10 % over asks | pass / ask / decline | `over_order_limit` |
| 3 | Rolling period budget (approved only, simulated time) | pass / ask / decline | `over_period_budget` |
| 4 | Split order (same shop, 10 min, together over limit) | ask | `possible_split_order` |
| 5 | Item scope (every basket line) | ask | `item_outside_purpose` |
| 6 | Requested item + size | decline / uncertain | `wrong_item`, `wrong_size`, `missing_info` |
| 7 | Unrequested add-on | ask, or decline if "nothing extra" | `unrequested_addon` |
| 8 | Return terms | decline / uncertain | `final_sale`, `returns_too_short`, `missing_info` |
| 9 | Merchant type | decline | `shop_type_mismatch` |
| 10 | Familiar shop (this card / other card / new) | ask | `shop_used_other_card`, `new_shop` |
| 11 | Lookalike seller (Damerau similarity ≥ 0.85, unknown to the issuer) | decline | `lookalike_shop` |
| 12 | Duplicate order (same shop + items + amount ± 5 %, 2 h) | ask | `duplicate_order` |
| 13 | Session integrity: new device, unusual hour, burst, new country, unknown shop; 1–2 signals ask, ≥ 3 stop | ask / decline | `session_not_you` |
| 14 | Shop text manipulation | ask (never approve) | `shop_text_manipulation` |
| 15 | Re-quote after a decline | note only | `requote_after_decline` |

## Next steps

1. **Worker on the live API** (`packages/backend/src/worker.ts`): poll `/v1/decision-requests/next`, call `decide()`, post `toPlatformBody(result)`. Run SCEN0000 live first.
2. **D1 — the leash learns, only tighter** (`packages/engine/src/suggest.ts`): after each customer answer, propose one stricter rule. Rerun a scenario → fewer questions, same safety.
3. Backend API + app screens (see `docs/02_DEV2_BACKEND.md`, `docs/03_APP_KIM.md`).

Prompt for Claude Code, step 1:
*"Read README.md and docs/02_DEV2_BACKEND.md. Build packages/backend/src/viseca/client.ts and worker.ts in TypeScript. The worker long-polls /v1/decision-requests/next?wait=25, builds the policy with compilePolicy(event.mandate.instruction), calls decide() from packages/engine/src/decide.ts with one Ledger per run_id and getBaselines(), and posts toPlatformBody(result). Read TEAM_API_KEY and LEASH_BASE_URL from .env. Add a script to create + confirm a mandate for SCEN0000 and start the run."*
