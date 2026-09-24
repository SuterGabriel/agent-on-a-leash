// Offline replay of the public scenarios.
//   npx tsx packages/engine/src/replay.ts --scenario SCEN0001
//   npx tsx packages/engine/src/replay.ts --all
// The oracle (data/reference_decisions.csv) is read HERE ONLY, for comparison and for the
// customer's assumed answer to step_ups. The engine itself never sees it.
import { existsSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, loadDataPack, readCsv, scenarioAttempts } from "../../shared/src/loaders";
import { buildEvent } from "../../shared/src/csvEvent";
import { compilePolicy, toHardRules } from "../../shared/src/compiler";
import { decide } from "./decide";
import { Ledger } from "./ledger";
import { buildBaselines, type Baselines } from "../../shared/src/baselines";

let baselines: Baselines | null = null;
export function getBaselines(): Baselines {
  if (!baselines) {
    const pack = loadDataPack();
    baselines = buildBaselines(pack.history, pack.merchants);
  }
  return baselines;
}

export interface ReplayRow {
  source_id: string;
  order: number;
  merchant: string;
  chf: number;
  decision: string;
  reasons: string;
  expected: string;
  match: boolean | null;
  customer_answer: string;
  ms: number;
  message: string;
}

export function replayScenario(scenarioId: string): ReplayRow[] {
  const pack = loadDataPack();
  const scenario = pack.scenarios.get(scenarioId);
  if (!scenario) throw new Error(`Unknown scenario ${scenarioId}`);

  const oraclePath = path.join(DATA_DIR, "reference_decisions.csv");
  const oracle = existsSync(oraclePath)
    ? new Map(readCsv("reference_decisions.csv").map((r) => [r.authorization_id, r]))
    : new Map();

  // The customer's instruction -> policy. Nothing depends on the scenario ID.
  const policy = compilePolicy(scenario.cardholder_instruction);
  const mandate = {
    mandate_id: `TM_offline_${scenarioId}`,
    instruction: policy.instruction,
    hard_rules: toHardRules(policy),
    uncertainty_policy: policy.uncertainty,
  };

  const ledger = new Ledger();
  const runId = `run_${Date.now().toString(36)}`;
  const rows: ReplayRow[] = [];

  for (const attempt of scenarioAttempts(pack, scenarioId)) {
    const event = buildEvent(pack, attempt, mandate, runId);
    const r = decide(event, policy, ledger, getBaselines());
    const ref = oracle.get(attempt.authorization_id);

    let answer = "";
    if (r.decision === "step_up") {
      answer = ref?.assumed_customer_answer || "decline"; // no answer = nothing bought
      ledger.resolve(r.authorization_id, answer === "approve" ? "approve" : "decline");
    }

    rows.push({
      source_id: attempt.authorization_id,
      order: Number(attempt.replay_order),
      merchant: event.authorization.merchant.merchant_name,
      chf: event.authorization.billing_amount_chf,
      decision: r.decision,
      reasons: r.reason_codes.join("+"),
      expected: ref?.expected_decision ?? "",
      match: ref ? ref.expected_decision === r.decision : null,
      customer_answer: answer,
      ms: r.elapsed_ms,
      message: r.customer_message,
    });
  }
  return rows;
}

function printRows(scenarioId: string, rows: ReplayRow[], verbose: boolean) {
  console.log(`\n=== ${scenarioId} ===`);
  console.table(
    rows.map((r) => ({
      id: r.source_id,
      "#": r.order,
      shop: r.merchant,
      CHF: r.chf.toFixed(2),
      decision: r.decision,
      reasons: r.reasons,
      expected: r.expected,
      ok: r.match === null ? "?" : r.match ? "✓" : "✗",
      answer: r.customer_answer,
    })),
  );
  if (verbose) for (const r of rows) console.log(`  ${r.source_id}: ${r.message}`);
}

// ---- CLI ----
const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  const idx = args.indexOf("--scenario");
  const pack = loadDataPack();
  const ids = args.includes("--all") || idx === -1 ? [...pack.scenarios.keys()] : [args[idx + 1]];

  const all: ReplayRow[] = [];
  for (const id of ids) {
    const rows = replayScenario(id);
    printRows(id, rows, verbose);
    all.push(...rows);
  }

  const count = (d: string) => all.filter((r) => r.decision === d).length;
  const matched = all.filter((r) => r.match).length;
  const ms = all.map((r) => r.ms).sort((a, b) => a - b);
  console.log(
    `\nTotal ${all.length} · approve ${count("approve")} · step_up ${count("step_up")} · decline ${count("decline")}` +
      ` · match ${matched}/${all.length}` +
      ` · p50 ${ms[Math.floor(ms.length / 2)]?.toFixed(2)} ms · max ${ms[ms.length - 1]?.toFixed(2)} ms`,
  );
}
