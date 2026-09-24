import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataPack, scenarioAttempts } from "../packages/shared/src/loaders";
import { buildEvent } from "../packages/shared/src/csvEvent";
import { compilePolicy, toHardRules } from "../packages/shared/src/compiler";
import { toChf } from "../packages/shared/src/fxRates";
import { decide } from "../packages/engine/src/decide";
import { Ledger } from "../packages/engine/src/ledger";
import { limitBand } from "../packages/engine/src/guards/limitBand";
import { getBaselines, replayScenario } from "../packages/engine/src/replay";
import type { Guard } from "../packages/engine/src/types";

const pack = loadDataPack();
const GROCERIES =
  "Order our household groceries for delivery. Keep each order at or below CHF 120 including delivery, and keep the total across any seven days at or below CHF 300. Ask me when uncertain.";

function setup(instruction = GROCERIES) {
  const policy = compilePolicy(instruction);
  const mandate = { mandate_id: "TM_test", instruction, hard_rules: toHardRules(policy), uncertainty_policy: policy.uncertainty };
  return { policy, mandate, ledger: new Ledger() };
}

describe("compiler", () => {
  it("reads per-order and rolling 7-day limits", () => {
    const p = compilePolicy(GROCERIES);
    expect(p.perOrderLimitChf).toBe(120);
    expect(p.periodLimit).toEqual({ amountChf: 300, days: 7 });
    expect(p.allowedCategories).toEqual(["groceries"]);
    expect(p.uncertainty).toBe("ask");
  });
  it("reads 'up to CHF 250 per order'", () => {
    expect(compilePolicy("The agent may buy clothing for me, up to CHF 250 per order.").perOrderLimitChf).toBe(250);
  });
});

describe("boundaries", () => {
  it("exactly at the limit approves", () => expect(limitBand(120, 120, 0.1)).toBe("PASS"));
  it("up to 10 % over asks", () => expect(limitBand(132, 120, 0.1)).toBe("STEP_UP"));
  it("more than 10 % over declines", () => expect(limitBand(132.01, 120, 0.1)).toBe("DECLINE"));
  it("FX uses the fixed rates", () => {
    expect(toChf(260, "EUR")).toBe(247);
    expect(toChf(450, "USD")).toBe(391.5);
    expect(toChf(219, "GBP")).toBe(245.28);
  });
});

describe("state", () => {
  it("same live ID twice -> same answer, counted once", () => {
    const { policy, mandate, ledger } = setup();
    const attempt = scenarioAttempts(pack, "SCEN0001")[0];
    const ev = buildEvent(pack, attempt, mandate, "r1");
    const a = decide(ev, policy, ledger, getBaselines());
    const b = decide(ev, policy, ledger, getBaselines());
    expect(b.decision).toBe(a.decision);
    expect(b.replayed).toBe(true);
    expect(ledger.all()).toHaveLength(1);
  });

  it("a pending step_up does not count as spend; approving it does", () => {
    const { policy, mandate, ledger } = setup();
    const attempts = scenarioAttempts(pack, "SCEN0001");
    const r = decide(buildEvent(pack, attempts[2], mandate, "r2"), policy, ledger, getBaselines()); // 126 CHF -> step_up
    expect(r.decision).toBe("step_up");
    expect(ledger.approvedInWindow(Date.parse(attempts[2].timestamp), 7)).toHaveLength(0);
    ledger.resolve(r.authorization_id, "approve");
    expect(ledger.approvedInWindow(Date.parse(attempts[2].timestamp), 7)).toHaveLength(1);
  });
});

describe("fail closed", () => {
  it("a guard that throws gives at least step_up", () => {
    const { policy, mandate, ledger } = setup();
    const boom: Guard = () => {
      throw new Error("boom");
    };
    const ev = buildEvent(pack, scenarioAttempts(pack, "SCEN0001")[0], mandate, "r3");
    expect(decide(ev, policy, ledger, getBaselines(), [boom]).decision).toBe("step_up");
  });
});

describe("replay against the oracle", () => {
  it("all 45 public purchases match", () => {
    for (const id of ["SCEN0000", "SCEN0001", "SCEN0002", "SCEN0003", "SCEN0004"]) {
      for (const row of replayScenario(id)) expect(row.decision, row.source_id).toBe(row.expected);
    }
  });
});

describe("no hard-coding", () => {
  it("engine and compiler code never mention scenario or purchase IDs (public or live)", () => {
    const dir = path.resolve(__dirname, "../packages/engine/src");
    const files = (d: string): string[] =>
      readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? files(path.join(d, f)) : [path.join(d, f)]));
    const shared = ["compiler.ts", "baselines.ts"].map((f) => path.resolve(__dirname, "../packages/shared/src", f));
    for (const f of [...files(dir).filter((f) => !f.endsWith("replay.ts")), ...shared]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/SCEN\d{2}|AU\d{3}/);
    }
  });
});
