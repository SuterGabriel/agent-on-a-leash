# Handover to Dev 1 (engine) and Dev 2 (backend) · 24 Sep evening

The app is done for the demo and runs on mock data. Your job is to make the same screens run on real decisions. Nothing in the UI needs to change for that.

## Read in this order (20 minutes)

1. `06_product/09-concept-v4-agent-card.md` – what we are building and why, the 60 s demo script. Read "Architecture in one picture" and "Decisions locked".
2. `app/web/docs/backend-hookup.md` – every endpoint the app calls, the SSE event shapes, curl tests, the 11-point demo checklist. **This is your spec.**
3. `app/web/src/features/shopping-card/api/types.ts` – the TypeScript contract. Change it here first if you need to change the API, then tell Kim.
4. `app/web/src/mocks/decisions.json` – our proposed answer for all 45 purchases in the exact `Decision` shape. Use it as the engine's expected table.
5. `01_challenge/viseca-2026/technical_details.md` – the Viseca API (mandates, decision requests, resolve, runs).

## Who does what first

| Dev 1 · engine | Dev 2 · backend |
|---|---|
| Worker loop on `/v1/decision-requests/next`, decision before `deadline_at` | `GET /app/feed`, `GET /app/stream` (SSE) with the `Decision` shape, even if the decisions are still the mock ones |
| Generic `hard_rules` evaluator + history signals (known shop, lookalike, duplicate, burst) | `POST /app/leash` → Viseca draft + confirm, store `mandate_id` |
| **Output `checks[]`** per rule with `result`, `fact`, `your_words`, plus `headline` and `because` in customer words. The app renders exactly this | `POST /app/asks/:id/resolve` → Viseca `/resolve`; `PATCH /app/leash/rules` (stricter = PATCH, looser = new mandate + delete old); `DELETE /app/leash` |
| Diff your output against `decisions.json` for all 45 (P0 test) | `GET /judge/decisions?run_id=` for the laptop view |

Shared: the reason codes and the learned-rule map in `06_product/04-rules-settings-why.md` §4. Engine and app use the same words.

## How to run the app against your backend

```bash
cd app/web
npm install
echo "VITE_API_BASE=http://localhost:8080" > .env.local
npm run dev
```

Open `http://localhost:5173/prototype`. The side panel says "Data: live". Without `.env.local` it says "mock" and the demo buttons appear; the buttons dispatch the same `INGEST` action your stream will.

## Definition of done for the hookup (Friday 11:00)

Run the checklist in `backend-hookup.md` §7 with Kim next to you. The five that matter on stage: quiet approval appears as a row with no banner · lookalike decline pushes and opens 5.2 with the failing rule first · ask opens the sheet with `because`, checks and shop text · Decline sends `/resolve` and the learned-rule offer appears · Turn off sends `DELETE` and the card tab shows the banner again. Then record the full demo as the backup.

## Access

The app is in `app-web/` in this pack. If you only build the backend, `contract/` and `docs/03-backend-hookup.md` are enough.

## Ask Kim, don't guess

Copy, screen structure, what a check should say. Kim owns `demo-data.ts`, Figma and the concept doc. If the engine can't produce a field the app shows, say so before Friday 09:00 and we cut the field together.
