# Agent on a Leash: everything the pitch needs, in one place

Swiss {ai} Weeks Zurich 2026, Viseca challenge. Submission 25 September 12:00, expert jury 14:00 (1 minute pitch, 3 minutes questions), main jury 18:00. Every number below was measured on 24/25 September and has a command next to it, so anyone can re-run it in front of the jury.

## 1. What we built, in three sentences

Viseca gives your AI shopping agent its own card. The card carries your rules, not your money: you set them in the Viseca app from what you already buy, and every payment the agent tries is checked by a rules engine that answers approve, decline or ask within milliseconds, and explains itself in your words. When the engine asks, you answer on the phone with Face ID, or by voice, and your answer can become a rule.

## 2. The numbers

| Claim | Number | Re-run with |
|---|---|---|
| Viseca's public set | 45 of 45 decisions match the reference (17 approve, 13 ask, 15 decline) | `npm run replay` |
| Against a plain spending limit | A limit catches 6 of the 28 risky purchases; we catch 28 of 28; CHF 5,899 kept from going through unchecked; 17 of 17 ordinary purchases untouched | `npm run compare` → `docs/pitch/comparison.svg` |
| Live on Viseca's server, asks answered yes | 7 scenarios, 74 purchases, 38 % asked, 0 missed deadlines, 268 ms median including network, slowest 432 ms | `docs/pitch/live-figures-asks-approved.md` |
| Live, asks answered no | 10 scenarios, 111 purchases, 59 % asked, 0 missed deadlines, 327 ms median | `docs/pitch/live-figures-asks-declined.md` |
| Engine speed | 0.04 ms median per decision on the public set; p99 0.7 ms and worst case 7 ms over 2,000 synthetic purchases; deadline is 8,000 ms | `npm run replay`, `performance.test.ts` |
| Guards | 21, in five families: money, item, shop, session, manipulation | `packages/engine/src/guards/` |
| Tests | 262, all green, in 22 files | `npm test` |
| Learned rules | Two enforced today: "always decline when a shop's text gives orders", "block shops that look like my known shops" | `learned-shop-text.test.ts` |

The 38 percent versus 59 percent is the shop learning: the live cards have no purchase history, so the first purchase at a shop asks once. With a yes, the shop is known for the rest of the run. Relay quotes 29 percent on the public set, where every card has history, so the figures are not comparable.

## 3. Speed, and how to show it

Three layers, each measured separately:

| Layer | Measured | Budget | Where |
|---|---|---|---|
| Engine alone, one decision | 0.04 ms median, 2 ms max on the public set | 8 s | `npm run replay`, last line |
| Engine under load | 2,000 synthetic purchases p99 0.7 ms; 500 purchases in one ledger with no slowdown; 50 KB of injected shop text in 1 ms | 5 s / 500 ms | `packages/backend/test/performance.test.ts` |
| Whole path on Viseca's server | 268 ms median from their request event to our decision event, network both ways; 0 of 185 purchases after the deadline across both passes | 8 s | `npm run jury-figures` |

The gap between 0.04 ms and 268 ms is the network to Azure and back. If a jury member asks why not faster: the platform long-polls, and every decision is posted synchronously so the platform has it before we move on.

To show it live: `npm run replay` prints the 45 purchases and the timing line in about two seconds. The judge endpoint `GET /judge/decisions` shows the latency of every decision of the last run.

## 4. Security tests, and how to show them

What is tested, by suite. Every test is a sentence a jury member can read.

**Red team, `tests/redteam.test.ts`.** Seven injection phrasings planted in shop text, each on a purchase that is otherwise approved: an English role marker, zero-width characters inside words, German, French, fullwidth Unicode letters, urgency pressure, a polite override. None is approved, every one is flagged and quoted to the customer. A number inside an injected sentence never raises the limit. Plus: a lookalike shop with swapped letters, a gift card disguised as a monitor, a hidden subscription add-on, the same order again 90 minutes later. None approved.

