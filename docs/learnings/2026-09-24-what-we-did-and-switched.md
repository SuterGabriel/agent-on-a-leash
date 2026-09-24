# What we did and what we switched: 24 September 2026, evening session

A record of the work between the engine-branch merge and the end of the evening. The reasoning and the lessons are in
`2026-09-24-tests-merge-and-hardening.md`; this file is the change list, so nobody has to reconstruct it from the diff.

## 1. Merged `feat/engine-integration` into `main` (commit `61b6897`)

The engine branch (Ara: five new guards, general phrasings, worker backoff, card limits, `READMEALLES.md`) and main
(app API, decision-bound tokens, shop track record, compiler with `toMandateDraft`) had diverged for a day.

Three conflicts, all resolved by keeping both sides:

| File | Main had | Engine branch had | Result |
|---|---|---|---|
| `package.json` | `api`, `demo:tokens` scripts | `api-atlas`, `live-results` scripts | all four; duplicate `replay` / `inspect-live` entries removed |
| `packages/shared/src/baselines.ts` | `issuerRefunds` (shop track record) | `customers`, `cardLimits` | all three in the interface, the declarations and the return value |
| `packages/backend/test/worker.test.ts` | `compile` + `toMandateDraft` setup | `parseLeash` setup + `DecisionRequestEnvelope` type | main's setup, plus the type the new backoff tests need |

One behavioural decision beyond the conflicts: **a card with no history**. Main returned `missing_info` as an
*unsure* check; the engine branch returns `no_shop_history` as an *ask*. The engine branch model won (`habitsScope`:
card / customer / none). The adapter now shows `no_shop_history` as *unsure* rather than *failed*, so the app says
"we don't know", not "you broke a rule". Test `engine-no-history.test.ts` updated accordingly.

## 2. Added performance and security test suites (synthetic data, never the 45 public purchases)

New files:

- `packages/backend/test/helpers/synthetic.ts`: seeded generator (Mulberry32) for purchases and history rows built from
  the real merchant, item and card catalogues. Same seed, same data.
- `packages/backend/test/performance.test.ts`: 10 tests with explicit budgets.
- `packages/backend/test/security-hardening.test.ts`: 32 tests (HTTP edge, app secret shapes, loosening attempts,
  secret leakage, token vault odd amounts, hash chain).

Measured (all far inside budget):

| Check | Result | Budget |
|---|---|---|
| Engine, 2,004 synthetic purchases under every leash | p99 0.7 ms, max 7 ms | 25 ms / 500 ms |
| Ledger after 500 purchases in one run | no slowdown | 10x |
| 50 KB injected shop text per line | 1 ms | 500 ms |
| Baselines from 100,000 history rows | 0.4 s | 3 s |
| 200 KB instruction through the compiler | 12 ms | 1 s |
| 200 parallel `GET /app/feed` over 2,000 decisions | 0.9 s total | 5 s |
| Worker, all 45 purchases end to end | p99 2 ms, 0 missed deadlines | 200 ms |

Defects the security tests found, both fixed:

- `TokenVault.charge` accepted negative, zero, NaN and infinite amounts. Now refused with the new code
  `invalid_amount` (`packages/shared/src/token.ts`, `packages/backend/src/tokens/vault.ts`).
- `tighten({ type: "lower_order_limit" })` coerced `[1]` and `true` to 1 via bare `Number()`. Only numbers and numeric
  strings are amounts now (`packages/backend/src/leash/service.ts`).

Not a defect, but recorded in the test comments: `fetch` trims header values, so "secret plus trailing space" reaches
the server as the valid secret, and a null byte never leaves the client.

## 3. Switched three engine behaviours (P0 and P1 from `READMEALLES.md` §6)

