# Live before and after: the leash learns, only tighter (25 Sep 2026, 00:10)

Seven scenarios re-run on Viseca's server with the merged engine (main a5fd9ad + 4f1cbf2, plus the parallel
session's uncommitted learned-rule edits, which do not change default behaviour). Every ask was answered yes
(`npm run scenario -- <SCEN> --live --answer approve`), so the second purchase at a shop the customer just
approved shows the learning. "Before" = all 22 earlier live runs of the same scenarios, where no ask was ever
answered. Reports: `reports/live-results.md` (these 7 runs), `reports/api-atlas.md` (git-ignored).

Run ids: run_21ac9042244ddbb2, run_8d29c214ed9035a1, run_05586d2ba5a0cd18, run_972116929ddc03e3, run_5cdd50ff11a9c9ac, run_e00562e629a84095, run_2afc912e23f7a241

## The number for the slide

| Same 7 scenarios | Purchases | Approved | Asked | Declined | Share asked | Asks answered | Deadline misses |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Before (22 runs, 24 Sep afternoon) | 150 | 8 | 96 | 46 | **64 %** | 0 of 96 | 0 |
| After (7 runs, 25 Sep 00:00) | 74 | 20 | 28 | 26 | **38 %** | 28 of 28 | 0 |

Round trip on the server, decision posted: p50 248 ms, p90 376 ms, max 502 ms, 74 of 74 inside the 8 s deadline.
Every run finished `completed` with 0 platform rejections.

## Per scenario

| Scenario | Before: asked / purchases | After: asked / purchases | What changed |
| --- | --- | --- | --- |
| SCEN0113 Night Owl Kitchen | 10 / 24 (42 %) | 3 / 12 (25 %) | First purchase at each of two shops asks; the next nine at Night Owl Kitchen are approved or declined on the limit alone |
| SCEN0135 Alpine Corner Store | 18 / 24 (75 %) | 2 / 12 (17 %) | One history ask, one budget-band ask; everything else decides on limit and budget |
| SCEN0122 | 20 / 26 (77 %) | 3 / 13 (23 %) | Three history asks, then approvals |
| SCEN0104 | 12 / 20 (60 %) | 4 / 10 (40 %) | |
| SCEN0117 | 12 / 26 (46 %) | 4 / 13 (31 %) | |
| SCEN0101 Rhine Fresh | 3 / 6 (50 %) | 1 / 2 (50 %) | Only two purchases; the second is over the limit |
| SCEN0106 electronics, "stop and ask me" | 21 / 24 (88 %) | 11 / 12 (92 %) | Not fixed by learning, see below |

## What still asks, and why

- **No shop history, first time at a shop: 10 of 28 asks.** By design. The customer says yes once per shop.
- **SCEN0106, 9 of 11 asks carry `missing_info` from the session guard.** The instruction says "if the session
  looks unusual ... stop and ask me", the card has no history at all, so the session guard cannot compare and
  returns UNCERTAIN, and "ask me when uncertain" turns that into an ask on every purchase. A same-run yes teaches
  familiarity and lookalike, but not the session guard. Product question for Ara and Gabriel: should an approved
  purchase also teach "this device and country are me" for the rest of the run? That would take this scenario
  from 92 % to roughly 25 %.
- **Budget band, split order, lookalike: 9 asks**, all with a reason the customer can act on.

## How it was produced

```
npm run scenario -- SCEN0113 --live --answer approve   # one scenario at a time: the team shares one decision queue
npm run api-atlas                                       # GET only, refreshes data/live/atlas
npm run live-results -- <run ids>                       # reports/live-results.md
```

The before/after counts come from the first `authorization.decision` event per purchase in the atlas copy (the
authorizations list only keeps the final status, where an expired ask shows as declined).
