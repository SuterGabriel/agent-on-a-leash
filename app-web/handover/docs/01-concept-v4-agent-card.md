# Concept v4 · The Agent Card

Written 24 Sep 2026, evening (Day 1). Replaces the prototype v2 flow (agent chat first, typed instruction, agents as objects in the app) and locks concept v3 (rules from behaviour). **This is the file the demo, the Figma page "UI mobile v3 · demo" and the React route `/prototype` are built from.** Screen codes S0-S10 and flows F2-F8 in `03-user-flows.md` stay valid; F1 and S7 are replaced here.

## One sentence

**Viseca gives your AI shopping agent its own card. The card carries your rules, not your money. You set the rules in Viseca one from what you already buy, in under a minute, and every payment the agent tries is checked against them and explained back to you.**

## Why this and not the other things we had

| We had | Problem Kim named | v4 |
|---|---|---|
| ChatGPT chat as the first screen (A.1, A.2) | "I don't want agents in the app." The agent is a separate tool. Showing it inside Viseca one confuses what we build | The prototype starts in Viseca one, Card tab. The agent is only ever referred to as "your shopping agent" |
| "Connected agents" list with ChatGPT and Claude rows, one rule set per agent | Agents as objects to manage. More setup, more screens, and Viseca's API has one mandate per card anyway | **One Agent Card, one rule set.** Whoever holds the card number is bound by the rules. No agent picker |
| Textarea "What may ChatGPT buy?" then "Reading your words" | Typing first is friction, and the customer has to know what a good rule is | **Rules come from the last 90 days of shopping**, with the evidence under each rule. Typing is gone from the setup path. The instruction sentence is generated from the rules and shown as "What we tell the agent" |
| Setup analysed "past shopping" but it wasn't visible anywhere | "The set up of analyse past shopping is not clear now" | One screen, **"Rules from your shopping"**: a short analysis card (23 purchases, typical CHF 46, biggest CHF 266, about CHF 520 a month, HarborByte 21 times) and 4 proposed rules, each with its evidence line. Tap a value to correct it |
| Budget only | Viseca asked for more than a budget | **Smart settings**: when unsure, at night, new shops, learn from my answers. Each pre-set from history, each with its evidence |

## What Viseca asked for, and where it shows

From `01_challenge/viseca-2026/challenge.md` and `technical_details.md`, plus what they told us at the Q&A (setup matters, correcting settings matters).

| Viseca must see | Where in the demo | Screen |
|---|---|---|
| Customer input becomes clear, executable permissions | "Rules from your shopping": 4 rules with values and evidence, generated instruction sentence, mapped 1:1 to `hard_rules` | 1.3 |
| Customer can review, confirm, tighten, update, revoke | Correct a value with the stepper before confirming (CHF 300 to CHF 400). Later: Tighten from a decision or in Rules. Turn off in one sheet | 1.3, 6.1, 6.2, 8.2 |
| Rules for uncertain cases | Smart settings: When unsure Ask me / Decline, at night Decline instead of asking | 1.4 |
| Ordinary purchase, minimal friction | PixelHarbor CHF 289 approved. No push. A quiet row and the budget bar moves | 3.1 |
| Manipulated or unsafe purchase, useful intervention | PixelHarbour (lookalike) declined: checklist shows exactly which rule failed and the fact. PixelHarbor with shop text that gives orders: Ask me, shop text quarantined in a grey box | 5.2, 4.1, 4.2 |
| Human approval, rejection, revocation | Ask me sheet: Approve (Face ID) or Decline, same size, 2:00 countdown. Then "Always decline when a shop gives orders?" one tap. Then Turn off agent card | 4.1, 4.4, 8.2 |
| Explain in plain language, highlight uncertainty | Every decision: headline, one sentence "because", checklist Pass / Fail / Not sure with one fact per rule, and the customer's words on a failing rule | 5.2, 4.2 |
| Track state over time | "CHF 1'211 left this month, CHF 289 frees up 11 Sep" on the budget meter. Known shops with counts. Learned rules with date | 3.1, 6.1 |
| Don't block ordinary shopping | Declines for limits and budget are quiet rows, only lookalike, shop text and "not you" send a push. Overnight stops arrive as one morning summary | 3.1, F7 |
| Merchant text untrusted | Grey "From the shop page · not trusted" box, quoted, "We ignored this." Never in the headline | 4.2, 5.2b |
| UI decoupled from engine | The app talks only to our backend (`07-api-contract.md`). Mock and live are one switch | all |

## "Tokens" in plain language (for the pitch and for the customer)

The brief says agents are "enabled by new capabilities from Visa and Mastercard". Those capabilities are **agentic tokens**: instead of handing the agent your real card number, the network issues a substitute number that is linked to your card, carries your permissions, identifies the agent at the checkout, and can be switched off without touching your card.

For the customer we never say "token". We make the token visible as a thing they already understand: **a card**.

