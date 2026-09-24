# Gabriel — Lead, pitch, experts, voice (P1)

You keep the team on schedule, get answers from Viseca, and own the story.

---

## Now

1. Confirm roles in Slack: Dev 1 engine, Dev 2 backend, Kim app. One owner per file.
2. Create the GitHub repo, add everyone, protect `main`, share `.env.example`.
3. Put the team key in a private Slack message, not in the repo.

## Experts (ask early, post answers in Slack)

1. One item only: after the first approved item, decline, ask or approve later ones?
2. Small overshoots (5–10 %): ask or decline?
3. Does a shop used with the customer's other card count as familiar?
4. Session burst: one grouped question or one per order?
5. Revoke while a question is pending: what should the customer see?
6. **Does the jury screen measure the ask rate as friction?** (decides how hard we push D1)
7. Are there hidden scenarios in judging?

## Pitch (1 min) — structure

1. Problem in one sentence. 2. The leash in one sentence, in Viseca's own words ("kontrollierte digitale Freiheit").
3. Live: groceries leash → quiet approvals → one question → decline → **leash proposes to tighten** → rerun, fewer questions.
4. Wow: manipulated shop text quoted and ignored; lookalike shop stopped.
   Then the token beat: the approved monitor gets a one-time pass (only PixelHarbor, up to CHF 303.45, one payment, 15 min). The hijacked agent tries a second charge, CHF 900 "pre-authorised", and the lookalike shop: all refused. `npm run demo:tokens` plays it on real data.
5. Control: revoke, and every unused pass dies with it. Jury view: 45 decisions, 0 deadline misses, model on/off identical.

Headline claim we can prove and Relay could not: **"Safe on every run, and less friction on the next one."**

## Q&A prep

- What if the agent is compromised *after* we approve? → the decision-bound token: one shop, one amount, one payment, 15 minutes, dies on revoke. Rules decide, the token enforces. Simulated here; in production the one app issues it as a network token.
- Isn't that just Revolut's one-time card? → A one-time card limits how often a number is used. Our pass also knows what was approved: shop, amount, time.
- What if the model fails? → same answers, shown in the jury view.
- How do you avoid overfitting to the 45? → red-team suite, 0 approved.
- Why no score? → five-part explanation; Viseca wants "unspektakulär, weil es einfach funktioniert".

## Voice (P1, only after Thu 21:00 checkpoint passes)

ElevenLabs agent with two tools calling our backend: compile instruction, resolve. Never a third decision path.

## Checkpoints you run

Thu 16:00 · 17:30 · 21:00 · Fri 01:00 · 09:00 · 11:00 freeze · 12:00 submit.
At each: what works, what is blocked, what we cut.
