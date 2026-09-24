// Creates or updates the ElevenLabs agent from packages/backend/src/voice/agentDefinition.ts.
//   npm run voice:agent            → prints the agent id
//   npm run voice:agent -- --show  → prints the request body and exits (no API call)
// Needs ELEVENLABS_API_KEY in .env. The key never leaves this machine; the browser only gets the agent id.
import "../config.js"; // loads .env
import { agentDefinition, VOICE_AGENT_NAME } from "../voice/agentDefinition.js";

const API = "https://api.elevenlabs.io/v1/convai";

async function call<T>(key: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const body = agentDefinition({ llm: process.env.ELEVENLABS_LLM, voiceId: process.env.ELEVENLABS_VOICE_ID });

if (process.argv.includes("--show")) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}

const key = process.env.ELEVENLABS_API_KEY?.trim();
if (!key) {
  console.error("ELEVENLABS_API_KEY is empty. Add it to .env (never commit .env).");
  process.exit(1);
}

try {
  const list = await call<{ agents: { agent_id: string; name: string }[] }>(key, "GET", `/agents?search=${encodeURIComponent(VOICE_AGENT_NAME)}&page_size=20`);
  const existing = list.agents.find((a) => a.name === VOICE_AGENT_NAME);
  let agentId: string;
  if (existing) {
    await call(key, "PATCH", `/agents/${existing.agent_id}`, body);
    agentId = existing.agent_id;
    console.log(`updated agent "${VOICE_AGENT_NAME}"`);
  } else {
    const created = await call<{ agent_id: string }>(key, "POST", "/agents/create", body);
    agentId = created.agent_id;
    console.log(`created agent "${VOICE_AGENT_NAME}"`);
  }
  console.log(`\nagent id: ${agentId}`);
  console.log(`\nNext: put this line in app-web/.env.local and restart npm run web:\n  VITE_ELEVENLABS_AGENT_ID=${agentId}`);
} catch (err) {
  console.error("\nfailed:", (err as Error).message);
  process.exit(1);
}
