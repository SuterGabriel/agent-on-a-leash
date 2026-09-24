# agent-on-a-leash
Guardrails for AI shopping agents: every payment is checked against a user-approved mandate (budget, merchant, deadline). Deviations trigger a voice approval, prompt injections get blocked, every step is audit-logged. Built at Swiss {ai} Weeks Hackathon Zurich 2026 (Viseca challenge).

## App (frontend)

The customer's app is Kim's `app-web` (React 19, Vite, Untitled UI), copied as is from [agent-card-handover](https://github.com/kimbadertscher/agent-card-handover) into [`app-web/`](app-web/). The handover pack with the concept, the hookup spec and the contract is in [`app-web/handover/`](app-web/handover/).

The backend serves the app's contract under `/v4/app/*` ([`packages/backend/src/http/appV4.ts`](packages/backend/src/http/appV4.ts)); the older `/app/*` routes stay as they are.

```bash
npm run api                      # backend on http://localhost:8787 (offline data pack by default)
cd app-web && npm install
cp .env.example .env.local       # VITE_API_BASE=http://localhost:8787/v4
npm run dev                      # http://localhost:5173/prototype, side panel says "Data: live"
```

Demo flow on the phone: 1.1 → 1.3 rules from your shopping (`GET /v4/app/leash/suggest`, real numbers from the card's history) → 1.4 create the card (`POST /v4/app/leash`). Then, in the side panel, "Start run": the scenario's instruction becomes the agent's task on top of the card rules (`POST /v4/api/runs`), and every decision of the engine arrives on `/v4/app/stream` in the app's `Decision` shape. Asks are answered with `POST /v4/app/asks/:id/resolve`, "Yes, always" calls `POST /v4/app/suggestions/:id/accept`, tighten / loosen (Face ID) goes to `PATCH /v4/app/leash/rules`. Without `.env.local` the app runs on Kim's mock data. Tests: `packages/backend/test/app-v4.test.ts`.