**Answering an ask, `security.test.ts`.** A double tap sends one answer to Viseca, not two. Two approvals racing each other cannot spend more than the budget. An approve needs Face ID, a decline never does. Only the app's secret can write; reads are open; only the app's origin is allowed.

**Hardening, `security-hardening.test.ts`, 25 tests.** Invalid JSON, arrays, bare strings and nested objects are 400, never 500. A body above 1 MB is 413. Unknown routes 404, wrong methods 405, no stack trace. The secret in the query string does not count. No error body ever contains the app secret or the team key. Shop text comes back as JSON, never HTML. The leash cannot be loosened through the API: a higher limit is refused, zero, negative, NaN, string and object limits are refused. The token vault refuses negative, zero, NaN and infinite amounts, a charge one rappen above the maximum, a second charge, another shop, an expired token, a revoked token, a refund above the charge. One decision gets exactly one token. The token history is a hash chain: change one detail, remove a line or swap two lines and verification names the broken point.

**Two real defects these suites found and fixed** on 24 September: the token vault accepted negative and NaN amounts; the tighten endpoint coerced arrays and booleans to a limit of 1.

To show it live: 53 tests, two seconds.

```bash
npx vitest run tests/redteam.test.ts packages/backend/test/security-hardening.test.ts packages/backend/test/security.test.ts
```

## 4a. What the tests test with: Viseca's data or ours

Both, and it is deliberate which one where.

| Data | Where it comes from | Used for |
|---|---|---|
| Viseca's public set | 45 purchases in 5 scenarios, their merchants, items, cards, and 4,701 rows of purchase history, copied unchanged from the challenge repo into `data/` | The replay, the comparison figure, the red team (every attack starts from a real approved purchase and changes one thing), most guard tests |
| Viseca's reference decisions | `data/reference_decisions.csv`, the expected answer per public purchase | Scoring only. The engine never reads it; a test fails if the engine or compiler mentions any scenario or purchase id |
| Viseca's live scenarios | 10 scenarios, 111 purchases, other cards and shops, served by their Azure platform | The live figures in `docs/pitch/` |
| Synthetic purchases | A seeded generator (`packages/backend/test/helpers/synthetic.ts`) that builds purchases and history rows from Viseca's real catalogues; same seed, same data | Performance and hardening: 2,000 purchases, 100,000 history rows, 50 KB of shop text, a 200 KB instruction. The public set is far too small to measure load |
| Hand-written edge cases | In the test files themselves | Guards and compiler: a lookalike name with swapped letters, a card with no history, thin history falling back to the customer's other cards, unusual instruction wording, session signals |
| Our own API traffic | Our app secret, our requests, against an in-process copy of Viseca's platform | The security suites, which test our HTTP surface and the token vault, not the engine |

If asked: the public set proves correctness against the reference; the synthetic and hand-written data prove the engine holds up beyond what the reference covers; the live runs prove it on the platform the jury sees.

## 5. Which model, honestly

**No model decides. No model runs in the decision path today.**

- The rules engine is deterministic TypeScript. The instruction is read by a pattern compiler, shop text is scanned by patterns with Unicode normalisation, and every guard is plain code. The judge view says `model: off` for every decision.
- Two research passes on 24 September selected small local models for optional help: Qwen3.5-4B for reading unusual instruction wording, Qwen3.5-2B for extracting facts from shop text, and Horizon-Labs prompt-injection-guard-small as an injection classifier, with Gemma 4 fallbacks. The design: the model may only propose facts, the validator checks them, the rules decide, and on any timeout the engine falls back to patterns. The decision is in `docs/research/MODEL_DECISION.md`. **These models are not wired in.** The pattern path alone reaches 45 of 45, so the model path was deprioritised.
- The only model in the product is the voice channel: an ElevenLabs conversational agent, gpt-4o-mini as its language model and eleven_flash_v2 for speech. It reads aloud the question the engine composed and passes the spoken yes or no to the same resolve endpoint the screen uses. It never decides, and silence or an unclear answer never becomes an approval.

