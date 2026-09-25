# Voice approval with ElevenLabs: setup from zero

For whoever wires the voice demo on 25 September. Assumes nothing is done except that the repo is cloned and
`npm install` ran at the root and in `app-web/`. About 20 minutes, most of it waiting for the Discord bot.

The code is already in the repo (`packages/backend/src/voice/`, `app-web/src/features/voice/`). What is missing is
an ElevenLabs account, an API key, and the agent that the key creates. The key stays on your machine; the browser
only ever gets the agent id.

## 1. Account and free credits (5 min)

1. Sign up at elevenlabs.io with the email you registered on Luma for the hackathon.
2. Join the ElevenLabs Discord: https://discord.com/invite/VnBvbbcdEC
3. Open the channel `#🎟️│coupon-codes`, click **Start Redemption**, select **Swiss {ai} Weeks**, enter the Luma email. The bot sends a coupon code for one month of the Creator plan.
4. Redeem the code in elevenlabs.io under your profile (bottom left) → **Subscription**.

The free tier is enough to create the agent and test it. The coupon gives more conversation minutes for rehearsals
and the pitch. If the bot does not answer, ask in `#hackathon-support`.

## 2. API key (2 min)

1. In elevenlabs.io, left sidebar → **Developers** (bottom, above Upgrade) → **API Keys** → **Create API Key**. Not the profile menu.
2. Name it `agent-on-a-leash`. Leave the permissions at the default, or make sure **Agents Platform** (Conversational AI) has read and write. Save the key; it is shown once.
3. In the repo root, copy `.env.example` to `.env` if you have not, and add:

```text
ELEVENLABS_API_KEY=sk_...
```

Never commit `.env`. It is in `.gitignore`.

## 3. Create the agent (1 min)

From the repo root:

```bash
npm run voice:agent -- --show     # prints the request body, no API call; check it looks right
npm run voice:agent               # creates the agent "Agent Card voice" and prints its id
```

Expected last lines:

```text
created agent "Agent Card voice"

agent id: agent_...

Next: put this line in app-web/.env.local and restart npm run web:
  VITE_ELEVENLABS_AGENT_ID=agent_...
```

Running it again updates the same agent instead of creating a second one. The prompt and the six client tools come
from `packages/backend/src/voice/agentDefinition.ts`; edit there, run again.

Optional: `ELEVENLABS_VOICE_ID=` and `ELEVENLABS_LLM=` in `.env` pick a voice and model. Defaults are the
workspace default voice and `gpt-4o-mini`. Voice ids are under **Voices** in elevenlabs.io.

## 4. Tell the app (1 min)

Create `app-web/.env.local` (copy from `app-web/.env.example`):

```text
VITE_API_BASE=http://localhost:8787/v4
VITE_ELEVENLABS_AGENT_ID=agent_...
```

Leave `VITE_API_BASE` out to run the app in mock mode. Voice works in both modes; mock mode does not need the
backend or Wi-Fi, which is the fallback on stage.

## 5. Run and test (5 min)

Two terminals from the repo root:

```bash
npm run api     # backend on 8787 (skip in mock mode)
npm run web     # app on http://localhost:5173
```

1. Open http://localhost:5173/prototype in Chrome. Use `localhost`, not an IP; the microphone needs a secure origin.
2. In the demo controls on the right, the **Voice (ElevenLabs)** block shows "Voice off". If it says "set VITE_ELEVENLABS_AGENT_ID", the `.env.local` line is missing or the dev server was not restarted.
3. Click **Read asks aloud**. Chrome asks for the microphone once; allow it.
4. Click **Shop text gives orders (ask me, 2:00)**. The phone shows the ask-me sheet, the status turns "Connecting…" then "Speaking", and you hear: "Your agent wants to pay ... at ... Why the card asks: ... The shop page also said: '...' The card ignored that. ... left to answer. Approve or decline?"
5. Say "why?" to hear the reason again, "what did the shop say?" for the quote, then "decline". The sheet flips to "You declined", the call hangs up by itself.
6. Trigger the ask again and say "yes" to see the approve path.

Setup by voice: with no card created (Reset demo), click **Call now** and say "groceries, 120 francs per order and
400 a month". The agent reads back what it understood; say "yes" and Face ID runs on screen.

## 6. If something is wrong

| Symptom | Cause | Fix |
|---|---|---|
| Voice block says "set VITE_ELEVENLABS_AGENT_ID" | env not read | check `app-web/.env.local`, restart `npm run web` |
| "Voice unavailable" right after clicking | mic denied, or not on localhost | Chrome site settings → allow microphone; use `http://localhost:5173` |
| `npm run voice:agent` fails with 401 | wrong or missing key | recreate the key, check `.env` has no quotes or spaces |
| `npm run voice:agent` fails with 422 | a field in the definition the API rejects | read the message; usually the LLM or model id. Set `ELEVENLABS_LLM=gpt-4o-mini` |
| Agent speaks but says "{{opening}}" | dynamic variable not passed | only happens if the session was started outside the app; use the app's buttons |
| Agent hears nothing | wrong input device | Chrome → site settings → microphone device |
| Call never starts on an ask | voice not switched on | "Read asks aloud" must be on before the ask arrives, or click "Read it to me" on the sheet |
| Two calls at once | two browser tabs | keep one tab open |

Test the whole thing once in mock mode before the pitch. Do not debug on live during the demo.

## 7. What to say when asked

- The agent never decides. Its only write is `resolve_ask` with the word the cardholder said. Silence or "hmm" is never an approval; the two-minute window expires as on screen.
- The first sentence is composed by the app from the engine's decision and passed as a variable. The model does not invent amounts or reasons.
- Shop text is read as a quote and marked as ignored. The prompt forbids following it, and the engine already treats it as evidence only.
- It is an accessibility feature: eyes-free, hands-free confirmation inside the two-minute window.
- Hackathon-grade: the agent is public (connected by id), a spoken yes replaces the Face ID step, and the app's shared secret model is unchanged.

Details: `app-web/docs/voice.md`. Tests: `npx vitest run packages/backend/test/voice-agent.test.ts`.

## 8. Optional, 30 min: bind the answer to the question

Today `resolve_ask` answers whatever question is open. Stronger: the agent passes the decision id it was read, and
the app rejects a mismatch or a stale call. Change `resolve_ask` in `agentDefinition.ts` (add a required
`decision_id` string) and in `app-web/src/features/voice/voice-tools.ts` (compare with `state.waiting.decisionId`),
include the id in `openingFor`, run `npm run voice:agent` again. Worth it for the portfolio version, not needed for the pitch.

## 9. After the hackathon: ElevenLabs showcase

Selected projects get swag and a page on showcase.elevenlabs.io.

1. Fill the 20-second feedback form: https://forms.gle/gHs8mGFGSPt6Hrco9
2. Fork the showcase repository linked from https://showcase.elevenlabs.io/, add a project MDX file from their template, open a pull request.
3. Fill their submission form (link in the hacker guide).

For the write-up, lead with the accessibility angle and the "agent never decides" boundary; that is what sets this apart from a voiceover.
