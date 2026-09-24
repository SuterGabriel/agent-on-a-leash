# Merging Ara's engine branch into main (24 Sep 2026, late evening)

For Ara, first thing tomorrow. Gabriel's session merged `feat/engine-integration` (3db9066 + your merge
commit 02fc6d2) into main as a5fd9ad. Two of the conflicts were product decisions, not line overlaps.
They were decided in main's favour because main's commits were later and documented. Both are easy to
flip if you disagree.

## 1. Lookalike: a twin of another customer's shop is asked about, never declined

Your commit said: an identical normalised name ("Night Owl Kitchen" / "NightOwl Kitchen") is the same
brand and passes; only 0.85 <= similarity < 1.0 is an imitation, and it declines.

Main's commit 39f65dd (21:16) said: a never-used shop that resembles an established shop of OTHER
customers is a question, not a verdict. The customer never bought at the original, so it may well be
their usual service. Against the customer's OWN shops it still declines.

Kept: main's rule. Removed from `packages/engine/src/guards/lookalike.ts`: the `norm(name) === norm(other.name)`
early return in `closest()`. Your two tests in `tests/patterns.test.ts` now expect `step_up` with
`lookalike_shop` for both Night Owl Kitchen and PixelHarbour.

To flip: put the early return back and change the two expectations. Main's "Moon lit Noodle Bar" test
in the same file then fails and has to go.

## 2. Backend compiler: main's Builder stays

Your merge commit rewrote `packages/backend/src/compiler/compile.ts` to delegate to `shared/src/compiler.ts`
("one reading"). Main's version (26e5f1b, 6a7b1cf, valid-until) is a separate Builder with German and
reworded patterns and the tests in `paraphrases.test.ts` depend on it. Kept: main's.

Your work in `shared/src/compiler.ts` survived: `sources` spans, `QUESTION_IDS`, `questions`, `oneItem`,
`forDelivery`, and the travel block (`stayFrom`). It sits next to main's `sessionAction`.

Added afterwards so the app still shows a stay: `compile.ts` calls `compilePolicy()` for destination and
nights only, and writes `Stay in Lyon` / `3 nights` chips with hard rules `order.destination_city =` and
`order.nights =`. `tighten()` in `leashEngine.ts` applies both, and a confirmed rule replaces the text guess.
`RULE_FIELDS` has the two names.

## Also
- Duplicate object keys the auto-merge produced (`service.ts` per_unit_limit, `ruleFields.ts` unit_limit) were removed.
- `learned-shop-text.test.ts` imports the engine, so it is checked under `tsconfig.engine.json` like the other engine tests.
- After the merge: typecheck clean, 258 tests pass. `npm run live-review` was not run (no `data/live/atlas` in the repo).

## Live re-run after the merge (23:40, `npm run api-atlas` + `npm run live-review`)

236 saved live purchases from 22 runs, re-decided offline with the merged engine. 11 change (13 rows, two are
redeliveries), all in the expected direction:

- SCEN0113 Night Owl Kitchen (8) and SCEN0106 PixelHarbour (1): live we declined, now we ask. That is the
  lookalike decision above; `no_shop_history` asks anyway, so under your rule these would also be asks, only
  without the `lookalike_shop` reason. Nothing in the atlas carries Relay's expected verdict, so the data does
  not settle the question either way.
- SCEN0124 "hotel in Munich for 3 nights, at most CHF 200 per night": IsarNest Hotel CHF 687.76 was approved live
  and now declines (229 per night, above the 10 % band), SummitStay in Lucerne was approved live and now declines
  (`wrong_destination`). Both are your travel guard working; both look right against the instruction.

The other 225 decide as they did live. The report header in `liveReview.ts` still says "identical name = same
brand"; adjust it if the lookalike decision stands. The report is written in Spanish (`reports/live-review.md`,
git-ignored).
