# Tests and security

What is tested, what protects the customer's money, and where each claim is proven. Every number was measured on 25 September 2026 with the commands shown, so anyone can re-run it in front of the jury. The pitch summary is in `docs/HACKATHON.md`; this file is the long form.

Every test is a sentence a jury member can read. The appendix lists all 263 of them.

## 1. The numbers

| Claim | Number | Re-run with |
|---|---|---|
| Tests, all green | 263 in 22 files | `npm test` |
| Security suites alone | 53 tests in about 2 seconds | the command in section 7 |
| Correctness against Viseca's reference | 45 of 45 public decisions match, on three different paths (engine replay, backend and real engine on the offline platform, the app's compiler path) | `npm run replay`, `tests/engine.test.ts`, `engine.test.ts`, `app-engine.test.ts` |
| Reworded instructions | 20 paraphrases in English and German, including Swiss notation and no currency, give the same decisions on all five scenarios | `paraphrases.test.ts` |
| Red team | 12 attacks on otherwise approved purchases, none approved, every one flagged and quoted | `tests/redteam.test.ts` |
| HTTP surface | 24 edge cases: malformed bodies, wrong secrets in ten shapes, loosening attempts, no secret in any response | `security-hardening.test.ts` |
| Money | 18 tests on the token vault: odd amounts, one rappen over, replay, another shop, expiry, revocation, refunds, hash chain | `tokens.test.ts`, `security-hardening.test.ts` |
| Load | 2,000 synthetic purchases at p99 0.7 ms and worst case 7 ms; 50 KB of injected shop text in 1 ms; 200 KB instruction under a second; 0 missed deadlines end to end | `performance.test.ts` |
| Real defects found by these tests | 2, fixed on 24 September | section 4 |

The performance suite has three parallel-load tests with wall-clock budgets. They pass on their own in under 7 seconds; on a laptop that is busy with something else they can time out. Run `npm test` on an idle machine before showing it.

## 2. What the tests cover, suite by suite

| Area | File | Tests | What it proves |
|---|---|---|---|
| Correctness | `tests/engine.test.ts` | 11 | All 45 public purchases match the reference. Exactly at the limit approves, up to 10 % over asks, more declines. The same live id twice is one answer, counted once. A pending ask is not spend. A guard that throws gives at least an ask. Engine and compiler never mention a scenario or purchase id. |
| Correctness | `engine.test.ts` | 14 | Backend plus real engine on the offline platform: 45 of 45. The stricter of the frozen and the current mandate always wins, a higher limit never loosens. A rule the engine cannot read is never ignored: it asks. A revoked mandate declines. Shop track record is shown, never decides. |
| Correctness | `app-engine.test.ts` | 3 | The app's path, compiler to mandate to worker to engine, matches the reference on 45 of 45, carries the customer's own words on every check, and issues a token only for approvals. |
| Reading the customer's words | `compiler.test.ts` | 12 | Every sentence of the five scenario instructions is understood, the exact words are kept with offsets, a weekly budget is not read as a per-order limit, a limit per night or per item is not a limit per order, nothing the compiler does not understand is dropped, answers only add or narrow rules. |
| Reading the customer's words | `paraphrases.test.ts` | 35 | The compiler reads rules, not sentences: the catalogue wording plus rewordings in English and German, reordered, in Swiss notation, without a currency, and a vague one, compile to the same rules and give the same decisions end to end. |
| Reading the customer's words | `tests/patterns.test.ts` | 46 | Invented phrasings, none copied from a scenario: amounts in four currencies, per-unit limits, how often, which days, exclusions, categories, the requested item, returns, known shops, extras, session, doubt, travel destinations and nights, and when the leash ends. Plus the guards behind them. |
| Reading the customer's words | `valid-until.test.ts` | 4 | "Until Friday" becomes a rule with the customer's words, declines every purchase after the end in simulated time, and can only be moved earlier. |
| Cards with little history | `engine-no-history.test.ts` | 3 | A card with no history is asked with an honest message, never declined for what the engine cannot know. A burst of orders is still caught. |
| The platform path | `worker.test.ts` | 16 | The worker against the offline copy of Viseca's platform: every purchase decided in time, a redelivered purchase answered once and counted once, backoff that never sleeps past the answer window, engine error or slow engine give an ask before the deadline, a failed post is retried, an unanswered ask expires, rules can be added but never removed or loosened. |
| The platform path | `live-shapes.test.ts`, `live-reference.test.ts`, `live-fixes.test.ts` | 11 | Live API shapes, deadlines and evidence format; the reference data downloads, caches and parses; two findings from the live runs are fixed: a card missing from the local table, and an unanswered ask ending as declined with `step_up_expired`. |
| The app's API | `api.test.ts` | 10 | Setup needs Face ID, a run fills the feed, asks carry the customer's words, the budget counts approvals only, tighten only tightens, pause declines everything, revoke stops runs and turns tokens off, unknown routes and methods are refused. |
| The app's API | `app-v4.test.ts` | 10 | The contract the phone app uses: rules proposed from history with evidence, the Agent Card from two numbers and the switches, tighten without Face ID and loosen refused without it, answering a question, pause and turn off. |
| The app's API | `learned-shop-text.test.ts` | 2 | A declined shop-text ask carries the suggestion; accepting it adds a learned rule and the next run declines that purchase without asking. |
| Voice | `voice-agent.test.ts` | 5 | The agent declares every tool once, the answer tool accepts only approve or decline, setup creates nothing without a yes, the prompt keeps the model out of the decision and out of the shop's orders, the agent needs no secret. |
| Money | `tokens.test.ts` | 11 | A decision-bound token pays once at the approved shop, refuses a replay, more than approved, another shop, and use after expiry; refunds never exceed the charge; the maximum never exceeds the per-order limit or what is left of the budget; revoking kills every unused token; ids are clearly not card numbers. |
| Security | `security.test.ts` | 6 | A double tap sends one answer to Viseca. Racing approvals cannot spend more than the budget. Over budget is the customer's call, with the overshoot named. Writes without the app's secret are refused. Approve needs Face ID, decline never. Reads are open, only the app's origin is allowed. |
| Security | `security-hardening.test.ts` | 34 | The HTTP edge, the token vault against odd amounts, and the hash chain. Section 3 lists them. |
| Security | `tests/redteam.test.ts` | 13 | Section 3 lists them. |
| Robustness | `persist.test.ts` | 7 | A restored snapshot shows the same leash, feed, asks and tokens. A snapshot from the other mode is refused. A token whose history was edited in the file is dropped. An ask whose window passed while the backend was down comes back expired. A corrupt file is moved aside. |
| Robustness | `performance.test.ts` | 10 | Engine latency under 2,000 synthetic purchases, a 500-purchase ledger, 50 KB shop text, 100,000 history rows, a 200 KB instruction, 200 parallel feed reads, 100 parallel parses, 50 stream clients, and every scenario end to end with no missed deadline. |

