// Runs one scenario end to end: mandate → confirm → run → worker, then prints what was decided.
//   npm run scenario -- SCEN0001                 offline
//   npm run scenario -- SCEN0101 --live          against Viseca (needs TEAM_API_KEY); live scenarios: npm run inspect-live
//   npm run scenario -- SCEN0001 --answer approve  answer every ask right away
import { loadDataPack } from "@leash/shared";
import { loadConfig } from "../config.js";
import { HttpVisecaClient } from "../viseca/client.js";
import { OfflinePlatform } from "../offline/platform.js";
import type { VisecaApi } from "../viseca/api.js";
import { recordingApi } from "../viseca/recorder.js";
import { resolve } from "node:path";
import { LeashEngine } from "../engine/leashEngine.js";
import { InMemoryDecisionStore, LeashBus } from "../store.js";
import { Worker } from "../worker.js";
import { resolveAsk } from "../asks.js";
import { parseLeash } from "../app/parseLeash.js";
import { loadLiveReference } from "../live/referenceData.js";
import { buildBaselines } from "../../../shared/src/baselines.js";

const args = process.argv.slice(2);
const scenarioId = args.find((a) => /^SCEN\d{4}$/.test(a)) ?? "SCEN0000";
const live = args.includes("--live");
const answerIdx = args.indexOf("--answer");
const answer = answerIdx >= 0 ? (args[answerIdx + 1] as "approve" | "decline") : null;

const cfg = loadConfig(live ? { mode: "live" } : {});
const pack = loadDataPack(cfg.dataDir);
// Live runs save every raw response to live-samples/<time>/ so we can check the real formats.
const samplesDir = resolve(cfg.dataDir, "..", "live-samples", new Date().toISOString().replace(/[:.]/g, "-"));
const client = new HttpVisecaClient(cfg.baseUrl, cfg.teamApiKey);
const api: VisecaApi = cfg.mode === "live" ? recordingApi(client, samplesDir) : new OfflinePlatform(pack);
if (cfg.mode === "live") console.log(`recording raw responses to ${samplesDir}`);

// Live mode: the live pack has its own scenarios and card history (bootstrap, reference data, history CSV),
// downloaded now and cached in data/live/. Offline: the local data pack.
const liveRef = cfg.mode === "live" ? await loadLiveReference(client, resolve(cfg.dataDir, "live"), (l) => console.log(l)) : null;
if (liveRef) console.log(`live reference data (${liveRef.source}): ${liveRef.history.length} history rows, ${liveRef.merchants.size} merchants, ${liveRef.scenarios.length} scenarios`);

const scenario = liveRef ? liveRef.scenarios.find((s) => s.scenario_id === scenarioId) : pack.scenarios.get(scenarioId);
if (!scenario) {
  const known = liveRef ? liveRef.scenarios.map((s) => s.scenario_id) : [...pack.scenarios.keys()];
  throw new Error(`unknown scenario ${scenarioId} in ${cfg.mode} mode; available: ${known.join(" ")}`);
}

const { hard_rules, uncertainty_policy, assumptions, open_questions } = parseLeash({ instruction: scenario.cardholder_instruction });
console.log(`${scenarioId} · ${scenario.scenario_name} · mode ${cfg.mode}`);
console.log(`instruction: ${scenario.cardholder_instruction}`);
console.log(`hard_rules: ${JSON.stringify(hard_rules)}`);
for (const a of assumptions) console.log(`  assumption: ${a}`);
for (const q of open_questions) console.log(`  open question: ${q}`);
console.log();

const draft = await api.createMandate({ instruction: scenario.cardholder_instruction, hard_rules, uncertainty_policy, guidance: [], open_questions: [] });
const { mandate_id } = await api.confirmMandate(draft.draft_id);
const store = new InMemoryDecisionStore();
const bus = new LeashBus();
const engine = new LeashEngine(bus, liveRef ? buildBaselines(liveRef.history, liveRef.merchants, { cards: liveRef.cards, accounts: liveRef.accounts }) : undefined);
const worker = new Worker(api, engine, store, bus, { log: (l) => console.log(l), pollWaitSeconds: live ? 25 : 0 });

if (answer) {
  bus.on("ask", (d) => {
    void resolveAsk(api, store, bus, d.id, answer).then(
      () => console.log(`  customer ${answer}d ${d.id}`),
      (err: Error) => console.log(`  resolve ${d.id} failed: ${err.message}`),
    );
  });
}

const run = await api.startRun({ scenario_id: scenarioId, mandate_id });
console.log(`run ${run.run_id} started with mandate ${mandate_id}\n`);
await worker.runUntilDone(run.run_id, { maxIdlePolls: live ? 20 : 3, expectedEvents: scenario.event_count });
await new Promise((r) => setTimeout(r, 100));

const rows = store.list(run.run_id).sort((a, b) => a.purchased_at.localeCompare(b.purchased_at));
console.log("\n#  source   merchant               CHF      decision   status            ms   deadline");
rows.forEach((d, i) =>
  console.log(
    `${String(i + 1).padEnd(3)}${d.source_authorization_id.padEnd(9)}${d.merchant.name.padEnd(23)}${d.amount.chf.toFixed(2).padStart(7)}  ${d.decision.padEnd(10)} ${d.status.padEnd(17)} ${String(d.latency_ms).padStart(3)}  ${d.deadline_missed ? "MISSED" : "ok"}`,
  ),
);
const final = await api.getRun(run.run_id);
console.log(`\nrun status: ${final.status ?? "unknown"} ${JSON.stringify(final.counters ?? {})}`);
worker.stop();
