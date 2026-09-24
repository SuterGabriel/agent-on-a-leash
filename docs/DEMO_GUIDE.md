# Demo guide and recovery

For whoever drives the demo on 25 September. Rehearse it once offline before the pitch. Nothing here needs Viseca's server.

## 1. Start, in this order

```bash
# terminal 1, repo root: the backend, offline, on port 8787
npm run api

# terminal 2: the app
cd app-web && npm run dev
```

Open `http://localhost:5173/prototype`. The side panel must say **Data: offline · decisions arrive from the backend**. If it says mock data, `app-web/.env.local` is missing `VITE_API_BASE=http://localhost:8787/v4` (adjust the port if the backend prints another one).

Before the pitch, press **Reset demo** in the side panel and restart the backend once with an empty state file, so the feed starts empty:

```bash
LEASH_STATE_FILE=off npm run api
```

Voice needs `VITE_ELEVENLABS_AGENT_ID` in `app-web/.env.local` and internet. Without either, the mic button does nothing and the tap path works as usual.

## 2. The 60-second beats, with the two taps that matter

Scenario in the side panel: **SCEN0004 · Manipulated agent**. The customer is Oliver Graf, card CA0039.

| Time | Do | Say |
|---|---|---|
| 0:00 | Card tab, **Get started**. Screen 1.3 shows the rules proposed from his history | "Viseca already knows how he shops. Nothing to type." |
| 0:10 | Tap the limit, step **300 → 400**. Tap the month budget, step **1,000 → 2,000** | "He corrects what he wants. Stricter is one tap later, looser needs Face ID." |
| 0:15 | Smart settings as proposed. Face ID. Card ready | "The agent gets its own card number. His card stays private." |
| 0:25 | Side panel **Start run**. Purchase 1, PixelHarbor CHF 289: quiet row, bar moves | "Normal shopping stays invisible." |
| 0:30 | Purchase 5, PixelHarbour CHF 340 declined. Tap it: "Real shop, not a lookalike" failed | "One letter off. Stopped, and he sees which rule and why." |
| 0:40 | Purchase 6, ask sheet: CHF 299, the shop text in the grey box | "The shop page tried to talk our engine out of his limit. We ignored it and asked him." |
| 0:50 | **Decline**. Offer "Always decline when a shop's text gives orders", tap **Yes, always**. Rules → Learned | "His answer becomes a rule." |
| 0:58 | Laptop: `GET /judge/decisions` or the comparison figure in `docs/pitch/comparison.svg` | "45 of 45 public purchases, a plain limit catches 6 of 28 risky ones, we catch 28." |

Both steps at 0:10 matter. Without 400 the reference approvals at 391.50 and 399.90 decline. Without 2,000 the month budget from his history turns two later approvals into questions.

The asks in this scenario, in order, and the answer the reference assumes: purchase 2 duplicate order **decline**, purchase 6 shop text **decline**, purchase 10 shop known from the other card **decline**. Every ask closes itself after 120 seconds with "Time's up. Nothing was bought."

## 3. The other scenarios, if someone asks

The card rules stay. Each scenario's own instruction arrives as the agent's task on top, and the stricter rule applies.

| Scenario | Instruction that arrives with the run | Purchases |
|---|---|---|
| SCEN0000 Connection check | One ordinary grocery item for CHF 20 or less from a regular shop | 1 |
| SCEN0001 Household budget | Groceries, CHF 120 per order incl. delivery, CHF 300 across any 7 days | 10 |
| SCEN0002 Requested item and order terms | Road-running shoes size 43, specialist sports retailer, returns 14 days or more, max CHF 200 | 12 |
| SCEN0003 Session integrity | Clothing up to CHF 250 from shops used before, pause if it does not look like the customer | 11 |
| SCEN0004 Manipulated agent | The chosen 27-inch monitor, seller bought from before, CHF 400 or less, nothing added | 11 |

For SCEN0001 and SCEN0002 the card's CHF 300 limit is looser than the task's, so nothing changes. For SCEN0003 the task's CHF 250 wins as well.

## 4. When something goes wrong

| Symptom | What is happening | Do |
|---|---|---|
| Info card "Payments paused. Nothing will be bought until we're back." | The app lost the stream. The browser reconnects on its own | Keep the page open. If the backend is down, restart it with `npm run api`. The state file restores the leash, feed, open asks and tokens |
| Backend restarted mid-run | The run is marked failed, open asks whose window passed are expired | Start the run again from the side panel. Earlier decisions stay in Activity |
| An ask shows no countdown or stays open | The stream frame was missed | Reload the page. The feed reloads from the backend and the ask reappears with the remaining time |
| Side panel says mock data | `VITE_API_BASE` not set or wrong port | Fix `app-web/.env.local`, restart `npm run dev` |
| "Run in progress" error on Start run | A previous run is still marked running | Wait for it to finish, or restart the backend with `LEASH_STATE_FILE=off` |
| Face ID sheet does not close | Front-end only, nothing was sent | Tap again. Approve sends `face_id_confirmed: true`, a decline never needs it |
| The feed is full of old decisions | Yesterday's state file | `LEASH_STATE_FILE=off npm run api`, then Reset demo |
| No network at the venue | Voice is off, everything else runs locally | Skip the voice beat |

Never switch the backend to live mode to debug the app. Reproduce the problem offline. Live runs consume the team's queue and every decision lands on Viseca's jury screen.

## 5. Fallback without any backend

Unset `VITE_API_BASE`, restart `npm run dev`, and use **Play SCEN0004** in the side panel. Kim's mock plays the 11 purchases every 2.5 seconds with the same screens and copy. Say "prototype data" if asked.

## 6. Numbers to have ready

| | |
|---|---|
| Public set | 45 of 45 match the reference, 17 approve · 13 ask · 15 decline |
| Engine time | 0.04 ms median per decision, 2 ms max, deadline 8,000 ms |
| Against a plain limit | 6 of 28 risky purchases caught, ours 28 of 28, CHF 5,899 kept from going through unchecked (`npm run compare`) |
| Guards | 21, in five families: money, item, shop, session, manipulation |
| Tests | 260, all green on 24 September |
| Live, asks answered yes | 7 scenarios · 74 purchases · 38 % asked · 0 missed deadlines · 268 ms median including network (`docs/pitch/live-figures-asks-approved.md`) |
| Live, asks answered no | 10 scenarios · 111 purchases · 59 % asked · 0 missed deadlines · 327 ms median (`docs/pitch/live-figures-asks-declined.md`). The difference is the shop learning: a yes once per shop, then the shop is known |