## 3. Security measures, threat by threat

| Threat | What stops it | Where | Proven by |
|---|---|---|---|
| Shop text that talks to the agent | Shop text is quarantined. Facts are read only from clean sentences; a sentence that gives orders is flagged and quoted to the customer with "we ignored this". Text is normalised first, so zero-width characters and fullwidth letters do not hide it. A number inside an injected sentence never raises a limit. Injected text can make a purchase an ask, never an approval. | `packages/engine/src/shoptext.ts`, `guards/shopText.ts` | red team: English role marker, zero-width characters, German, French, fullwidth letters, urgency, polite override |
| A fake or imitated seller | The lookalike guard compares the shop's name with the customer's own shops and with every established shop at the issuer. A lookalike of a shop the customer used is declined; a lookalike of a shop they never used is a question, because the engine has no ground for a verdict. The learned rule "block shops that look like my known shops" turns the question into a decline. | `guards/lookalike.ts`, `guards/familiarity.ts` | red team: swapped letters; patterns: five lookalike cases |
| The wrong item, a hidden extra, a gift card, a subscription | Only the requested item, no extras that were not asked for, only the allowed categories, blocked keywords in item names and clean shop text. | `guards/requestedItem.ts`, `addon.ts`, `itemScope.ts`, `blocked.ts` | red team: gift card disguised as a monitor, hidden subscription add-on |
| The same order again, or a new price after a no | Duplicate and requote guards; the ledger counts the same live id once; a redelivered purchase gets the stored answer. | `guards/duplicate.ts`, `requote.ts`, `ledger.ts`, `worker.ts` | red team: same order 90 minutes later; worker: redelivery answered once |
| Someone else driving the session | Session signals (new device, night, a quick series of orders) ask under "stop and ask me" and stop under "pause anything". A burst of orders is caught even without history. A yes teaches the device for the run, never a higher limit. | `guards/session.ts`, `orderFrequency.ts` | patterns: session cases; no-history: burst caught |
| The agent is fooled after the approval | Every approval issues a token bound to that decision: one shop, one maximum, fifteen minutes, one payment. Anywhere else, more, later or twice is refused. Revoking the card kills every unused token. The main card number is never handed out. | `packages/backend/src/tokens/vault.ts` | tokens: eleven cases; hardening: odd amounts, one rappen over |
| A doctored record | Every token event carries the previous hash. A verify endpoint says whether the history holds and names the broken point. A snapshot whose token history was edited drops that token on restore. | `tokens/vault.ts`, `persist.ts` | hardening: change one detail, remove a line, swap two lines; persist: edited history dropped |
| Two answers at once | The ask is claimed before the first await; a second answer gets 409 `busy`. A double tap, or app and voice together, cannot send approve and decline both. | `leash/asks.ts` | security: double tap sends one answer |
| Two approvals that fit the budget alone but not together | The budget is checked again and reserved at the moment the customer approves, before anything waits. Over budget the customer sees the overshoot and can still say "buy anyway". | `LeashService.reserveBudget` | security: racing approvals |
| Someone other than the app writing | Every write under `/app/*` needs the app's secret as a bearer. Ten wrong shapes are refused with 401, the secret in the query string does not count. One origin is allowed. Live mode refuses to start without both. | `leash/server.ts`, `cli/api.ts` | hardening: the secret under every wrong shape; security: only the app can answer |
| Loosening the rules from the agent's side | The API only tightens. A higher or equal limit is refused, so are zero, negative, NaN, string and object limits. Loosening is a new leash with Face ID; without it, 403. The end date can only move earlier. | `leash/service.ts`, `app-v4` routes | hardening: cannot be loosened; app-v4: PATCH refuses to loosen; valid-until: later is refused |
| An approval nobody meant | Approve needs Face ID, decline never does. Silence never approves: an unanswered question expires after 120 seconds as declined, on screen and by voice. | ask sheet, `worker.ts`, voice agent prompt | security: Face ID; live-fixes: expired ask is declined; voice: model kept out of the decision |
| The engine fails or is slow | Fail closed: a guard that throws gives at least an ask, a slow engine gives an ask before the deadline, a failed post is retried. | `decide.ts`, `worker.ts` | tests/engine: fail closed; worker: engine error, slow engine |
| Malformed or oversized input | Invalid JSON, arrays, bare strings and nested objects are 400, never 500. A body above 1 MB is 413. Unknown routes 404, wrong methods 405, no stack trace. 50 KB of shop text and a 200 KB instruction are handled in milliseconds, no catastrophic regex. | `leash/server.ts` | hardening: malformed requests; performance: shop text and instruction sizes |
| A secret leaking | No error body or leash view contains the app secret or the team key. The team key lives only on the server. Shop text comes back as JSON, never as HTML. | `cli/api.ts`, `leash/server.ts` | hardening: no secret ever appears in a response |
| The backend dies mid-run | A JSON snapshot keeps the leash, feed, open asks and tokens: atomic write, debounced, mode-checked, tamper-checked. A corrupt file is moved aside. Open asks whose window passed come back expired, nothing is bought. | `persist.ts` | persist: seven cases |
| A model that can be talked into a decision | No model runs in the decision path. Every decision is a list of checks with the fact that failed. The only model in the product reads the question aloud and passes the spoken yes or no to the same endpoint the screen uses; its prompt forbids following shop text. | section 5 of `docs/HACKATHON.md` | voice agent: prompt and tools |
| Hard-coding to the challenge data | A test fails if the engine or compiler mentions any scenario or purchase id, public or live. | `tests/engine.test.ts` | no hard-coding |

