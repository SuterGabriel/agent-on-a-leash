import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { assertAuthorizationEvent, buildEvent, loadDataPack, roundHalfEven2, toChf, type EngineVerdict } from "@leash/shared";
import { OfflinePlatform } from "../src/offline/platform.js";
import { stubEngine, type Engine } from "../src/engine/port.js";
import { InMemoryDecisionStore, LeashBus, type StoredDecision } from "../src/store.js";
import { Worker } from "../src/worker.js";
import { resolveAsk, AskError } from "../src/asks.js";
import { VisecaError, type VisecaApi } from "../src/viseca/api.js";
import type { DecisionRequestEnvelope } from "@leash/shared";
import { parseLeash } from "../src/app/parseLeash.js";

const dataDir = fileURLToPath(new URL("../../../data", import.meta.url));
const pack = loadDataPack(dataDir);

const approveAll: Engine = {
  version: "test-approve",
  decide: (): EngineVerdict => ({
    decision: "approve",
    reason_codes: ["within_rules"],
    headline: "Fits all your rules",
    because: "Test engine approves everything.",
    checks: [{ key: "order_limit", label: "Each order CHF 120 or less", your_words: null, source: "you", result: "pass", fact: "test" }],
    uncertainty: [],
    shop_text_quarantine: null,
    engine_version: "test-approve",
  }),
};

async function setup(scenarioId: string, engine: Engine = stubEngine, platformOpts = {}, workerOpts = {}) {
  const platform = new OfflinePlatform(pack, platformOpts);
  const instruction = pack.scenarios.get(scenarioId)!.cardholder_instruction;
  const { hard_rules, uncertainty_policy } = parseLeash({ instruction });
  const draft = await platform.createMandate({ instruction, hard_rules, uncertainty_policy, guidance: [], open_questions: [] });
  const { mandate_id } = await platform.confirmMandate(draft.draft_id);
  const store = new InMemoryDecisionStore();
  const bus = new LeashBus();
  const worker = new Worker(platform, engine, store, bus, { pollWaitSeconds: 0, ...workerOpts });
  const run = await platform.startRun({ scenario_id: scenarioId, mandate_id });
  return { platform, store, bus, worker, run, mandate_id };
}

describe("data pack and events", () => {
  it("builds AU0001 like the connection-check fixture, and it passes the event check", () => {
    const fixture = JSON.parse(readFileSync(`${dataDir}/scenario_fixtures/connection_check.json`, "utf8"));
    const event = buildEvent(pack, pack.attempts.get("AU0001")!, {
      liveAuthorizationId: "LIVE-1",
      requestId: "req-1",
      mandate: { mandate_id: "TM-1", status: "active", customer_id: "CU0001", card_id: "CA0001", instruction: "x", hard_rules: [], uncertainty_policy: "ask", profile_id: "P" },
      relatedLiveId: null,
      context: { approved_spend_in_period_chf: 0, recent_authorizations: [] },
      receivedAt: "2026-08-09T10:04:00Z",
      deadlineAt: "2026-08-09T10:04:08Z",
    });
    expect(() => assertAuthorizationEvent(event)).not.toThrow();
    expect(event.authorization.billing_amount_chf).toBe(Number(fixture.authorization.billing_amount_chf));
    expect(event.authorization.delivery_fee).toBe(7);
    expect(event.authorization.spend_in_period_before_chf).toBeNull();
    expect(event.authorization.items[0]!.unit_price).toBe(13);
    expect(event.authorization.merchant.merchant_name).toBe("Alpine Basket");
  });

  it("rounds half-even and converts with the row's currency", () => {
    expect(roundHalfEven2(0.125)).toBe(0.12);
    expect(roundHalfEven2(0.135)).toBe(0.14);
    expect(toChf(100, "EUR", pack.fx)).toBe(95);
    expect(toChf(10, "USD", pack.fx)).toBe(8.7);
  });

  it("seeds the per-order price rule from the instruction", () => {
    expect(parseLeash({ instruction: pack.scenarios.get("SCEN0001")!.cardholder_instruction }).hard_rules[0]!.value).toBe(120);
    expect(parseLeash({ instruction: pack.scenarios.get("SCEN0000")!.cardholder_instruction }).hard_rules[0]!.value).toBe(20);
  });
});

