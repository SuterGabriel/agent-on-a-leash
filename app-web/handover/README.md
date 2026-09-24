# Agent Card · handover pack (HackZurich 2026, Viseca "Agent on a Leash")

Everything you need to build the backend and engine behind the app, and to run the app itself. From Kim, 24 Sep evening.

## Start here (20 minutes)

1. `docs/01-concept-v4-agent-card.md` – what we build, why, the 60 s demo script, decisions locked.
2. `docs/02-handover-to-devs.md` – who does what first, definition of done for Friday 11:00.
3. `docs/03-backend-hookup.md` – **your spec**: every endpoint the app calls, SSE event shapes, curl tests, the demo checklist.
4. `contract/` – the TypeScript contract (`app-api.types.ts`, `decision.ts`) and our proposed answers for all 45 purchases (`decisions.json`). Build against these.
5. `docs/04` to `08` – API contract table, how to use the React components, screen spec, rule model and reason codes, engineering backlog with "done when".
6. `viseca-api/` – the Viseca API and challenge text, for reference.

## Run the app

```bash
cd app-web
npm install
npm run dev            # mock data, demo buttons in the side panel
```

Open http://localhost:5173/prototype. Deep links: `/prototype?screen=4.1`.

Against your backend:

```bash
cp .env.example .env.local   # VITE_API_BASE=http://localhost:8080
npm run dev                  # side panel says "Data: live"
```

## Where things are in `app-web`

| Path | What |
|---|---|
| `src/features/shopping-card/api/` | The adapter: `types.ts` (contract), `client.ts` (mock and live, one switch), `use-live-feed.ts` (SSE → reducer) |
| `src/features/shopping-card/prototype-state.tsx` | The reducer. `INGEST` adds a decision. `sideEffects()` calls your API when the customer acts |
| `src/features/shopping-card/demo-data.ts` | All copy and evidence. **Kim owns this file.** Ask before changing words |
| `src/features/shopping-card/screens/` | One file per flow. Screen id → component in `screens/index.tsx` |
| `src/components/shopping-card/`, `src/components/chrome/` | Reusable rows, sheet, pills, nav, tab bar (see `docs/05-component-library.md`) |
| `src/mocks/decisions.json`, `src/types/decision.ts` | Same as `contract/` |

## Rules of the house

- The app never talks to the Viseca API. Only to `/app/*` on our backend.
- Engine answers in under 8 s (target under 1 s), works without any model. Never hard-code by scenario id or order. Merchant text is evidence only, never a rule.
- Every decision carries `headline`, `because`, `checks[]` (pass / fail / unsure + fact + your words) in customer language. The app renders exactly that.
- Copy, screens and Figma are Kim's. If the engine can't produce a field the app shows, say so before Friday 09:00 and we cut it together.