| Before | After | Where |
|---|---|---|
| A never-used shop whose name resembles an **established shop of other customers** was **declined** (`lookalike_shop`). SCEN0113 lost 10 purchases to "Night Owl Kitchen" vs "NightOwl Kitchen". | It is **asked** about: the customer never bought at the original, so there is no ground for a verdict. A match against the customer's **own** shops still declines. | `packages/engine/src/guards/lookalike.ts` step 2 |
| A shop the customer **approved earlier in the same run** was still "new" on the next purchase (`no_shop_history` / `new_shop` again). | Familiarity and lookalike **pass** on a same-run approval. First purchase asks, the customer says yes, the next one at that shop is approved. A declined ask teaches nothing. | `Ledger.approvedAtMerchant()` in `ledger.ts`; `familiarity.ts`; `lookalike.ts` |
| "If the session looks unusual … **stop and ask me**" behaved like "pause anything": three signals **declined**. | The compiler reads the action from the sentence: `Policy.sessionAction` is `"ask"` or `"stop"`, the hard rule carries `"ask"` or `"required"`, and the session guard only declines at three signals when the customer said stop. "Pause anything that looks like someone other than me" (SCEN0003) still declines; public set unchanged. | `packages/shared/src/types.ts`, `packages/shared/src/compiler.ts`, `packages/backend/src/compiler/compile.ts`, `packages/engine/src/guards/session.ts`, `packages/backend/src/engine/leashEngine.ts` (`session.integrity` tighten case accepts both values) |

Tests: `tests/patterns.test.ts` (existing issuer-lookalike expectation switched from decline to step_up; new
describes for same-run approvals and for session ask vs stop).

## 4. Added a restart-safe snapshot (instead of Supabase)

- `packages/backend/src/persist.ts`: `attachSnapshotFile(service, file)`. Restores on attach, writes on every bus
  event (debounced 250 ms) and every 5 s if anything changed. Atomic write (`.tmp` then rename). A corrupt file is
  moved aside and the service starts empty.
- `LeashService.snapshot()` / `restore()` / `verifyToken()` (appended to the class). Restore refuses another mode or
  version, marks runs that were still running as failed ("backend restarted during the run"), expires asks whose
  answer window passed while down, and drops tokens whose history chain does not verify.
- Wired in `packages/backend/src/cli/api.ts`. Default file: `data/live/state-<mode>.json` (git-ignored).
  `LEASH_STATE_FILE=off` disables; any other value is the file to use. Documented in `.env.example`.
- Tests: `packages/backend/test/persist.test.ts` (7).

Decision recorded: **no Supabase before the jury.** The seam for a real store is `DecisionStore` plus
`snapshot()` / `restore()`.

## 5. Added a hash-chained token history

- Every `TokenEvent` now carries `prev_hash` and `hash` (SHA-256 of previous hash, time, type, detail; first event
  chains to `"genesis"`).
- `verifyHistory(token)` and `TokenVault.verify(id)` in `vault.ts`; `GET /app/tokens/:id/verify` answers
  `{ ok, events, broken_at }`.
- Restoring a snapshot drops a token whose chain is broken and reports its id.
- Tests: hash chain section in `security-hardening.test.ts` (edited line, removed line, swapped pair, re-hashed line).

## 6. Housekeeping

- `tsconfig.json` `exclude`: added `paraphrases.test.ts`, `performance.test.ts`, `security-hardening.test.ts`,
  `test/helpers/**` (they import the engine, so the engine pass checks them).
- `.env.example`: `LEASH_STATE_FILE` documented.

## Verification at the end of the session

| Check | Result |
|---|---|
| `npm test` | 232 passed, 19 files |
| `npm run replay -- --all` | 45/45 |
| engine typecheck pass | clean |
| strict typecheck pass | clean for these changes; fails only on `app-v4.test.ts` from the concurrent v4 session, not yet in `exclude` |

## Not done, and why

- **Live re-run of the 10 scenarios** after the three engine fixes. It creates mandates on Viseca's shared platform
  and the decision queue is shared per team key, so it needs an agreement on who runs live. Command, per scenario:
  `npm run scenario -- SCEN01xx --live --answer decline`, then `npm run live-results -- <run ids>`.
- **Commits.** The merge is committed. Everything in sections 2 to 6 is in the working tree together with the compiler
  work (`compile.ts`, `dropGuessesCoveredByRules`) and the v4 app files from the other session. Suggested split:
  (a) engine fixes and pattern tests, (b) performance and security suites plus the two vault/tighten fixes,
  (c) snapshot and token chain.
- **Concurrent session.** Someone else edits `service.ts`, `server.ts`, `api.ts`, `shared/leash.ts` and `app-web/`.
  Our edits there are additive and small (imports, one route, one env block, methods at the end of the class).