## 4. Two defects the tests found, and three fixes from the review

Found on 24 September by asking each function that moves or limits money what it does with a value it was never meant to get:

- The token vault accepted a negative, zero, NaN or infinite charge. The HTTP route guarded most of it, the vault did not. Now `invalid_amount`.
- Tightening the order limit coerced `[1]` and `true` to 1. It tightened, but by accident. Now refused.

Built from a ten-point security review the same day, each with a test that fails on the code before the fix (`docs/learnings/2026-09-24-security-review.md`):

- One answer per ask: claim the ask before the first await.
- The budget is checked again at the moment the customer approves.
- Only the app can write: the app's secret and one origin, required in live mode.

## 5. Reviewed and deliberately not built

Said plainly if asked.

| Point | Why not |
|---|---|
| SSRF | The backend never fetches a shop URL. Viseca sends structured authorization events; there is nothing to fetch. |
| IDOR | One customer, one leash, in memory. The ownership check comes with real users and a database. |
| CSRF | The app authenticates with a header, not a cookie, so a foreign site cannot make the browser send it. |
| Signed voice URLs | The voice agent is public for the hackathon. It holds no credential and its only write goes through the app on the customer's own device. |
| Hash-chained decision feed | Built for the token history, the place money moves. The same pattern fits the decision feed after the hackathon. |
| The app secret | One shared secret in the app bundle keeps the agent and outsiders out. It is not user authentication; real sessions come with a login. |

## 6. The data the tests use

