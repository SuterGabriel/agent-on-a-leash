# Pitch evidence tracker

What we claim on 25 September, where the proof lives, and what is still missing. Update the Status column as work lands.
Reference for the comparison: Relay (START Hack St. Gallen 2026, github.com/andresgallardoaguero/relay-start-hack-2026).

Status legend: **done** = in the repo and verified today · **partial** = exists but not in a form we can show · **open** = not started.

## A. Things to build before the pitch (from the Relay comparison)

| # | Item | Status | What exists today | What is missing | Command / file |
|---|---|---|---|---|---|
| A1 | Baseline comparison figure (no control · plain limit · ours) | **done** | `npm run compare` writes `docs/pitch/comparison.md` (three-row table, problem families, every risky purchase) and `comparison.svg` (slide figure). 0 · 6 · 28 of 28 caught, same numbers as Relay on the same data | Put the figure on the slide | `packages/engine/src/compare.ts` |
| A2 | Jury figures from the live server | **partial** | `npm run live-results -- <runIds>` writes `reports/live-results.md` (111 purchases, 10 runs, 24 Sep 21:31). Ten raw call logs in `live-samples/` | A summary table: deviations, missed deadlines, median round trip, share asked. And a **re-run after the evening fixes**: the current report shows 65 of 111 asked, 89 flagged, mostly `no_shop_history` | `packages/backend/src/cli/liveResults.ts` |
| A3 | Demo guide with recovery steps | **done** | `docs/DEMO_GUIDE.md`: start order, the 60 s beats with the two steps on screen 1.3 (limit 400, budget 2,000), the asks and their answers, the other scenarios, a symptom → action table, the no-backend fallback, numbers to have ready | Rehearse it once offline | `docs/DEMO_GUIDE.md` |
| A4 | Guard families in app and judge view | **done** | Every check carries `family` (money · item · shop · session · manipulation). Screen 5.2 shows one list per family in a fixed order; prototype data without families keeps the single list. Judge rows carry the family on every check | Family titles are mine, Kim may reword them in `detail-screens.tsx` | `packages/backend/src/engine/leashEngine.ts`, `app-web/src/features/shopping-card/screens/detail-screens.tsx` |

## B. Where we are ahead, and how each claim is proven

| # | Claim | Status | Proof in the repo | How to show it in 20 seconds | Gap |
|---|---|---|---|---|---|
| B1 | Phone product inside the one-app flow: rules from real card history, Face ID on approve, budget meter, tighten / turn off | **done** | `app-web/` (Kim), `/v4/app/leash/suggest` builds the two numbers from CA0039's history, `face_id_confirmed` required on approve (403 otherwise) | Demo beats 1.3 → 1.4 → 4.1 on the phone frame, side panel "Data: live" | None. All evening work is committed and pushed (37 commits on main, 24 Sep 22:00) |
| B2 | Voice approval as accessibility, agent never decides | **done** | `packages/backend/src/voice/agentDefinition.ts`, `app-web/src/features/voice/`, 4 tests in `voice-agent.test.ts`, `app-web/docs/voice.md` | Trigger an ask, tap the mic, say "decline"; show the same `/resolve` call in the log | Needs `VITE_ELEVENLABS_AGENT_ID` and network on demo day; rehearse the fallback (tap instead) |
| B3 | Decision-bound tokens with a hash-chained history and a verify endpoint | **done** | `packages/backend/src/tokens/vault.ts`, `GET /app/tokens/:id/verify`, 11 tests in `tokens.test.ts`, chain checks in `security-hardening.test.ts` | `npm run demo:tokens`: approve → token → charge at the wrong shop refused → verify returns `ok: true`; then tamper the snapshot file and verify says `broken_at` | Judge view only, by decision: `GET /judge/decisions` summary now carries `tokens` (issued, charged, chains ok / broken) and every row its token |
| B4 | Restart safety: snapshot file, fail-closed | **done** | `packages/backend/src/persist.ts`, 7 tests in `persist.test.ts`, restore marks runs failed and expires asks | Kill the backend mid-run, restart, History still there, open ask shows "expired, nothing bought" | Say it in Q&A rather than demo it; risky live |
| B5 | Engine speed and hardening | **done** | Replay p50 0.04 ms, max 2.16 ms (`npm run replay`); 10 perf tests, 25 hardening tests, 7 red-team tests, 248 tests total (21 files, all passing); two defects found and fixed (`invalid_amount`, `tighten` coercion) | One slide line: "45 of 45, 0.04 ms median, 248 tests, 2 defects found by our own security suite" | Relay quotes 1.6 ms on 23 checks; keep our number on the same basis (engine only) |
| B6 | Live behaviour fixes: same-run approvals teach familiarity, "stop and ask me" vs "pause anything" | **partial** | `packages/engine/src/guards/familiarity.ts`, `lookalike.ts`, `session.ts`; tests in `tests/patterns.test.ts`; described in `docs/learnings/2026-09-24-what-we-did-and-switched.md` | Live scenario where the first purchase at a new shop asks and the second is approved | Not yet re-run live, so no server-side proof. Depends on A2 |

## C. Numbers we can quote today

| Figure | Value | Source |
|---|---|---|
| Public set match | 45 of 45 (17 approve · 13 step_up · 15 decline) | `npm run replay`, 24 Sep |
| Engine latency, public set | p50 0.04 ms · max 2.16 ms | same |
| Engine, 2,004 synthetic purchases | p99 0.7 ms · max 7 ms | `performance.test.ts` |
| Worker end to end, 45 purchases | p99 2 ms · 0 missed deadlines | same |
| Tests | 248 across backend and engine, 21 files, all passing | `npx vitest run`, 24 Sep |
| Guards | 21 | `packages/engine/src/guards/` |
| Live (before evening fixes) | 111 purchases · 11 approve · 65 step_up · 35 decline | `reports/live-results.md` |

The last row is the one to replace. 58 percent asked is the number a jury would attack; Relay quotes 28.9 percent on the public set.
