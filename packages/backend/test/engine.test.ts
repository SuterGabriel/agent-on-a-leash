import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { buildEvent, loadDataPack, type EventMandate } from "@leash/shared";
import { readCsv } from "../../shared/src/loaders.js";
import { OfflinePlatform } from "../src/offline/platform.js";
import { LeashEngine, policyFor, trackRecordCheck } from "../src/engine/leashEngine.js";
import { buildBaselines } from "../../shared/src/baselines.js";
import { InMemoryDecisionStore, LeashBus } from "../src/store.js";
import { Worker } from "../src/worker.js";
import { resolveAsk } from "../src/asks.js";
import { parseLeash } from "../src/app/parseLeash.js";

const dataDir = fileURLToPath(new URL("../../../data", import.meta.url));
const pack = loadDataPack(dataDir);
const instructionOf = (id: string) => pack.scenarios.get(id)!.cardholder_instruction;

function mandate(scenarioId: string, over: Partial<EventMandate> = {}): EventMandate {
  const { hard_rules, uncertainty_policy } = parseLeash({ instruction: instructionOf(scenarioId) });
  return { mandate_id: "TM-1", status: "active", customer_id: "CU0001", card_id: "CA0001", instruction: instructionOf(scenarioId), hard_rules, uncertainty_policy, profile_id: "P", ...over };
}

describe("the stricter of the frozen and the current mandate", () => {
  it("the snapshot's own rules change nothing", () => {
    const { policy, notApplied } = policyFor(mandate("SCEN0001"), mandate("SCEN0001"));
    expect(policy.perOrderLimitChf).toBe(120);
    expect(policy.periodLimit).toEqual({ amountChf: 300, days: 7 });
    expect(notApplied).toEqual([]);
  });

  it("a lower limit wins from either side; a higher one never loosens", () => {
    const lower = (m: EventMandate) => ({ ...m, hard_rules: [...m.hard_rules, { field: "authorization.billing_amount_chf", operator: "<=" as const, value: 80, currency: "CHF" as const, scope: "purchase" as const }] });
    const higher = (m: EventMandate) => ({ ...m, hard_rules: [{ field: "authorization.billing_amount_chf", operator: "<=" as const, value: 500, currency: "CHF" as const, scope: "purchase" as const }] });
    expect(policyFor(mandate("SCEN0001"), lower(mandate("SCEN0001"))).policy.perOrderLimitChf).toBe(80);
    expect(policyFor(lower(mandate("SCEN0001")), mandate("SCEN0001")).policy.perOrderLimitChf).toBe(80);
    expect(policyFor(mandate("SCEN0001"), higher(mandate("SCEN0001"))).policy.perOrderLimitChf).toBe(120);
  });

  it("uncertainty: decline beats ask, approve never loosens ask", () => {
    expect(policyFor(mandate("SCEN0001"), mandate("SCEN0001", { uncertainty_policy: "decline" })).policy.uncertainty).toBe("decline");
    expect(policyFor(mandate("SCEN0001"), mandate("SCEN0001", { uncertainty_policy: "approve" })).policy.uncertainty).toBe("ask");
  });

  it("every rule the compiler writes is understood when it comes back in a mandate", () => {
    const instruction = "Up to EUR 60 per night, at most two bookings per week, weekdays only. No gift cards, no insurance. Refundable only. Ask me when unsure.";
    const { hard_rules, uncertainty_policy } = parseLeash({ instruction });
    const m = { ...mandate("SCEN0001"), instruction, hard_rules, uncertainty_policy };
    const { policy, notApplied } = policyFor(m, m);
    expect(notApplied).toEqual([]);
    expect(policy.perUnitLimit?.amountChf).toBe(57);
    expect(policy.maxOrdersPerPeriod).toEqual({ count: 2, days: 7 });
    expect(policy.blockedCategories).toContain("gift_card");
    expect(policy.refundableRequired).toBe(true);
  });

  it("two different period limits merge into one stricter than both", () => {
    const m = mandate("SCEN0001");
    const monthly = { ...m, hard_rules: [{ field: "authorization.billing_amount_chf", operator: "<=" as const, value: 250, currency: "CHF" as const, scope: "period" as const, period_days: 30 }] };
    expect(policyFor(m, monthly).policy.periodLimit).toEqual({ amountChf: 250, days: 30 });
  });
});