| Data | Used for |
|---|---|
| Viseca's public set: 45 purchases in 5 scenarios with 4,701 history rows, copied unchanged into `data/` | The replay, the comparison figure, the red team (every attack starts from a real approved purchase and changes one thing), most guard tests |
| Viseca's reference decisions | Scoring only. The engine never reads the file; a test fails if the engine or compiler mentions a scenario or purchase id |
| Viseca's live scenarios: 10 scenarios, 111 purchases, other cards and shops | The live figures in `docs/pitch/` |
| Synthetic purchases from a seeded generator built on Viseca's real catalogues (`packages/backend/test/helpers/synthetic.ts`) | Performance and hardening: 2,000 purchases, 100,000 history rows, 50 KB of shop text, a 200 KB instruction |
| Hand-written edge cases in the test files | Guards and compiler: lookalike names, a card with no history, unusual wording, session signals, travel |
| Our own API traffic against an in-process copy of Viseca's platform | The security suites: our HTTP surface and the token vault, not the engine |

## 7. How to show it

The three security suites, 53 tests, about two seconds:

```bash
npx vitest run tests/redteam.test.ts packages/backend/test/security-hardening.test.ts packages/backend/test/security.test.ts
```

Everything, 263 tests:

```bash
npm test
```

The 45 public purchases against the reference, with the timing line:

```bash
npm run replay
```

## Appendix: every test, by file

### packages/backend/test/api.test.ts (10)

- app API, offline end to end › S1–S3: parse, refuse without Face ID, confirm with answers
- app API, offline end to end › S4–S6: a run fills the feed, asks carry the customer's words, the budget counts approvals
- app API, offline end to end › D1: a decline only offers rules the engine can read ('Never buy cosmetics' waits for engine support)
- app API, offline end to end › D1: an add-on suggestion is offered, and accepting adds a learned rule the engine reads
- app API, offline end to end › S8: tighten only ever tightens
- app API, offline end to end › pause declines everything, resume lifts it
- app API, offline end to end › judge view summarises the run
- app API, offline end to end › tokens: every approval gets one; a fooled agent can't pay elsewhere, more, later or twice
- app API, offline end to end › S9: revoke turns the token off and stops new runs
- app API, offline end to end › unknown routes and methods

### packages/backend/test/app-engine.test.ts (3)

- app path: compiler → mandate → worker → Ara's engine › all 45 automated decisions match the reference, and no rule goes unread
- app path: compiler → mandate → worker → Ara's engine › the engine's checks carry the customer's own words
- app path: compiler → mandate → worker → Ara's engine › approved purchases get a token, the rest don't

### packages/backend/test/app-v4.test.ts (10)

- card rules as an instruction › compiles into an order limit, a 30-day budget and the uncertainty policy
- card rules as an instruction › proposes rounded values from the card's history with evidence
- /v4/app: the app's contract on our backend › GET /v4/app/leash/suggest reads the demo card's history
- /v4/app: the app's contract on our backend › GET /v4/app/leash before setup is off
- /v4/app: the app's contract on our backend › POST /v4/app/leash creates the Agent Card from two numbers and the switches
- /v4/app: the app's contract on our backend › PATCH tightens without Face ID and refuses to loosen without it
- /v4/app: the app's contract on our backend › PATCH block_shop by name adds a blocked shop
- /v4/app: the app's contract on our backend › POST /v4/api/runs: the scenario becomes the task on top of the card rules, decisions arrive in the app's shape
- /v4/app: the app's contract on our backend › POST /v4/app/asks/:id/resolve answers a question; the answer is shown as an answer, not a question
- /v4/app: the app's contract on our backend › pause and turn off

### packages/backend/test/compiler.test.ts (12)

- policy compiler › understands every sentence of the five scenario instructions
- policy compiler › keeps the customer's exact words with correct offsets
- policy compiler › finds the right rules per scenario
- policy compiler › does not read the weekly budget as a per-order limit
- policy compiler › reads the example chip wording from the app
- policy compiler › never drops an instruction it doesn't understand
- policy compiler › answers only add or narrow rules
- a limit per night or per item is not a limit per order › 'at most CHF 200 per night' writes a unit-price rule and no order limit
- a limit per night or per item is not a limit per order › 'CHF 60 a night' and 'CHF 25 each' are unit limits; 'purchases up to CHF 70 each' stays an order limit
- a limit per night or per item is not a limit per order › an order limit next to a unit limit is still read
- a stay: destination and nights become chips the engine reads back › 'A hotel in Lyon for 3 nights' gives a Stay in Lyon chip and a 3 nights chip with hard rules
- a stay: destination and nights become chips the engine reads back › no stay, no chips

### packages/backend/test/engine-no-history.test.ts (3)

- a card with no history (live scenarios) › 'shops I use': unknown, asked, with an honest message
- a card with no history (live scenarios) › 'someone other than me': a normal purchase is asked, not declined
- a card with no history (live scenarios) › a burst of orders is still caught without history

### packages/backend/test/engine.test.ts (14)