If asked "why no AI in the engine": a bank cannot explain a probability to a customer or a regulator. Every decision here is a list of checks with the fact that failed. The AI is at the edges, reading language, and it can be switched off without changing a single decision.

## 6. What a jury member can see in the first five seconds

- The phone: a rule failed, in the customer's own words, with the fact next to it. Five families, so the shape of the problem is visible before reading.
- The shop text that tried to talk to the agent, quoted in a grey box, with "we ignored this".
- The learned rule, offered after a decline, visible under Rules → Learned.
- The judge view: every decision of the run with reasons, checks, latency, deadline margin, and the token it issued.

## 7. Where we are ahead of the START Hack winner on the same challenge

Relay (St. Gallen, same data): a desktop dashboard, a 0 to 100 trust score, deterministic guards, 45 of 45 on the public set. Same engine result as ours. What they do not have: a phone product inside the banking app with rules proposed from real history and Face ID; a voice channel; decision-bound payment tokens with a verifiable history; restart safety with a state file; learned rules that are enforced; and a security suite that found real defects. What they did better: a quantified pitch, which we now have too (section 2).

## 8. The questions to expect, and the short answers

| Question | Answer |
|---|---|
| Why does it ask so often on the live scenarios? | The live cards have no purchase history. Every first purchase at a shop asks once; a yes makes the shop known. 38 percent with a yes, and the reason is on every card. |
| What if the agent is fooled after the approval? | It pays with a token bound to that decision: one shop, one maximum, fifteen minutes, one use. A charge anywhere else is refused. |
| What if your backend dies mid-run? | The state file restores the leash, the feed, open asks and tokens. Open asks whose window passed are expired: nothing is bought. |
| Is anything hard-coded to the scenarios? | No. A test fails if the engine or compiler mentions any scenario or purchase id. |
| Can the customer loosen the rules from the agent's side? | No. The API only tightens. Loosening is a new leash with Face ID. |
| Why no LLM in the engine? | See section 5. |
| What would you build next? | The optional model path for unusual instruction wording, a real token service behind the same interface, and the three learned rules the engine cannot read yet. |

## 9. Files behind every claim

| Topic | File |
|---|---|
| Demo script and recovery | `docs/DEMO_GUIDE.md` |
| Evidence tracker | `docs/PITCH_EVIDENCE.md` |
| Comparison with a plain limit | `docs/pitch/comparison.md`, `comparison.svg` |
| Live figures | `docs/pitch/live-figures-asks-approved.md`, `live-figures-asks-declined.md`, `docs/learnings/2026-09-25-live-before-after.md` |
| Model decision | `docs/research/MODEL_DECISION.md` |
| Product spec | `docs/PRODUCT_SPEC.md` |
| Voice | `app-web/docs/voice.md` |
| Security and performance learnings | `docs/learnings/2026-09-24-tests-merge-and-hardening.md`, `2026-09-24-security-review.md` |

## 10. Viseca's list, row by row: built or not, and where the pitch shows it

Checked against the code on 25 September. **Built** = in the repo and covered by a test or a live run. **Partial** = works, with a stated limit. **Not built** = say it plainly if asked.

