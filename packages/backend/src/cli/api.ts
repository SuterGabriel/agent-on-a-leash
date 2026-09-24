// Starts the app API: npm run api  (offline by default, LEASH_MODE=live or --live for Viseca)
import { loadDataPack } from "@leash/shared";
import { loadConfig } from "../config.js";
import { HttpVisecaClient } from "../viseca/client.js";
import { OfflinePlatform } from "../offline/platform.js";
import { stubEngine } from "../engine/port.js";
import { LeashService } from "../leash/service.js";
import { createLeashServer } from "../http/server.js";

const cfg = loadConfig(process.argv.includes("--live") ? { mode: "live" } : {});
const port = Number(process.env.PORT ?? 8787);
const pack = loadDataPack(cfg.dataDir);
const api = cfg.mode === "live" ? new HttpVisecaClient(cfg.baseUrl, cfg.teamApiKey) : new OfflinePlatform(pack);

const service = new LeashService({
  api,
  pack,
  engine: stubEngine, // Ara's engine plugs in here.
  mode: cfg.mode,
  worker: { pollWaitSeconds: cfg.mode === "live" ? 25 : 0 },
  log: (line) => console.log(`[worker] ${line}`),
});

createLeashServer(service, { corsOrigin: process.env.CORS_ORIGIN ?? "*" }).listen(port, () => {
  console.log(`Leash API on http://localhost:${port} · mode ${cfg.mode} · engine ${stubEngine.version}`);
  console.log(`  GET  /app/leash · /app/feed · /app/asks · /app/stream (SSE) · /judge/decisions · /api/status`);
  console.log(`  POST /app/leash/parse · /app/leash · /app/asks/:id/resolve · /api/runs {"scenario_id":"SCEN0001"}`);
});