describe("LeashEngine through the worker port", () => {
  const snapshot = mandate("SCEN0000");
  const event = () => buildEvent(pack, pack.attempts.get("AU0001")!, {
    liveAuthorizationId: `LIVE-${Math.random()}`,
    requestId: "req-1",
    mandate: snapshot,
    relatedLiveId: null,
    context: { approved_spend_in_period_chf: 0, recent_authorizations: [] },
    receivedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 8000).toISOString(),
  });
  const engine = new LeashEngine();

  it("approves AU0001 with the app's format: headline, because, one check per guard that ran", () => {
    const v = engine.decide(event(), { runId: "r1", currentMandate: null });
    expect(v.decision).toBe("approve");
    expect(v.reason_codes).toEqual(["all_checks_passed"]);
    expect(v.headline).toBeTruthy();
    expect(v.because).toContain("within your rules");
    expect(v.checks.map((c) => c.key)).toContain("per_order_limit");
    expect(v.checks.every((c) => c.result === "pass")).toBe(true);
  });

  it("a rule the engine cannot express is never ignored: it asks", () => {
    const extra = { field: "merchant.rating", operator: ">=" as const, value: 4 };
    const v = engine.decide(event(), { runId: "r2", currentMandate: { ...snapshot, hard_rules: [...snapshot.hard_rules, extra] } });
    expect(v.decision).toBe("step_up");
    expect(v.reason_codes).toEqual(["rule_not_applied"]);
  });

  it("a revoked current mandate declines", () => {
    const v = engine.decide(event(), { runId: "r3", currentMandate: { ...snapshot, status: "revoked" } });
    expect(v.decision).toBe("decline");
  });
});

describe("shop track record (issuer history, display only)", () => {
  const rows = (merchant: string, purchases: number, refunds: number) => [
    ...Array.from({ length: purchases }, () => ({ merchant_id: merchant, transaction_type: "purchase", status: "approved", card_id: "CA1", customer_id: "CU1", timestamp: "2025-09-01T10:00:00Z" })),
    ...Array.from({ length: refunds }, () => ({ merchant_id: merchant, transaction_type: "refund", status: "approved", card_id: "CA1", customer_id: "CU1", timestamp: "2025-09-01T10:00:00Z" })),
  ];
  const base = buildBaselines([...rows("ME_OK", 100, 1), ...rows("ME_REFUNDS", 40, 3), ...rows("ME_SMALL", 5, 2)], new Map());

  it("a shop with a normal refund share passes, with the numbers as the fact", () => {
    expect(trackRecordCheck("ME_OK", base)).toMatchObject({ key: "shop_track_record", source: "built_in", result: "pass", fact: "1 refund in 100 payments" });
  });

  it("5% refunds or more over 20+ payments is marked unsure", () => {
    expect(trackRecordCheck("ME_REFUNDS", base)?.result).toBe("unsure");
  });

  it("too few payments to judge is never unsure; no history at all shows no check", () => {
    expect(trackRecordCheck("ME_SMALL", base)?.result).toBe("pass");
    expect(trackRecordCheck("ME_UNKNOWN", base)).toBeNull();
  });

  it("is added to the card without touching the decision", () => {
    const e = buildEvent(pack, pack.attempts.get("AU0001")!, {
      liveAuthorizationId: "LIVE-track", requestId: "req-t", mandate: mandate("SCEN0000"), relatedLiveId: null,
      context: { approved_spend_in_period_chf: 0, recent_authorizations: [] },
      receivedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 8000).toISOString(),
    });
    const v = new LeashEngine().decide(e, { runId: "r-track", currentMandate: null });
    expect(v.decision).toBe("approve");
    expect(v.reason_codes).toEqual(["all_checks_passed"]);
    expect(v.checks.find((c) => c.key === "shop_track_record")?.fact).toMatch(/^\d+ refunds? in \d+ payments$/);
  });
});

describe("backend + real engine on the offline platform", () => {
  const oracle = new Map(readCsv("reference_decisions.csv").map((r) => [r.authorization_id, r]));

  it("all 45 public purchases match the reference, with asks answered as the reference assumes", async () => {
    const mismatches: string[] = [];
    for (const scenarioId of pack.scenarios.keys()) {
      const platform = new OfflinePlatform(pack);
      const { hard_rules, uncertainty_policy } = parseLeash({ instruction: instructionOf(scenarioId) });
      const draft = await platform.createMandate({ instruction: instructionOf(scenarioId), hard_rules, uncertainty_policy, guidance: [], open_questions: [] });
      const { mandate_id } = await platform.confirmMandate(draft.draft_id);
      const store = new InMemoryDecisionStore();
      const bus = new LeashBus();
      const worker = new Worker(platform, new LeashEngine(bus), store, bus, { pollWaitSeconds: 0 });
      const run = await platform.startRun({ scenario_id: scenarioId, mandate_id });

      // One purchase at a time, and the customer answers before the next one arrives (as in the engine's replay).
      for (let env = await platform.nextDecisionRequest(0); env; env = await platform.nextDecisionRequest(0)) {
        const d = await worker.handle(env);
        const ref = oracle.get(d.source_authorization_id);
        expect(d.post_status, d.source_authorization_id).toBe("posted");
        if (d.decision !== ref?.expected_decision) mismatches.push(`${d.source_authorization_id}: ${d.decision} ≠ ${ref?.expected_decision}`);
        if (d.decision === "step_up") await resolveAsk(platform, store, bus, d.id, ref?.assumed_customer_answer === "approve" ? "approve" : "decline");
      }
      expect(store.list(run.run_id)).toHaveLength(Number(pack.scenarios.get(scenarioId)!.event_count));
      worker.stop();
    }
    expect(mismatches).toEqual([]);
  });
});