- the stricter of the frozen and the current mandate › the snapshot's own rules change nothing
- the stricter of the frozen and the current mandate › a lower limit wins from either side; a higher one never loosens
- the stricter of the frozen and the current mandate › learned rules: shop text and lookalikes decline instead of asking
- the stricter of the frozen and the current mandate › uncertainty: decline beats ask, approve never loosens ask
- the stricter of the frozen and the current mandate › every rule the compiler writes is understood when it comes back in a mandate
- the stricter of the frozen and the current mandate › two different period limits merge into one stricter than both
- LeashEngine through the worker port › approves AU0001 with the app's format: headline, because, one check per guard that ran
- LeashEngine through the worker port › a rule the engine cannot express is never ignored: it asks
- LeashEngine through the worker port › a revoked current mandate declines
- shop track record (issuer history, display only) › a shop with a normal refund share passes, with the numbers as the fact
- shop track record (issuer history, display only) › 5% refunds or more over 20+ payments is marked unsure
- shop track record (issuer history, display only) › too few payments to judge is never unsure; no history at all shows no check
- shop track record (issuer history, display only) › is added to the card without touching the decision
- backend + real engine on the offline platform › all 45 public purchases match the reference, with asks answered as the reference assumes

### packages/backend/test/learned-shop-text.test.ts (2)

- learned rule: always decline when a shop's text gives orders › a declined shop-text ask carries the suggestion, and the quoted shop text travels with the decision
- learned rule: always decline when a shop's text gives orders › accepting it adds a learned rule, and the next run declines that purchase without asking

### packages/backend/test/live-fixes.test.ts (2)

- live findings › a card missing from the local card table (live cards like CA1331) still shows in the leash
- live findings › an unanswered ask ends as declined with reason step_up_expired, as on the live API

### packages/backend/test/live-reference.test.ts (3)

- live reference data › downloads, caches in the folder, and parses scenarios, merchants and history
- live reference data › uses the cache when a download fails, and fails when there is no cache
- live reference data › baselines take shop names from history rows; the merchant table wins where both exist

### packages/backend/test/live-shapes.test.ts (6)

- live API response shapes › the live event passes our event check
- live API response shapes › reads the flat run counters and knows when the worker is done
- live API response shapes › all delivered and nothing queued counts as done even while an ask is pending
- live API response shapes › step_up responses carry Viseca's own answer deadline
- evidence format › sends one object per check
- evidence format › the offline platform rejects string evidence like the live API

### packages/backend/test/paraphrases.test.ts (35)

- policy paraphrases: the compiler reads rules, not sentences › has the catalogue wording plus at least 10 rewordings in English and German
- policy paraphrases: the compiler reads rules, not sentences › SCEN0000-catalogue: Buy one ordinary grocery item for CHF 20 or less from a shop…
- policy paraphrases: the compiler reads rules, not sentences › SCEN0000-en: Please get me a single ordinary grocery item, max CHF 20, fr…
- policy paraphrases: the compiler reads rules, not sentences › SCEN0000-de: Kaufe einen gewöhnlichen Lebensmittelartikel für höchstens 2…
- policy paraphrases: the compiler reads rules, not sentences › SCEN0001-catalogue: Order our household groceries for delivery. Keep each order …
- policy paraphrases: the compiler reads rules, not sentences › SCEN0001-en: Weekly groceries, delivered to our home. No single order abo…
- policy paraphrases: the compiler reads rules, not sentences › SCEN0001-de: Bestelle unsere Lebensmittel zur Lieferung. Pro Bestellung h…
- policy paraphrases: the compiler reads rules, not sentences › SCEN0001-de-reordered-decline: Pro Woche maximal 300 Franken für unsere Haushaltseinkäufe, …
- policy paraphrases: the compiler reads rules, not sentences › SCEN0002-catalogue: Replace my worn road-running shoes in size 43. Buy only from…
- policy paraphrases: the compiler reads rules, not sentences › SCEN0002-en: My road running shoes are worn out, please replace them: siz…
- policy paraphrases: the compiler reads rules, not sentences › SCEN0002-de: Ersetze meine abgenutzten Strassenlaufschuhe in Grösse 43. K…
- policy paraphrases: the compiler reads rules, not sentences › SCEN0003-catalogue: The agent may buy clothing for me, up to CHF 250 per order, …
- policy paraphrases: the compiler reads rules, not sentences › SCEN0003-en: You can buy clothes for me, max CHF 250 per order, but only …
- policy paraphrases: the compiler reads rules, not sentences › SCEN0003-de: Der Agent darf Kleidung für mich kaufen, bis zu CHF 250 pro …
- policy paraphrases: the compiler reads rules, not sentences › SCEN0004-catalogue: Buy the 27-inch monitor I chose, from a seller I have bought…
- policy paraphrases: the compiler reads rules, not sentences › SCEN0004-en: Get the 27-inch monitor I picked, up to CHF 400, only from a…
- policy paraphrases: the compiler reads rules, not sentences › SCEN0004-de: Kaufe den 27-Zoll-Monitor, den ich ausgesucht habe, für höch…
- policy paraphrases: the compiler reads rules, not sentences › no-currency-en: Groceries only, max 120 per order and max 300 per week. Decl…
- policy paraphrases: the compiler reads rules, not sentences › swiss-notation-de: Lebensmittel, max. Fr. 120.- pro Einkauf, höchstens Fr. 300.…
- policy paraphrases: the compiler reads rules, not sentences › vague-de: Kauf mir etwas Schönes fürs Wochenende.…
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0000-catalogue on SCEN0000
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0000-en on SCEN0000
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0000-de on SCEN0000
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0001-catalogue on SCEN0001
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0001-en on SCEN0001
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0001-de on SCEN0001
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0002-catalogue on SCEN0002
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0002-en on SCEN0002
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0002-de on SCEN0002
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0003-catalogue on SCEN0003
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0003-en on SCEN0003
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0003-de on SCEN0003
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0004-catalogue on SCEN0004
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0004-en on SCEN0004
- policy paraphrases end to end: a reworded leash gives the same decisions › SCEN0004-de on SCEN0004

