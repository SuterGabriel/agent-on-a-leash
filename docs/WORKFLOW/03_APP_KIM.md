# Kim — Design and mobile app

You own what the customer and the jury see. Frame it as a tab inside Viseca "one", not a new app.
Start with mock data; switch to the backend when Dev 2's API is up.

---

## Step 0 — Wireframes (until Thu 17:00)

Low-fi first, all five screens, then hi-fi only for ③ and the decision card.

| # | Screen | Must show |
|---|---|---|
| ① | Create leash | text box, 3 example prompts, card + agent, "Build my leash" |
| ② | Here's what I understood | quoted instruction, editable rule chips, **assumptions**, open questions, confirm |
| ③ | Confirmation sheet (3-D Secure look) | amount, shop + tag (new / looks like X / other card), items, why we ask, grey "From the shop — we ignored this", 120 s countdown, Approve / Decline equal size |
| ④ | Activity | rolling budget bar with "frees up" date, rows by status, tap → decision card |
| ⑤ | Leash detail | chips, tighten, **suggestions from the leash (D1)**, revoke |
| ⑥ | Jury view (web) | counters, latency, table, expandable evidence, model on/off |

Naming: tabs **Rules · Waiting for you · History**. Do not use "Approval inbox", "Decision log" or a trust score (Relay's).

## Step 1 — Setup

```bash
npm create vite@latest app -- --template react-ts
cd app && npm i && npm i -D tailwindcss @tailwindcss/vite
```
Mobile frame 390 px wide. One `mock/` folder with fixtures that match the backend response shapes in `02_DEV2_BACKEND.md`.

## Step 2 — Decision card (the heart of the UI)

Five parts: **Headline · Because · Evidence · Uncertainty · Action**.
Someone outside the team must understand why in 5 seconds.

## Step 3 — Differentiator screens

- **D1 Learning leash**: after a decline on ③, a card "Block add-ons from now on?" → one tap → toast "Applies to the next run". In ⑤, a small line: "Questions last run: 4 → this run: 1".
- **D2**: on ②, show the assumptions in plain words with an edit button each.
- **D3**: German copy option using Viseca's words: Limiten, Verwendungszwecke, Restriktionen, Transaktionsbestätigung.

## Step 4 — Connect to backend

Realtime subscription on `decisions`; step_up rows open ③ automatically with the countdown.
Keep a mock mode switch for the backup demo.

**What the backend expects from the app** (details: `02_DEV2_BACKEND.md`, App API security):
- Put `APP_SECRET` and `CORS_ORIGIN` (your dev server, e.g. `http://localhost:5173`) in `.env`, and give the app the same secret.
- Send `Authorization: Bearer <APP_SECRET>` on every POST, PATCH and DELETE. GETs and `/app/stream` need nothing.
- Answering an ask (`POST /app/asks/:id/resolve`) can return two new 409s:
  - `busy`: an answer is already on its way. Ignore it; the stream brings the result.
  - `over_budget`: show `error.message` ("This puts you CHF … over your 7-day budget") with a **Buy anyway** button that sends the same request with `over_budget_ok: true`.
- Shop text reaches the app inside messages (`because`, `evidence`). Render it as text, never with `dangerouslySetInnerHTML`.

## Checkpoints

| When | You show |
|---|---|
| Thu 17:00 | wireframes ①–⑥, hi-fi ③ |
| Thu 21:00 | React screens on mock data |
| Fri 01:00 | live rows, ③ approve/decline working |
| Fri 09:00 | D1 flow, jury view, backup recording |
