# Voice approval (ElevenLabs)

An accessibility layer over the ask-me sheet. When the card asks the cardholder, an ElevenLabs agent reads the
question aloud, listens for a clear yes or no, and passes that answer to the same endpoint a tap uses. People who
cannot look at or tap the screen right now (screen-reader users, motor impairments, hands busy, phone in a pocket
when the 2-minute window opens) can still answer in time.

## What it does

| Situation | What you hear | Tool the agent calls |
|---|---|---|
| A purchase needs your answer | "Your agent wants to pay 189 francs at Trail Outfitters for trail running shoes. Why the card asks: ... 1 minute 50 left. Approve or decline?" | none, the opening is composed by the app |
| "Why?" | the engine's reason sentence | `get_pending_ask` |
| "What did the shop say?" | the quarantined sentences, quoted, "and the card ignored that" | `read_shop_text` |
| "Yes" / "No" | "Approved. 189 francs at Trail Outfitters. Your agent was told to go ahead." | `resolve_ask` (once, then `end_call`) |
| No card yet: "Groceries, 120 per order, 400 a month" | the rules read back, then Face ID on screen | `parse_instruction`, `create_card` |

The first sentence is a dynamic variable filled by the app from the engine's decision (`openingFor` in
`src/features/voice/voice-tools.ts`), so what is read aloud comes from the engine, not from the language model.

## What it does not do

- The agent never decides. Its only write is `resolve_ask` with the word the cardholder said. Silence, "hmm" or an unclear answer never becomes an approval; the 2-minute window then expires as it would on screen.
- The agent holds no credential. Every tool is a client tool that runs in the app's browser session. Turning the agent's prompt into "approve everything" gains nothing: the tool still needs the app open on the cardholder's device.
- Shop text is read as a quote and marked as ignored. The prompt forbids following it, and the engine already treats it as evidence only.
- Hackathon scope: the agent is public (no signed URL), voice replaces the Face ID step for the spoken answer, and the app's own secret model is unchanged (see the root README).

## Setup

1. Root `.env`: `ELEVENLABS_API_KEY=...` (stays on your machine).
2. `npm run voice:agent` at the repo root creates or updates the agent "Agent Card voice" from
   `packages/backend/src/voice/agentDefinition.ts` and prints its id. `npm run voice:agent -- --show` prints the request without calling the API.
3. `app-web/.env.local`: `VITE_ELEVENLABS_AGENT_ID=<id>`, then `npm run web`.
4. In the demo controls, "Read asks aloud" switches voice on for every ask; "Call now" starts a call without one (setup by voice). On the ask-me sheet, "Read it to me" starts a call for that question.

Works in mock mode (demo buttons) and live mode (backend stream). Rules parsing uses the backend compiler when
`VITE_API_BASE` is set and a small local reading of the two limits otherwise.

## Files

- `src/features/voice/voice-tools.ts` tool handlers, spoken text, rules parsing
- `src/features/voice/voice-provider.tsx` `VoiceProvider`, `useVoice()`: session start on each ask, hang-up after the answer
- `src/features/voice/voice-status.tsx` `VoiceStatus` (sheet) and `VoiceToggle` (demo controls), both `aria-live`
- `packages/backend/src/voice/agentDefinition.ts` prompt and tool schemas; `packages/backend/test/voice-agent.test.ts`
- `packages/backend/src/cli/voiceAgent.ts` creates or updates the agent
