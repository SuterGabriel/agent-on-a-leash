# agent-on-a-leash · The Agent Card

Viseca gives your AI shopping agent its own card. The card carries your rules, not your money. You set the rules in
the Viseca app from what you already buy, and every payment the agent tries is checked by a rules engine that
answers approve, decline or ask within milliseconds, and explains itself in your words. When the engine asks, you
answer on the phone with Face ID, or by voice, and your answer can become a rule.

Built at the Swiss {ai} Weeks Hackathon Zurich, 24 and 25 September 2026, for the Viseca challenge "Agent on a Leash".
Team Mandat.

## The concept

To let an AI shop for you today, you paste your real card into it. A blank cheque: the only rule is a sentence inside
the agent, and a shop page can rewrite it. The Agent Card turns that around.

- **A separate card number for the agent.** The main card is never shared. Turning the agent off is turning the card off.
- **Rules from your own shopping.** Nothing to type: the app looks at 90 days of purchases and proposes a limit per
  payment, a budget per 30 days, your usual shops and categories, each with the evidence under it. Correct a value, confirm with Face ID, done in under a minute.
- **Every payment checked, every decision explained.** 21 checks in five families (money, item, shop, session,
  manipulation). Each decision carries a headline, one "because" sentence and the checklist: pass, fail or unsure, with
  the fact and the words the rule came from.
- **Ask me when unsure.** A 120-second window, Decline and Approve the same size, Approve with Face ID. Nothing is
  bought without an answer. Your answer can become a rule: stricter is one tap, looser needs your face.
- **Shop text is never trusted.** Sentences on a shop page that try to give the agent orders are quarantined, quoted
  back to you in a grey box, and ignored by the engine.
- **Hear it, not only read it.** An ElevenLabs voice agent reads every question aloud and passes your spoken yes or no
  to the same endpoint a tap uses. It never decides. Setup works by voice too, from the same history-based proposal.

The full concept is in [app-web/handover/docs/01-concept-v4-agent-card.md](app-web/handover/docs/01-concept-v4-agent-card.md).
What we built, the numbers, and Viseca's list row by row: [docs/HACKATHON.md](docs/HACKATHON.md).

## How it works

```text
Shopping agent → Viseca platform → worker + rules engine → backend (ledger, asks, tokens) → Viseca one app (+ voice)
```

- **Engine** ([packages/engine](packages/engine)): deterministic TypeScript, no model in the decision path. The
  customer's instruction is compiled into rules; every rule keeps the words it came from. 21 guards return pass, fail or unsure with a fact. Merchant text goes through a Unicode-normalised quarantine before any fact is read from it.
- **Backend** ([packages/backend](packages/backend)): Node HTTP without a framework. Polls Viseca's platform, decides
  inside the 8 s deadline, posts the decision, keeps a ledger per run (rolling budgets, duplicates, retries), serves the app under `/v4/app/*` with Server-Sent Events, and issues a decision-bound token per approval (one shop, one maximum, fifteen minutes, one use, hash-chained history). A state file survives a restart. An offline copy of Viseca's API runs the whole thing without Wi-Fi.
- **App** ([app-web](app-web)): React 19, Vite, Tailwind, Untitled UI. A clickable phone prototype with mock and live modes.
- **Voice** ([app-web/src/features/voice](app-web/src/features/voice), [packages/backend/src/voice](packages/backend/src/voice)):
  ElevenLabs Agents Platform with client tools that run in the app. The first sentence is composed by the app from the engine's decision, so the model never invents amounts or reasons.

Measured on 24 and 25 September: 45 of 45 decisions match Viseca's reference on the public set; 28 of 28 risky purchases stopped or asked where a plain spending limit catches 6; 0 of 185 live decisions after the deadline; 268 ms median on Viseca's server; 262 tests green. Every number re-runs with a command: `npm run replay`, `npm run compare`, `npm run jury-figures`, `npm test`. Figures in [docs/pitch](docs/pitch), slides in [pitch](pitch).

## Run it

```bash
npm install                      # root workspace (backend, engine, shared)
cp .env.example .env             # offline by default; APP_SECRET and CORS_ORIGIN for the app
npm run api                      # backend on http://localhost:8787

cd app-web && npm install
cp .env.example .env.local       # VITE_API_BASE=http://localhost:8787/v4, VITE_APP_SECRET as in the root .env
npm run dev                      # http://localhost:5173/prototype, side panel says "Data: live"
```

Without `.env.local` the app runs on mock data. Voice needs an ElevenLabs key and one command, see
[docs/VOICE_SETUP.md](docs/VOICE_SETUP.md). The demo, beat by beat, with recovery steps: [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md).

Demo flow on the phone: Card tab → rules from your shopping (`GET /v4/app/leash/suggest`, real numbers from the card's history) → create the card (`POST /v4/app/leash`). In the side panel, "Start run" replays a scenario through the engine (`POST /v4/api/runs`); every decision arrives on `/v4/app/stream`. Asks are answered with `POST /v4/app/asks/:id/resolve`, "Yes, always" with `POST /v4/app/suggestions/:id/accept`, tighten or loosen (Face ID) with `PATCH /v4/app/leash/rules`. Judges: `GET /judge/decisions`.

```bash
npm test                         # 262 tests: engine, compiler, worker, app API, security, tokens, voice
npm run scenario -- SCEN0004     # one scenario offline, decision by decision
```

## Honest limits

- State is in memory with a JSON snapshot; no database. Races are handled inside one process only.
- The app authenticates with one shared secret (`APP_SECRET`). That is a hackathon boundary, not user authentication.
- The ElevenLabs agent is public (connected by id). Voice is an accessibility input inside the cardholder's session, not authentication; approve still needs Face ID.
- The injection detector is a heuristic with documented bypasses. It can only make a decision stricter, never looser, and "not detected" is never treated as "safe".
- Decision-bound tokens are simulated in our vault. Viseca's API has no token step; no card is tokenised.

## Repository map

| Path | What |
|---|---|
| `packages/engine` | the rules engine, 21 guards, replay and compare scripts |
| `packages/backend` | Viseca client, worker, leash service, app API, tokens, voice agent definition |
| `packages/shared` | event, decision and leash types, data pack loaders |
| `app-web` | the phone app, handover pack, design system |
| `pitch` | the five-slide pitch site |
| `docs` | HACKATHON.md, DEMO_GUIDE.md, VOICE_SETUP.md, PRODUCT_SPEC.md, pitch figures, research |
| `data` | Viseca's synthetic challenge data pack |
| `tests` | engine, phrasing and red-team tests |

## Team

- **Kim Badertscher**, design and the app
- **Aracelli Boza**, decision engine
- **Bereket Abate**
- **Gabriel Suter**, backend, voice, lead

MIT license for our code. The data pack under `data/` is Viseca's synthetic challenge material.