| Technical | What the customer sees | Copy on 1.5 |
|---|---|---|
| Agentic token issued for your card | The Agent Card, its own number •• 7310, black with the orange agent dot | "Your agent gets its own card number. It is linked to •• 7049 but it is not your card." |
| Token bound to a mandate (instruction, hard_rules, uncertainty_policy) | The rules travel with the card | "Every payment with this card is checked against your rules first." |
| Token can be suspended or deleted | Freeze / Turn off | "Switch it off any time. Your main card keeps working." |
| Token identifies the agent | Activity rows say which card paid | "Payments with •• 7310 are your agent's, never yours." |

Why it helps the demo: the jury sees the leash as an object on screen, not as a settings form. "Give this card to your agent" is a sentence anyone in the room understands.

## Dynamic smart settings (more than a budget)

All four are pre-set from history and carry their evidence. All four are one-way: the customer can only make them stricter without Face ID. Loosening = Face ID.

| Setting | Options | Default from history | Evidence line | Engine |
|---|---|---|---|---|
| When unsure | Ask me · Decline | Ask me | "You get one question and 2 minutes to answer" | `uncertainty_policy` |
| At night (23:00 to 06:00) | Decline instead of asking · Ask me anyway | Decline instead of asking | "Only 4 of your 23 purchases were at night. Declined ones wait in your morning summary" | engine-side rule, shown under Always on |
| New shops | Ask me first · Only shops I know | Ask me first | "12 shops in the last 90 days. A new one asks you first" | history signal |
| Learn from my answers | On · Off | On | "After you answer, we offer one rule. You decide each time" | learned rules store |

Learned rules (F6) stay as designed: after Decline, "Always decline when a shop gives orders?" with Yes, always / Just this time. Learned rules only make decisions stricter and appear under "Learned from your answers" with a date and a Remove.

## Overnight: quiet, not silent

Kim's rule: being declined overnight is good, but it must not wake you, and in the morning it must be clear why.

- Limits and budget declines: never a push. Row in Activity with the one-line reason.
- Lookalike shop, shop text giving orders: push, because the customer may want to act.
- "Not you" (new phone, night, burst): one grouped push, "We stopped 4 payments, 02:14 to 02:24", not four.
- At night with "Decline instead of asking": the Ask me becomes a decline, the row says "Declined at night: we'd have asked you".
- Every declined row opens the same decision card: headline, because, checklist, your words. Nothing is explained with "for security reasons".

## Prohibitions (unchanged from v3, plus two)

1. No free-text field in the setup path.
2. One primary action per screen. Approve and Decline are the same size. Only Approve needs Face ID.
3. Orange only on the agent's identity mark (dot on the card, the app icon ring).
4. No score, no percentage, no confidence gauge.
5. Nothing visually new: grouped list, bottom sheet, black pill, segmented control, progress bar.
6. **No agent brand inside Viseca one.** No "ChatGPT", no logos, no chat bubbles. "Your shopping agent" only.
7. **Every suggested value shows its evidence.** A number without a "because" line is a bug.

Signature move: **one rule row, everywhere.** "Each payment CHF 120 or less" with its evidence on 1.3 is the same row that reads "Pass · CHF 44.50" on the decision card and "Tighten" in Rules.

## Demo persona (honest numbers)

Card CA0039 from the data pack, customer CU0019 "Oliver Graf", the persona described as using a virtual card for web shops. Last 90 days before SCEN0004: 23 purchases, typical CHF 46, biggest CHF 266, about CHF 520 a month, biggest month CHF 894, 4 purchases at night, 12 shops, HarborByte 21 times and PixelHarbor 6 times all-time, Electronics + Dining + Clothing + Books + Household = 90 % of spend. Every evidence line on 1.3 and 1.4 comes from these numbers. Decisions for every demo beat come from SCEN0004 (`decisions.json`).

## The demo screens (build these, nothing else first)

| # | Screen | Frame | What it proves |
|---|---|---|---|
| 1 | Card tab with the "Shop with an AI agent, safely" banner | 1.1 | Entry inside Viseca one, next to Lock and PIN |
| 2 | How it works (one screen, three rows) | 1.2 | What an Agent Card is, in 3 sentences |
| 3 | Rules from your shopping | 1.3 | Setup without typing: 23 purchases in 90 days, typical CHF 46, biggest CHF 266; evidence per rule; correction via stepper sheet (1.3a) |
| 4 | Smart settings | 1.4 | More than a budget, all pre-set, all with evidence |
| 5 | Your Agent Card is ready | 1.5 | The token as a card, "give this to your agent", Face ID done |
| 6 | Agent Card home | 3.1 | Quiet approvals, budget bar, Waiting for you, Activity |
| 7 | Push + Ask me sheet + See checks | 4.0, 4.1, 4.2 | Useful intervention, shop text quarantined, human decides |
| 8 | You declined + learned rule | 4.4 | Answer becomes a rule in one tap |
| 9 | Payment details (declined, lookalike) | 5.2 | Why it was flagged, in 5 seconds |
| 10 | Rules (control centre) + Tighten sheet | 6.1, 6.2 | Correct settings later, stricter in one tap |
| 11 | Turn off Agent Card | 8.2 | Revoke |