describe("worker against the offline platform", () => {
  it("SCEN0000 end to end with the stub engine: one step_up, posted in time", async () => {
    const { store, worker, run, platform } = await setup("SCEN0000");
    await worker.runUntilDone(run.run_id);
    const rows = store.list(run.run_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.decision).toBe("step_up");
    expect(rows[0]!.status).toBe("waiting_for_you");
    expect(rows[0]!.post_status).toBe("posted");
    expect(rows[0]!.deadline_missed).toBe(false);
    expect((await platform.getRun(run.run_id)).counters!.deadline_miss).toBe(0);
    worker.stop();
  });

  it("SCEN0001: all 10 purchases decided, approved spend flows into the next event's context", async () => {
    const { store, worker, run, platform } = await setup("SCEN0001", approveAll);
    const contexts: number[] = [];
    const next = platform.nextDecisionRequest.bind(platform);
    platform.nextDecisionRequest = async (w) => {
      const env = await next(w);
      if (env) contexts.push(env.data.context.approved_spend_in_period_chf ?? -1);
      return env;
    };
    await worker.runUntilDone(run.run_id);
    expect(store.list(run.run_id)).toHaveLength(10);
    expect(contexts[0]).toBe(0);
    expect(contexts[1]).toBe(44.5); // AU0002 (44.50) approved before the second purchase
    expect((await platform.getRun(run.run_id)).status).toBe("completed");
  });

  it("a redelivered purchase is answered once and counted once", async () => {
    const { store, worker, run, platform } = await setup("SCEN0000", approveAll, { redeliver: new Set(["AU0001"]) });
    let posts = 0;
    const post = platform.postDecision.bind(platform);
    platform.postDecision = async (id, body) => {
      posts += 1;
      return post(id, body);
    };
    await worker.runUntilDone(run.run_id);
    expect(store.list(run.run_id)).toHaveLength(1);
    expect(posts).toBe(1);
  });

  it("an answered purchase delivered again backs off 2 s, 5 s, then 15 s, and is not answered twice", async () => {
    const waits: number[] = [];
    const { store, worker, run, platform } = await setup("SCEN0000", stubEngine, {}, { sleep: async (ms: number) => void waits.push(ms) });
    let posts = 0;
    const post = platform.postDecision.bind(platform);
    platform.postDecision = async (id, body) => {
      posts += 1;
      return post(id, body);
    };
    const next = platform.nextDecisionRequest.bind(platform);
    let first: DecisionRequestEnvelope | null = null;
    let repeats = 0;
    platform.nextDecisionRequest = async (w) => {
      if (!first) return (first = await next(w));
      if (repeats < 4) {
        repeats += 1;
        return { ...first, status: "pending_step_up" };
      }
      return next(w);
    };
    await worker.runUntilDone(run.run_id);
    expect(waits).toEqual([2000, 5000, 15000, 15000]);
    expect(posts).toBe(1);
    expect(store.list(run.run_id)).toHaveLength(1);
    worker.stop();
  });

  it("the backoff never sleeps past the end of the customer's answer window", async () => {
    const waits: number[] = [];
    const { worker, run, platform } = await setup("SCEN0000", stubEngine, { humanWindowMs: 3000 }, { sleep: async (ms: number) => void waits.push(ms) });
    const next = platform.nextDecisionRequest.bind(platform);
    let first: DecisionRequestEnvelope | null = null;
    let repeats = 0;
    platform.nextDecisionRequest = async (w) => {
      if (!first) return (first = await next(w));
      if (repeats < 3) {
        repeats += 1;
        return { ...first, status: "pending_step_up" };
      }
      return next(w);
    };
    await worker.runUntilDone(run.run_id);
    expect(waits[0]).toBe(2000);
    expect(waits.slice(1).every((w) => w > 0 && w <= 3000)).toBe(true);
    worker.stop();
  });

  it("engine error → step_up, never approve", async () => {
    const broken: Engine = { version: "broken", decide: () => { throw new Error("boom"); } };
    const { store, worker, run } = await setup("SCEN0000", broken);
    await worker.runUntilDone(run.run_id);
    const d = store.list(run.run_id)[0]!;
    expect(d.decision).toBe("step_up");
    expect(d.reason_codes).toContain("engine_error");
    worker.stop();
  });

  it("slow engine → step_up before the deadline", async () => {
    const slow: Engine = { version: "slow", decide: () => new Promise<EngineVerdict>(() => {}) };
    const { store, worker, run } = await setup("SCEN0000", slow, {}, { engineBudgetMs: 100 });
    await worker.runUntilDone(run.run_id);
    const d = store.list(run.run_id)[0]!;
    expect(d.reason_codes).toContain("engine_timeout");
    expect(d.deadline_missed).toBe(false);
    worker.stop();
  });

  it("a failed post is retried once", async () => {
    const { store, worker, run, platform } = await setup("SCEN0000");
    let calls = 0;
    const post = platform.postDecision.bind(platform);
    platform.postDecision = async (id, body) => {
      calls += 1;
      if (calls === 1) throw new VisecaError(503, { message: "busy" });
      return post(id, body);
    };
    await worker.runUntilDone(run.run_id);
    expect(calls).toBe(2);
    expect(store.list(run.run_id)[0]!.post_status).toBe("posted");
    worker.stop();
  });
});