| Part | Viseca asks | Status | Where it is | How the pitch shows it |
|---|---|---|---|---|
| Frontend | Customer input into clear, executable permissions | Built | Compiler reads the sentence into rules; every rule carries the words it came from (`your_words`) and shows them on the rule row; rules are grouped on screen 6.1, checks in five families on 5.2 | 0:00 to 0:10, screen 1.3: rules proposed from history, each with its evidence line |
| Frontend | Spending limits | Built | Per-order limit and rolling budget; the app's budget meter shows "CHF x left" and `frees_up_at` | 0:25: the bar moves on the first quiet approval |
| Frontend | Merchant requirements | Partial | Any shop or known shops, shop types, blocked shops. Lookalikes of the customer's own shops are declined; a lookalike of another customer's shop is asked about, because the customer never bought at the original. Learned rule "block lookalikes" turns that into decline | 0:30: PixelHarbour declined, "Real shop, not a lookalike" failed |
| Frontend | Time windows | Partial | Rules valid until a date (`valid_until`, engine judges it in simulated time). A task does not end by itself after its purchase: an identical repeat is caught as a duplicate, a different second order of the same item is not stopped | Not in the 60 s; answer in Q&A if asked |
| Frontend | Rules for uncertain cases | Built | "Ask me" or "decline" from the sentence; every ask says why; 120 s window, nothing bought without an answer | 0:40: the ask sheet with the shop text quoted |
| Frontend | Tighten, update or revoke | Built | PATCH tightens instantly; loosening needs Face ID (403 without); DELETE turns the card off | 0:50: learned rule, then "Turn off Agent Card" |
| Backend | approve, decline, step_up for every purchase | Built | Worker long-polls, decides, posts; 0 of 185 live purchases after the deadline | Section 3 numbers on the slide |
| Backend | Explain in plain language, highlight uncertainty | Built | Headline, one "because" sentence with the numbers, checklist pass / fail / unsure with the fact, "what we don't know" list | 0:30: tap the declined purchase, checks per family |
| Backend | Customer's final approve or reject | Built | Ask sheet, 2:00 timer, Decline and Approve the same size, Face ID on approve, one answer to Viseca even on a double tap | 0:40 to 0:50 |
| Backend | Track state: rolling limits, retries, duplicates, earlier decisions | Built | Ledger per run: only approvals count, same live id counted once, same basket again is a duplicate, waiting asks do not count, budget frees as days roll; state file survives a restart | Q&A: "what if your backend dies" |
| Backend | Merchant text is untrusted | Built | Quarantine: facts extracted from clean sentences, orders to the agent flagged and quoted in the grey box, 7 injection phrasings in the red team | 0:40: the grey "From the shop page" box |
| Technical | Decouple UI from the engine | Built | App talks only to our backend under `/v4/app/*`; the engine is a pure package the worker calls; Viseca's API is behind one client interface with an offline copy | Architecture line in Q&A |
| Technical | Small, fast models; predictable if a model fails | Not built as described | Rules decide on their own, no model runs in the decision path. The fallback described in the table is the only path today. Models were researched and the seam exists (`docs/research/MODEL_DECISION.md`) | Say it as a strength, section 5 |
| Technical | No hard-coding to scenario, id or order | Built | A test fails if the engine or compiler mentions a scenario or purchase id; all 45 and all 111 live purchases run through the same engine | Section 8 answer |
| Demo | One ordinary purchase with little friction | Built | AU0035 PixelHarbor CHF 289: approved, quiet row | 0:25 |
| Demo | One unsafe or manipulated purchase with a useful intervention | Built | AU0039 lookalike declined with reason; AU0040 shop text asked, quoted | 0:30 and 0:40 |
| Demo | Human approval, rejection or revocation path | Built | Decline on the sheet, the learned-rule offer, turn off the card | 0:50 |
| Demo | Judges see what was permitted, evidence, why, how the customer kept control | Partial | Every decision carries the checklist with families; `GET /judge/decisions` returns every purchase with reasons, checks, latency, deadline margin and token summary. It is JSON, there is no judge web page | 0:58: the comparison figure on the laptop, the JSON if a judge wants to look |
| Surprise | A separate card for all online shopping | Built | The Agent Card in the app; on the backend every approval issues a decision-bound token: one shop, one maximum, fifteen minutes, one use, hash-chained history with a verify endpoint. The main card number is never handed out | 0:15: "Give this card to your agent"; Q&A: "what if the agent is fooled after the approval" |

Three things to say without being asked, because a jury member will otherwise find them: no model in the decision path (a strength, section 5); the judge view is an endpoint, not a page; a lookalike of a shop the customer never used is a question, not a block, by design.
