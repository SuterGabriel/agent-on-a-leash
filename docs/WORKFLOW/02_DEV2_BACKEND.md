# Dev 2 — Backend, Viseca API, worker, database

You own everything that talks to the outside: Viseca's API, Supabase, the app API and the worker loop that calls Dev 1's engine.

---

## Step 0 — Prove the key works (first 20 min, before anything else)

```bash
export LEASH_BASE_URL="https://saw26api.ashyground-364e1d07.switzerlandnorth.azurecontainerapps.io"
export TEAM_API_KEY="<from Slack, never committed>"
curl -s "$LEASH_BASE_URL/healthz"
curl -s -H "Authorization: Bearer $TEAM_API_KEY" "$LEASH_BASE_URL/v1/bootstrap"
```
If 401: try the key without the `team3:` prefix. Post the working format in Slack.
Save the bootstrap response: it holds deadlines (8 s) and the human window (120 s). Read them, do not hard-code.

## Step 1 — Viseca client (1 h)

`packages/backend/src/viseca/client.ts`: typed wrappers for every endpoint in `technical_details.md`:
bootstrap, reference-data, mandates (create, confirm, get, patch, delete), scenario-runs (start, get),
decision-requests/next, decision, resolve, authorizations, events, team/reset.
30 s timeout, JSON errors under `error`, check HTTP status first.

## Step 2 — Minimal worker, end to end (1 h) — the most important hour

`packages/backend/src/worker.ts`
```
loop while run has work:
  GET /v1/decision-requests/next?wait=25
  204 → check run progress, continue
  200 → validate data, look up live authorization_id
        seen before? → replay stored answer
        else decision = engine.decide(...)   // until Dev 1 is ready: always step_up
        POST /v1/authorizations/{id}/decision
        store row, notify app
```
Then: create mandate for SCEN0000 → confirm → start run → watch the worker answer.
**Milestone: SCEN0000 decided live by our worker.** Tell the team.

## Step 3 — Offline platform clone (1.5 h)

Same endpoints, served in-process from `data/` (the 45 purchases), so the app and demo work without the key or Wi-Fi.
`LEASH_MODE=offline|live` switches. Same worker, same engine, same screens in both modes.

## Step 4 — Database (Supabase, 45 min)

Tables: `mandates` (instruction, hard_rules, internal_policy, status), `runs`, `decisions` (PK = live authorization_id), `audit_events`.
Realtime on `decisions`. Service key only on the server. App uses anon key, read-only.
Writes never block a decision: decide first, write after.

## Step 5 — Policy compiler (2 h) — differentiator D2

`POST /api/policy/compile {instruction}` →
`{chips, hard_rules, internal_policy, assumptions, open_questions, warnings}`
- Regex compiler always runs (amounts, "per order", "any seven days", "including delivery", categories, size, return days, "shops I have used", "nothing extra", "ask/decline when uncertain").
- **Assumptions list**: every interpretation you made in plain words ("I read 'regularly' as: at least 1 approved purchase on this card").
- **Open questions**: known ambiguities (split orders, other card counts as known?, one item only?).
- Unknown instruction → never silent: return warnings + questions instead of a policy that declines everything.
- Optional model (P1): only after regex works; must agree on numbers or the chip is marked "please check".

## Step 6 — App API

| Method | Path |
|---|---|
| POST | `/api/policy/compile`, `/api/policy/confirm` |
| GET | `/api/mandates/current` (with budget status) |
| PATCH | `/api/mandates/:id/tighten` (add rules only, or uncertainty → decline) |
| DELETE | `/api/mandates/:id` (revoke) |
| POST | `/api/runs {scenario_id}` |
| GET | `/api/decisions?run_id=`, `/api/pending`, `/api/status` |
| POST | `/api/resolve/:authorization_id {decision}` |
| POST | `/api/suggestions/:id/accept` (D1: accepted proposal → PATCH) |

## Step 7 — Resilience checklist

- Decision post fails → retry once after 250 ms, then log `post_failed`.
- Engine throws or exceeds 5 s → post `step_up`.
- Duplicate delivery → stored answer.
- Human window expires → mark `expired`, send nothing.
- Revoke with pending step_up → do not fake a cancellation.

## Checkpoints

| When | You show |
|---|---|
| Thu 16:00 | bootstrap answers |
| Thu 17:30 | SCEN0000 live via our worker |
| Thu 21:00 | offline clone + resolve from app |
| Fri 01:00 | compiler with assumptions/questions, tighten, revoke |
| Fri 09:00 | clean reset, final live runs of all 5 scenarios |
