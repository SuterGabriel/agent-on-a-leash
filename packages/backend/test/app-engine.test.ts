import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadDataPack } from "@leash/shared";
import { OfflinePlatform } from "../src/offline/platform.js";
import { LeashService } from "../src/leash/service.js";
import { LeashEngine } from "../src/engine/leashEngine.js";

// The app path end to end: the compiler creates the leash (as POST /api/runs does), Ara's engine decides.
// This broke once (28/45) because the two used different hard_rule field names.

const dataDir = fileURLToPath(new URL("../../../data", import.meta.url));
const pack = loadDataPack(dataDir);
const expected = new Map(
  readFileSync(`${dataDir}/reference_decisions.csv`, "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(","))
    .map((c) => [c[0] as string, c[2] as string]),
);

async function runScenario(scenarioId: string) {
  const engine = new LeashEngine();
  const service = new LeashService({ api: new OfflinePlatform(pack), pack, engine, mode: "offline", worker: { pollWaitSeconds: 0 } });
  engine.follow(service.bus);
  const run = await service.startRun(scenarioId);
  await service.waitForRun(run.run_id);
  service.worker.stop();
  return service.feed(run.run_id);
}

describe("app path: compiler → mandate → worker → Ara's engine", () => {
  it("all 45 automated decisions match the reference, and no rule goes unread", async () => {
    const mismatches: string[] = [];
    let total = 0;
    for (const id of ["SCEN0000", "SCEN0001", "SCEN0002", "SCEN0003", "SCEN0004"]) {
      for (const d of await runScenario(id)) {
        total += 1;
        if (expected.get(d.source_authorization_id) !== d.decision) mismatches.push(`${d.source_authorization_id}: ${d.decision} ≠ ${expected.get(d.source_authorization_id)}`);
        expect(d.reason_codes, d.source_authorization_id).not.toContain("rule_not_applied");
      }
    }
    expect(total).toBe(45);
    expect(mismatches).toEqual([]);
  });

  it("the engine's checks carry the customer's own words", async () => {
    const first = (await runScenario("SCEN0001")).find((d) => d.source_authorization_id === "AU0002")!;
    expect(first.checks.find((c) => c.key === "per_order_limit")!.your_words).toBe("each order at or below CHF 120 including delivery");
    expect(first.checks.find((c) => c.key === "period_budget")!.your_words).toBe("keep the total across any seven days at or below CHF 300");
    expect(first.checks.find((c) => c.key === "item_scope")!.your_words).toBe("household groceries");
  });

  it("approved purchases get a token, the rest don't", async () => {
    const rows = await runScenario("SCEN0004");
    for (const d of rows) expect(!!d.token, d.source_authorization_id).toBe(d.decision === "approve");
  });
});