P1 if time: morning summary (F7 grouped alert, 7.2), Card settings (6.3), Time's up (4.5), Access ended (8.4).

## Demo script (60 s, v4)

| Time | Show | Say |
|---|---|---|
| 0:00 | Card tab, tap "Get started". 1.3 appears: analysis card + 4 rules with evidence | "Viseca already knows how you shop. It proposes the rules. Nothing to type." |
| 0:10 | Tap CHF 300, stepper up to CHF 400, "From the next payment: max CHF 400" | "You correct what you want before you confirm. Later, stricter is one tap and looser needs Face ID." |
| 0:15 | Smart settings: night = decline, new shops = ask. Face ID. Card ready: "Give this card to your agent" | "The agent gets its own card number. Your card stays private." |
| 0:25 | Home. Agent pays PixelHarbor CHF 289: quiet row, bar moves | "Normal shopping stays invisible." |
| 0:30 | PixelHarbour CHF 340 declined. Tap: checklist, "Only shops you know" failed, fact "PixelHarbour is not PixelHarbor, where you bought 6 times" | "A fake shop, one letter off. Stopped, and you see which rule and why." |
| 0:40 | Push: agent wants CHF 299 at PixelHarbor. Sheet: "Why we ask: the shop page tried to change your rules." See checks: shop text in the grey box | "The shop tried to talk our engine out of your limit. We ignored it and asked you." |
| 0:50 | Decline. "Always decline when a shop gives orders?" Yes. Rules screen shows it under Learned. Turn off Agent Card | "Your answer becomes a rule. And one tap turns the card off." |
| 0:58 | Judge view on the laptop | "45 purchases, no hard-coding, under a second each." |

## Architecture in one picture (for Q&A)

```
Shopping agent (ChatGPT, browser agent, simulator)
        │ pays with Agent Card •• 7310 (the token)
        ▼
Viseca platform ── decision request (purchase + mandate snapshot) ──► our engine (Dev 1)
                                                                        │ rules first, model optional, < 1 s
                                                                        ▼
                                                              our backend (Dev 2): decisions store, asks, learned rules
                                                                        │ /app/* JSON + SSE
                                                                        ▼
                                                              Viseca one · Agent Card (Kim)  ◄── customer: rules, answers, tighten, turn off
```

The app never talks to the Viseca API. Mock and live share one adapter (`app/web/src/features/shopping-card/api/`). Details for the developers: `app/web/docs/backend-hookup.md`.

## Skills and tools used for this (so it can be repeated)

| Need | Skill / tool | Why this one |
|---|---|---|
| Frame, flow, structure, states | `product-design-flow` (loaded first, stages 1-5) | One pipeline, forces flow before frames and the three uglies |
| Taste gate and critique | `design-director` + `references/critique-protocol.md` | Concept sentence, reference triangle, prohibitions |
| Architecture and hookup doc | `engineering:system-design` | Component diagram, API contract, trade-offs |
| Screens in Figma | `figma:figma-use` (mandatory before `use_figma`) + `figma:figma-generate-design` | Writes frames from the existing library components instead of drawing |
| Dev handoff spec from a frame | agent `design-handoff` | Maps Figma instances to Untitled UI React props |
| Pattern references | Mobbin MCP (`/mobbin <pattern>`) | GoHenry limits, Revolut declined detail, Family confirm |
| Component reuse | Untitled UI MCP + `app/web/CLAUDE.md` rules | No ad-hoc styles |
| Not used on purpose | `frontend-design`, `ui-design:*` colour/type skills | The visual system is locked (Viseca restyle, 24 Sep). Re-deciding it is the "takes forever" failure |

## Decisions locked (24 Sep evening, Kim delegated: "decide yourself, UX and buildability first")

1. **Analysis window: 90 days.** 30 days gives 8 purchases on the demo card, too thin to justify a rule. 90 days gives 23 and every number stays traceable to `authorization_history.csv`.
2. **Suggested per-payment limit CHF 300, corrected to CHF 400 in the demo.** The correction is the beat Viseca asked for ("how the user corrects the settings"). Before Face ID nothing is confirmed, so any value is allowed. After confirmation, looser needs Face ID and the backend creates a new mandate (the Viseca PATCH can only tighten), stricter is a plain PATCH. This is in `app/web/docs/backend-hookup.md`.
3. **Name: "Agent Card".** Says what it is in two words and reads naturally in every sentence ("Give this card to your agent", "Turn off Agent Card"). "Online shopping" hid the agent.
4. **Card rules and task rules stay two layers, one screen.** Card rules are the wallet policy (independent of any shopping task, as the brief demands). The task arrives with the first purchase and is shown read-only. Stricter of the two wins in the engine. Nothing to type in Viseca one, ever.