### packages/backend/test/performance.test.ts (10)

- engine latency › 2,000 synthetic purchases under every scenario leash: p99 and worst case stay far below the 5 s budget
- engine latency › a long run (500 purchases in one ledger) does not slow down as the ledger grows
- engine latency › shop text of 50 KB per line is still decided quickly (no catastrophic regex)
- baselines and compiler › habits from the real 4,701-row history and from 100,000 synthetic rows
- baselines and compiler › compiling every scenario wording and a rich one: p99
- baselines and compiler › a 200 KB instruction is rejected or compiled in well under a second (no catastrophic regex)
- app API under load › 200 parallel feed reads over 2,000 decisions all answer, in time
- app API under load › 100 parallel parse requests all answer with the same rules
- app API under load › 50 stream clients connect and disconnect without breaking the server
- worker end to end with the real engine › every scenario run: nothing misses its deadline, latency p99 stays small

### packages/backend/test/persist.test.ts (7)

- snapshot and restore › a fresh service restored from a snapshot shows the same leash, feed, asks and tokens
- snapshot and restore › a snapshot from the other mode is refused
- snapshot and restore › a token whose history was edited in the file is dropped; the others are kept
- snapshot and restore › an ask whose answer window passed while the backend was down comes back expired
- the snapshot file › is written after a run and read back by a new service
- the snapshot file › a corrupt file is moved aside and the service starts empty
- the snapshot file › nothing changed, nothing written: flush reports false the second time

### packages/backend/test/security-hardening.test.ts (34)

- HTTP edge › malformed requests are refused, never crash › invalid JSON is a 400, not a 500
- HTTP edge › malformed requests are refused, never crash › a JSON array or a bare string is not an object
- HTTP edge › malformed requests are refused, never crash › a body above 1 MB is refused with 413
- HTTP edge › malformed requests are refused, never crash › an empty instruction, a non-string instruction and a nested object all answer 400
- HTTP edge › malformed requests are refused, never crash › unknown routes are 404 and wrong methods are 405, without a stack trace
- HTTP edge › malformed requests are refused, never crash › odd ids in the path are 404, never 500
- HTTP edge › malformed requests are refused, never crash › an unknown answer to an ask is 400 and changes nothing
- HTTP edge › malformed requests are refused, never crash › a feed filter with hostile characters answers 200 and an empty list
- HTTP edge › the app secret under every wrong shape › no header is refused with 401
- HTTP edge › the app secret under every wrong shape › empty bearer is refused with 401
- HTTP edge › the app secret under every wrong shape › lowercase scheme is refused with 401
- HTTP edge › the app secret under every wrong shape › basic scheme is refused with 401
- HTTP edge › the app secret under every wrong shape › prefix of the secret is refused with 401
- HTTP edge › the app secret under every wrong shape › secret plus one char is refused with 401
- HTTP edge › the app secret under every wrong shape › secret in a custom header is refused with 401
- HTTP edge › the app secret under every wrong shape › double space is refused with 401
- HTTP edge › the app secret under every wrong shape › two bearers is refused with 401
- HTTP edge › the app secret under every wrong shape › the secret in the query string does not count
- HTTP edge › the app secret under every wrong shape › the demo charge and the run control are not guarded by the app secret, and say so in code
- HTTP edge › no secret ever appears in a response › error bodies and the leash view never contain the app secret or the team key
- HTTP edge › no secret ever appears in a response › shop text comes back as JSON text, never as HTML
- HTTP edge › the leash cannot be loosened through the API › a higher or equal order limit is refused as not tighter; the limit stays
- HTTP edge › the leash cannot be loosened through the API › a zero, negative, NaN, string or object limit is refused
- HTTP edge › the leash cannot be loosened through the API › an unknown tighten type is refused
- token vault against odd amounts › a negative, zero, NaN or infinite amount never charges
- token vault against odd amounts › a charge one rappen above the maximum is refused; the maximum itself goes through
- token vault against odd amounts › the maximum never exceeds the per-order limit, whatever the tolerance
- token vault against odd amounts › a second charge, another shop, an expired token and a revoked token are all refused
- token vault against odd amounts › refunds cannot exceed what was charged, or be negative
- token vault against odd amounts › one decision gets one token, however often it is asked for
- token vault against odd amounts › charging an unknown token id is refused, and a guessed id is not a valid one
- token history is a hash chain › every event carries the previous hash; the chain verifies after a full life
- token history is a hash chain › changing one detail, removing a line or swapping two lines breaks the chain at that point
- token history is a hash chain › the original is untouched by the copies, and an unknown id verifies as nothing

