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
import { buildBaselines } from "../../../shared/src/baselines.js";

const cfg = loadConfig(process.argv.includes("--live") ? { mode: "live" } : {});
const port = Number(process.env.PORT ?? 8787);
const pack = loadDataPack(cfg.dataDir);
const client = new HttpVisecaClient(cfg.baseUrl, cfg.teamApiKey);
const log = (line: string) => console.log(`[worker] ${line}`);

// Live: the live pack has its own scenarios and card history, downloaded now and cached in data/live/.
const liveRef = cfg.mode === "live" ? await loadLiveReference(client, resolve(cfg.dataDir, "live"), log) : null;
const engine = new LeashEngine(undefined, liveRef ? buildBaselines(liveRef.history, liveRef.merchants) : undefined);

const service = new LeashService({
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

// Live moves money on Viseca's side, so it refuses to start open. Offline stays open for local development.
const appSecret = process.env.APP_SECRET?.trim() || null;
const corsOrigin = process.env.CORS_ORIGIN?.trim() || (cfg.mode === "live" ? null : "*");
if (cfg.mode === "live" && (!appSecret || !corsOrigin || corsOrigin === "*")) {
  console.error("Live mode needs APP_SECRET and CORS_ORIGIN (the app's origin, not *). See .env.example.");
  process.exit(1);
}
if (!appSecret) console.warn("APP_SECRET is not set: anyone who reaches this server can answer purchases.");

createLeashServer(service, { corsOrigin: corsOrigin as string, appSecret }).listen(port, () => {
  console.log(`Leash API on http://localhost:${port} · mode ${cfg.mode} · engine ${engine.version}`);
  console.log(`  scenarios: ${service.scenarios().map((s) => s.scenario_id).join(" ")}`);
  console.log(`  GET  /app/leash · /app/feed · /app/asks · /app/stream (SSE) · /app/tokens · /judge/decisions · /api/status`);
  console.log(`  POST /app/leash/parse · /app/leash · /app/asks/:id/resolve · /api/runs {"scenario_id":"..."}`);
});
