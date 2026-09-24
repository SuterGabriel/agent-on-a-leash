# Learning: merging two branches, testing beyond the public set, and hardening the leash

Date: 24 September 2026, evening. Status: merged and built; live re-run still open.

## What happened

The engine branch (`feat/engine-integration`, five guards and general phrasings) and main (app API, tokens, shop
track record) had diverged for a day. We merged them, then wrote performance and security tests against synthetic
data, and used the open issues from the handoff notes as the work list for the evening.

## What we learned

### 1. Two branches that don't compete merge cleanly, as long as "no-history" has one owner

Only three files conflicted, and all three were "keep both". The one real overlap was how a card with no history is
treated: main returned `missing_info` as *unsure*, the engine branch returned `no_shop_history` as an *ask*. The engine
branch had the richer model (`habitsScope` card / customer / none), so it won, and the adapter maps `no_shop_history`
to an *unsure* check so the app still shows "we don't know" rather than "you failed a rule".

**Actionable:** when two people touch the same behaviour, decide who owns the concept before the merge, not the
file. The reason code is the contract between engine and app; a merge must not silently change it.

### 2. A test that a fact is missing is not a test that the rule holds

The no-history test on main asserted the old reason code and the old message. After the merge it failed for the right
reason: the behaviour changed on purpose. We updated the test, not the engine.

**Actionable:** a failing test after a merge is a question, not a defect. Read the commit that introduced it before
"fixing" either side.

### 3. Performance is not our risk, and now we can prove it

| What | Measured | Budget |
|---|---|---|
| One decision, 2,000 synthetic purchases | p99 0.7 ms, max 7 ms | 5 s |
| 50 KB of injected shop text | 1 ms | 500 ms |
| Baselines from 100,000 history rows | 0.4 s | 3 s |
| 200 parallel feed reads | 0.9 s total | 5 s |
| Worker end to end, 45 purchases | p99 2 ms, 0 missed | 8 s |

**Actionable:** stop optimising. Keep the suite as a regression guard (`performance.test.ts`); it fails long before a
live deadline would. Synthetic data comes from `test/helpers/synthetic.ts`, seeded, built from the real catalogues
and never from the 45 public purchases.

### 4. Security tests found two defects a checklist would not have

- The token vault accepted a negative, zero, NaN or infinite charge. The HTTP route guarded most of it; the vault did not.
  Now `invalid_amount`.
- Tightening the order limit coerced `[1]` and `true` to 1 via `Number()`. Harmless (it tightens), but sloppy.

Neither is on a generic web security list. Both came from asking "what does this function do with a value it was never
given on purpose".

**Actionable:** for every function that moves or limits money, write the odd-value test first: negative, zero, NaN,
Infinity, array, boolean, string. It takes ten minutes per function.

### 5. Some "security" cases are client artefacts

`fetch` trims header values, so "secret plus trailing space" arrives as the valid secret; a null byte is refused by
the client before the request leaves. A test that "fails" here is testing the browser.

**Actionable:** when an edge case cannot reach the server, drop it and say why in a comment, so nobody re-adds it.

### 6. The engine's open issues were all about *who gets to decide*, not about rules

- Issuer-wide lookalike declined "Night Owl Kitchen" because it resembled "NightOwl Kitchen" in another town. The
  customer never bought at the original, so the engine had no ground for a verdict. Now it asks.
- A shop the customer approved earlier in the same run was still "new" on the next purchase. The ledger already knew.
  Now familiarity and lookalike pass on a same-run approval.
- "Stop and ask me" was treated like "pause anything". The customer's own words say ask. Now the compiler reads the
  action from the sentence and carries it in the rule value (`ask` vs `required`).

**Actionable, and worth saying to the jury:** the engine never turns missing information into a verdict. When it
cannot know, it asks; when the customer answers, it remembers for the rest of the run. Three fixes, one principle.

### 7. A file beats a database for a one-customer demo

A JSON snapshot (`persist.ts`) keeps the leash, feed, open asks and tokens across a restart. Atomic write, debounced,
mode-checked, tamper-checked. It took under an hour. Supabase would have taken the evening and shown nothing on stage.

**Actionable:** Supabase stays post-hackathon. The seam is `DecisionStore` plus `snapshot()` / `restore()`; whoever
builds it implements those two, nothing else changes.

### 8. A hash chain is cheap and answers a predictable question

Every token event carries the previous hash. `GET /app/tokens/:id/verify` says whether the history holds and where it
breaks. A tampered snapshot drops the token on restore. About 40 lines, three tests.

**Actionable:** when the jury asks "can the log be edited", the answer is a URL, not a promise. The same pattern fits
the decision feed after the hackathon.

### 9. Concurrent sessions on one working tree need a rule

While this work was in progress, another session added the v4 app layer to `service.ts`, `server.ts`, `api.ts` and
`shared/leash.ts`. Nothing broke, but only because both sides made additive edits and re-read before writing. The
strict typecheck currently fails on a file from the other side (`app-v4.test.ts` is not in the tsconfig exclude yet).

**Actionable:** one person per file at a time, or separate branches. And whoever adds a test that imports the engine
adds it to `tsconfig.json` `exclude` in the same commit; the handoff notes already say so.

## Still open

- **Live re-run of the 10 scenarios** after the three engine fixes, then regenerate the results table. Needs the
  team key and an agreement that nobody else is polling at the same time (the decision queue is shared).
- `app-v4.test.ts` in the strict tsconfig exclude.
- Commit: the merge is committed (`61b6897`); everything from this note is still in the working tree, together with
  the compiler work and the v4 app files from the other session. Split into at least two commits: engine fixes and
  tests, then persistence and token chain.