### packages/backend/test/security.test.ts (6)

- answering an ask › a double tap sends one answer to Viseca, not two
- answering an ask › approvals racing each other can't spend more than the budget
- answering an ask › over budget is the customer's call: the warning names the overshoot, approving again buys it
- only the app can answer › refuses writes without the app's secret, or with a wrong one
- only the app can answer › an approve needs Face ID; a decline never does
- only the app can answer › lets the app in, keeps reads open, and allows only the app's origin

### packages/backend/test/tokens.test.ts (11)

- decision-bound tokens › 1) pays once at the approved shop, then refuses a replay
- decision-bound tokens › 2) refuses more than approved (the 'pre-authorised CHF 900' shop)
- decision-bound tokens › 3) refuses another shop
- decision-bound tokens › 4) refuses after expiry
- decision-bound tokens › 5) refunds after the token is used up, never more than was charged
- decision-bound tokens › the tolerance never goes above the customer's per-order limit (AU0004: CHF 126 vs CHF 120)
- decision-bound tokens › nor above what's left of the budget
- decision-bound tokens › a purchase the customer approved above the limit can still be paid exactly
- decision-bound tokens › one token per decision, and IDs are clearly not card numbers
- decision-bound tokens › revoking kills every unused token, except one kept on purpose
- decision-bound tokens › every attempt lands in the token's history

### packages/backend/test/valid-until.test.ts (4)

- the end of a leash › is read from the instruction as a rule with the customer's words, and no sentence is lost
- the end of a leash › declines every purchase after the end, in simulated time, and nothing before it
- the end of a leash › the app's date wins over the instruction, and null means no end
- the end of a leash › can be moved earlier in place; later is a loosening and is refused

### packages/backend/test/voice-agent.test.ts (5)

- voice agent definition › declares every tool the app registers, once, with a valid object schema
- voice agent definition › the answer tool only accepts approve or decline and waits for the app's result
- voice agent definition › setup goes analysis, then the cardholder's numbers, then the card; nothing is created without a yes
- voice agent definition › the prompt keeps the model out of the decision and out of the shop's orders
- voice agent definition › the first message is the app's own sentence, and the agent needs no secret

### packages/backend/test/worker.test.ts (16)

- data pack and events › builds AU0001 like the connection-check fixture, and it passes the event check
- data pack and events › rounds half-even and converts with the row's currency
- data pack and events › compiles the per-order limit into the mandate
- worker against the offline platform › SCEN0000 end to end with the stub engine: one step_up, posted in time
- worker against the offline platform › SCEN0001: all 10 purchases decided, approved spend flows into the next event's context
- worker against the offline platform › a redelivered purchase is answered once and counted once
- worker against the offline platform › an answered purchase delivered again backs off 2 s, 5 s, then 15 s, and is not answered twice
- worker against the offline platform › the backoff never sleeps past the end of the customer's answer window
- worker against the offline platform › engine error → step_up, never approve
- worker against the offline platform › slow engine → step_up before the deadline
- worker against the offline platform › a failed post is retried once
- customer answers (S6) › approve after step_up goes through /resolve and counts as approved spend
- customer answers (S6) › an unanswered ask expires and emits ask_expired
- mandate rules on the offline platform › allows adding rules and ask → decline, refuses removing rules and loosening
- mandate rules on the offline platform › a PATCH does not change a running run's snapshot, but the worker sees the current mandate
- mandate rules on the offline platform › a revoked mandate cannot start a run

### tests/engine.test.ts (11)

- compiler › reads per-order and rolling 7-day limits
- compiler › reads 'up to CHF 250 per order'
- boundaries › exactly at the limit approves
- boundaries › up to 10 % over asks
- boundaries › more than 10 % over declines
- boundaries › FX uses the fixed rates
- state › same live ID twice -> same answer, counted once
- state › a pending step_up does not count as spend; approving it does
- fail closed › a guard that throws gives at least step_up
- replay against the oracle › all 45 public purchases match
- no hard-coding › engine and compiler code never mention scenario or purchase IDs (public or live)

