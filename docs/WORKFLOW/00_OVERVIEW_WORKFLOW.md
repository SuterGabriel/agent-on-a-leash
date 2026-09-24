# Agent on a Leash — Team overview and workflow

Swiss {ai} Weeks Zurich 2026 · Viseca challenge. Read this first, then your own file.

| File | Owner |
|---|---|
| `01_DEV1_ENGINE.md` | Dev 1 — decision engine (the "brain") |
| `02_DEV2_BACKEND.md` | Dev 2 — backend, Viseca API, database, worker |
| `03_APP_KIM.md` | Kim — design and mobile app |
| `04_GABRIEL_LEAD.md` | Gabriel — lead, pitch, expert questions, voice (P1) |

---

## 1. What we are building, in one picture

```
Customer ──instruction──▶ [App: create leash] ──▶ [Backend: compile + mandate] ──▶ Viseca API
                                                                                     │
Viseca simulator (the shopping agent) ── proposes purchase ──▶ [Worker] ──▶ [ENGINE] ─┘
                                                                  │  approve / decline / step_up
                                                                  ▼
                                                   [App: "Waiting for you" sheet] ──▶ resolve
```

- **The leash = rules + memory + explanation.** It is not a chatbot. The engine is deterministic.
- **The model is optional help**, never the decider: it may read the customer's instruction and extract facts from shop text. With the model off, every decision must be identical.
- **The data is fixed** (20 customers, 4,701 history rows, 45 purchases in 5 scenarios). What we design is how to read the instruction, the rules, the explanations and the customer experience.

## 2. What the jury measures (hard facts)

The winning team of the previous edition (Relay) reports that Viseca's jury screen showed:
deviations from Viseca's expected decisions, share of unwanted purchases stopped, share of ordinary purchases approved,
share of purchases where the customer is asked, deadline misses, and median latency.

**Consequence:** 45/45 correct decisions, 0 deadline misses and low latency are the entry ticket, not the win.
Relay already achieved 45/45, 0 misses, 76 ms median on Viseca's server.

## 3. How we beat the benchmark (our differentiators)

Do not copy Relay's code, naming (Approval inbox, Decision log) or trust score. Win on what they did not do:

| # | Differentiator | Why it matters | Owner |
|---|---|---|---|
| D1 | **The leash learns, only tighter.** Every answered question produces a one-tap proposal ("You declined 2 add-ons. Block add-ons?"). Re-run the scenario: fewer questions, same safety. Show the before/after ask rate. | Relay asks the customer on 29 % of purchases and never gets better. We show friction dropping across runs. | Dev 1 + Kim |
| D2 | **Conversational leash creation.** The compiler lists its assumptions and asks open questions instead of requiring the exact instruction. | Relay's README admits a non-matching instruction turns everything into declines. | Dev 2 + Kim |
| D3 | **A tab inside Viseca "one", not a new app.** 3-D-Secure-style confirmation sheet, German copy using Viseca's own words (Limiten, Verwendungszwecke, Restriktionen, Transaktionsbestätigung). | Viseca's stated target is the one app. | Kim |
| D4 | **Red-team suite beyond the 45.** 20–30 synthetic attacks we write ourselves (new injections, zero-width chars, German/French text, new lookalikes, split orders). Report: "0 of N attacks approved". | Proves the rules generalise and are not tuned to the public set. | Dev 1 |
| D5 | **Explanation without a score.** Five-part decision card (headline, because, evidence, uncertainty, action). | Simpler and more honest than a 0–100 number. | Dev 1 + Kim |

## 4. Stack and tools

| Need | Tool |
|---|---|
| Code | VS Code (or Cursor), Git, one GitHub repo, branch per person, PR into `main` |
| Language | TypeScript on Node 20 for engine, backend, worker (shared types). React + Vite + Tailwind for the app |
| Database | Supabase (Postgres + Realtime) |
| AI pair-programming | Claude Code in the terminal on the repo |
| API testing | curl or Bruno/Insomnia, with the team key in `.env` only |
| Communication | Slack channel, one thread per blocker |

**Secrets:** `TEAM_API_KEY` lives only in `.env` (in `.gitignore`). Never commit it, never put it in the frontend.

## 5. Timeline (feature freeze Fri 11:00)

| When | Milestone (everyone checks it) |
|---|---|
| Thu 16:00 | Repo exists, `data/` copied, `.env` works, `/v1/bootstrap` answers |
| Thu 17:30 | SCEN0000 decided live by our worker. Engine replays SCEN0001 offline |
| Thu 21:00 | SCEN0001 + SCEN0004 match the oracle offline. App shows live decisions |
| Fri 01:00 | All 45 match or each difference is explained. Resolve / tighten / revoke work |
| Fri 09:00 | D1 learning demo + red-team report. Backup screen recording |
| Fri 11:00 | Freeze. Only bug fixes after this |

## 6. Rules of engagement

1. Engine first. No polish on screens until live decisions flow.
2. No scenario IDs or AU IDs in engine code. A test greps for them.
3. Every guard has a test before it is merged.
4. If blocked more than 20 minutes, post in Slack.
5. If we fall behind, cut P1 (voice, model) before cutting any P0.