describe("customer answers (S6)", () => {
  it("approve after step_up goes through /resolve and counts as approved spend", async () => {
    const { store, bus, worker, run, platform } = await setup("SCEN0000");
    await worker.runUntilDone(run.run_id);
    const id = store.list(run.run_id)[0]!.id;
    const d = await resolveAsk(platform as VisecaApi, store, bus, id, "approve");
    expect(d.status).toBe("approved_by_you");
    expect((await platform.getRun(run.run_id)).counters!.approved).toBe(1);
    await expect(resolveAsk(platform, store, bus, id, "decline")).rejects.toBeInstanceOf(AskError);
    worker.stop();
  });

  it("an unanswered ask expires and emits ask_expired", async () => {
    const { store, bus, worker, run } = await setup("SCEN0000", stubEngine, { humanWindowMs: 30 }, { humanWindowMs: 30 });
    const expired: StoredDecision[] = [];
    bus.on("ask_expired", (d) => expired.push(d));
    await worker.runUntilDone(run.run_id);
    await new Promise((r) => setTimeout(r, 80));
    expect(expired).toHaveLength(1);
    expect(store.list(run.run_id)[0]!.status).toBe("expired");
  });
});

describe("mandate rules on the offline platform", () => {
  it("allows adding rules and ask → decline, refuses removing rules and loosening", async () => {
    const { platform, mandate_id } = await setup("SCEN0001");
    const current = await platform.getMandate(mandate_id);
    const extra = { field: "items.item_category", operator: "not_in" as const, value: ["cosmetics"] };
    await platform.patchMandate(mandate_id, { hard_rules: [...current.hard_rules, extra] });
    await expect(platform.patchMandate(mandate_id, { hard_rules: [extra] })).rejects.toBeInstanceOf(VisecaError);
    await platform.patchMandate(mandate_id, { uncertainty_policy: "decline" });
    await expect(platform.patchMandate(mandate_id, { uncertainty_policy: "ask" })).rejects.toBeInstanceOf(VisecaError);
  });

  it("a PATCH does not change a running run's snapshot, but the worker sees the current mandate", async () => {
    let seen: unknown = null;
    const spy: Engine = { version: "spy", decide: (e, ctx) => { seen = { snapshot: e.mandate.uncertainty_policy, current: ctx.currentMandate?.uncertainty_policy }; return approveAll.decide(e, ctx); } };
    const { worker, run, platform, mandate_id } = await setup("SCEN0000", spy);
    await platform.patchMandate(mandate_id, { uncertainty_policy: "decline" });
    worker.invalidateMandate(mandate_id);
    await worker.runUntilDone(run.run_id);
    expect(seen).toEqual({ snapshot: "ask", current: "decline" });
  });

  it("a revoked mandate cannot start a run", async () => {
    const { platform, mandate_id } = await setup("SCEN0000");
    await platform.revokeMandate(mandate_id);
    await expect(platform.startRun({ scenario_id: "SCEN0000", mandate_id })).rejects.toBeInstanceOf(VisecaError);
  });
});