### tests/patterns.test.ts (46)

- A1 amounts in any currency, period word before or after › converts EUR, GBP, USD and francs to CHF with the fixed rates
- A1 amounts in any currency, period word before or after › reads the period after or before the amount
- A2 per-unit limits › per night / per item / each, but 'purchases … each' stays per order
- A3 how often › counts per day, week and month
- A4 days › weekends, weekdays and single days
- A5 exclusions › maps negated terms to real categories and keywords
- A5 exclusions › a negated category is blocked, not allowed
- A6 categories › knows the new categories and their synonyms
- A7 requested item › need / want / looking for
- A8 returns › days, or returnable / refundable without days
- A9 known shops › already know / my usual / no new
- A10–A12 extras, session, doubt › nothing else / only that item
- A10–A12 extras, session, doubt › session wording
- A10–A12 extras, session, doubt › ask or decline when unsure
- B guards › per-unit limit compares each line's unit price
- B guards › order frequency uses the ledger and simulated time (one a day)
- B guards › allowed weekdays, in Swiss time
- B guards › blocked keywords in the item name and in clean shop text; a negated mention is not a hit
- B guards › refundable only: unknown asks, non-refundable declines, stated passes
- C card with little history › uses all the customer's cards and says so in the evidence
- C card with little history › no history at all: asks, never declines, even when the customer says decline when unsure
- C card with little history › session with no history at all only asks
- C card with little history › no history: a yes teaches the device and the country for the rest of the run
- C card with little history › with history: a yes on a new device does not vouch for the device, the history stays the baseline
- lookalike against every established shop at the issuer › a never-used shop named almost like an established one is a question, even for a customer with no history
- lookalike against every established shop at the issuer › a spelling twin of an established shop in another town is asked about, not stopped
- lookalike against every established shop at the issuer › with the learned rule, both questions become declines
- lookalike against every established shop at the issuer › two established shops with similar names are just two shops
- lookalike against every established shop at the issuer › another category or a clearly different name is not a lookalike
- issuer limits: the card's own per-purchase limit › above the account's per-transaction limit declines, even when the customer allows more
- issuer limits: the card's own per-purchase limit › exactly at the limit passes, and a card with no known limit is not checked
- a shop the customer approved in this run is a shop they use › first purchase asks (no history), the customer says yes, the second one at the same shop is approved
- a shop the customer approved in this run is a shop they use › a declined ask teaches nothing, and another shop is still asked about
- a shop the customer approved in this run is a shop they use › the same-run approval also clears the lookalike check for that shop
- session: 'stop and ask me' asks, 'pause anything' stops › the compiler reads the action from the customer's words
- session: 'stop and ask me' asks, 'pause anything' stops › three signals: asked under 'stop and ask me', declined under 'pause anything'
- lookalike: an identical normalised name is still a question for a customer without history › "Night Owl Kitchen" vs established "NightOwl Kitchen": asked about, never declined (the customer never bought at the original)
- lookalike: an identical normalised name is still a question for a customer without history › "PixelHarbour" vs established "PixelHarbor": a question, not a stop
- travel: destination, nights and dates › reads the city and the nights, from a count or from dates
- travel: destination, nights and dates › a hotel in another city is the wrong destination; local and English names are the same city
- travel: destination, nights and dates › per night = total / nights, with the 10 % band
- travel: destination, nights and dates › nights unknown: uncertain (asks); nights stated by the shop are used
- A9 when the leash ends: 'until Friday', 'bis 30.09.', 'for the next two weeks' › weekdays and durations count from today, Swiss time, end of day
- A9 when the leash ends: 'until Friday', 'bis 30.09.', 'for the next two weeks' › dates in words, numbers or ISO; a date without a year is the next one; winter time is winter time
- A9 when the leash ends: 'until Friday', 'bis 30.09.', 'for the next two weeks' › a budget period, a return term or 'until further notice' is not an end
- A9 when the leash ends: 'until Friday', 'bis 30.09.', 'for the next two weeks' › keeps the customer's words, with offsets

### tests/redteam.test.ts (13)

- red team: injected shop text is never approved › the clean baseline is approved (control)
- red team: injected shop text is never approved › English role marker
- red team: injected shop text is never approved › zero-width chars
- red team: injected shop text is never approved › German
- red team: injected shop text is never approved › French
- red team: injected shop text is never approved › fullwidth letters
- red team: injected shop text is never approved › urgency
- red team: injected shop text is never approved › polite override
- red team: injected shop text is never approved › a number inside an injected sentence never raises the limit
- red team: other attacks › new lookalike with swapped letters
- red team: other attacks › gift card disguised with a monitor-like description
- red team: other attacks › hidden subscription add-on
- red team: other attacks › same order again 90 minutes later
