// Starts the app API: npm run api  (offline by default, LEASH_MODE=live or --live for Viseca)
import { resolve } from "node:path";
import { loadDataPack } from "@leash/shared";
import { loadConfig } from "../config.js";
import { HttpVisecaClient } from "../viseca/client.js";
import { OfflinePlatform } from "../offline/platform.js";
import { LeashEngine } from "../engine/leashEngine.js";
import { LeashService } from "../leash/service.js";
import { createLeashServer } from "../http/server.js";
import { loadLiveReference } from "../live/referenceData.js";
import { attachSnapshotFile } from "../persist.js";
import { MemoryStore } from "../memory/memoryStore.js";
import { PeerIndex } from "../coldstart/peers.js";
import { loadPeerSources } from "../coldstart/peerSources.js";
import { Apertus } from "../llm/apertus.js";
import { readProfile } from "../llm/profileReader.js";
import { buildBaselines } from "../../../shared/src/baselines.js";

const cfg = loadConfig(process.argv.includes("--live") ? { mode: "live" } : {});
const port = Number(process.env.PORT ?? 8787);
const pack = loadDataPack(cfg.dataDir);
const client = new HttpVisecaClient(cfg.baseUrl, cfg.teamApiKey);
const log = (line: string) => console.log(`[worker] ${line}`);

// Live: the live pack has its own scenarios and card history, downloaded now and cached in data/live/.
const liveRef = cfg.mode === "live" ? await loadLiveReference(client, resolve(cfg.dataDir, "live"), log) : null;
const engine = new LeashEngine(undefined, liveRef ? buildBaselines(liveRef.history, liveRef.merchants, { cards: liveRef.cards, accounts: liveRef.accounts }) : undefined);

// What customers teach us survives restarts: data/live/memory-<mode>.json (git-ignored). LEASH_MEMORY_FILE=off keeps it in memory.
const memoryFile = process.env.LEASH_MEMORY_FILE?.trim() || resolve(cfg.dataDir, "live", `memory-${cfg.mode}.json`);
const memory = new MemoryStore({ file: memoryFile === "off" ? null : memoryFile, log });
engine.useMemory(memory.lookup);

// Cold start: customers like this one (nearest neighbours by profile) for cards without history. Evidence only.
const peerSrc = loadPeerSources(cfg.dataDir, liveRef);
const peers = new PeerIndex(peerSrc.sources);
engine.usePeers(peers.lookup);
log(`cold start: ${peerSrc.sources.customers.length} customers from ${peerSrc.from}${peerSrc.profileCustomerId ? `, profile ${peerSrc.profileCustomerId}` : ""}`);

// Apertus (Swisscom AI Platform): reads new customers' profiles and leashes in other languages. Never decides; cached
// in data/live/llm-cache.json (LEASH_LLM_CACHE=off to disable); without APERTUS_* in .env every call falls back.
const llmCache = process.env.LEASH_LLM_CACHE?.trim() || resolve(cfg.dataDir, "live", "llm-cache.json");
const llm = new Apertus({ cacheFile: llmCache === "off" ? null : llmCache, log });
if (llm.enabled) {
  // In the background: the server answers at once, the neighbours get sharper as each profile is read.
  void (async () => {
    let read = 0;
    for (const { customer_id, text } of peers.coldProfiles()) {
      const r = await readProfile(llm, text);
      if (r.signals.source === "apertus") {
        peers.setSignals(customer_id, r.signals);
        read += 1;
      }
    }
    log(`apertus: read ${read} new customer profile(s)`);
  })();
} else log("apertus: not configured (APERTUS_* in .env); profiles read by keywords, leashes in English or German only");

const service = new LeashService({
  memory,
  api: cfg.mode === "live" ? client : new OfflinePlatform(pack),
  pack,
  engine,
  mode: cfg.mode,
  worker: { pollWaitSeconds: cfg.mode === "live" ? 25 : 0 },
  scenarios: liveRef?.scenarios,
  historyRows: liveRef?.history,
  log,
});
// The engine keeps one ledger per run; it has to hear the customer's answers.
engine.follow(service.bus);

// A restart keeps the leash, the feed, open asks and tokens: data/live/state-<mode>.json (git-ignored).
// LEASH_STATE_FILE=off disables it; any other value is the file to use.
const stateFile = process.env.LEASH_STATE_FILE?.trim() || resolve(cfg.dataDir, "live", `state-${cfg.mode}.json`);
if (stateFile !== "off") attachSnapshotFile(service, stateFile, { log });

// Live moves money on Viseca's side, so it refuses to start open. Offline stays open for local development.
const appSecret = process.env.APP_SECRET?.trim() || null;
const corsOrigin = process.env.CORS_ORIGIN?.trim() || (cfg.mode === "live" ? null : "*");
if (cfg.mode === "live" && (!appSecret || !corsOrigin || corsOrigin === "*")) {
  console.error("Live mode needs APP_SECRET and CORS_ORIGIN (the app's origin, not *). See .env.example.");
  process.exit(1);
}
if (!appSecret) console.warn("APP_SECRET is not set: anyone who reaches this server can answer purchases.");

createLeashServer(service, { corsOrigin: corsOrigin as string, appSecret, app: { history: liveRef?.history, peers, profileCustomerId: peerSrc.profileCustomerId, llm } }).listen(port, () => {
  console.log(`Leash API on http://localhost:${port} · mode ${cfg.mode} · engine ${engine.version}`);
  console.log(`  scenarios: ${service.scenarios().map((s) => s.scenario_id).join(" ")}`);
  console.log(`  GET  /app/leash · /app/feed · /app/asks · /app/stream (SSE) · /app/tokens · /judge/decisions · /api/status`);
  console.log(`  POST /app/leash/parse · /app/leash · /app/asks/:id/resolve · /api/runs {"scenario_id":"..."}`);
  console.log(`  v4 app (app-web): VITE_API_BASE=http://localhost:${port}/v4 · /v4/app/leash/suggest · /v4/app/feed · /v4/app/stream · /v4/api/runs`);
});
