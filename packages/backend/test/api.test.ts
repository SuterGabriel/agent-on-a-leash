import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { loadDataPack, type ChargeResult, type DecisionToken, type EngineVerdict, type LeashView } from "@leash/shared";
import { OfflinePlatform } from "../src/offline/platform.js";
import { LeashService } from "../src/leash/service.js";
import { createLeashServer } from "../src/http/server.js";
import type { Engine } from "../src/engine/port.js";
import type { StoredDecision } from "../src/store.js";

// End-to-end through HTTP against the offline platform, with a tiny stand-in for Ara's engine.

const pack = loadDataPack(fileURLToPath(new URL("../../../data", import.meta.url)));
const SCEN0001 = pack.scenarios.get("SCEN0001")!.cardholder_instruction;

const testEngine: Engine = {
  version: "test-rules-0",
  decide: (event): EngineVerdict => {
    const a = event.authorization;
    const limit = Math.min(...event.mandate.hard_rules.filter((r) => r.scope === "purchase").map((r) => Number(r.value)));
    const outside = a.items.filter((i) => i.item_category !== "groceries");
    const overLimit = a.billing_amount_chf > limit;
    const checks = [
      { key: "order_limit", label: `Each order CHF ${limit} or less`, your_words: null, source: "you" as const, result: overLimit ? ("fail" as const) : ("pass" as const), fact: `CHF ${a.billing_amount_chf.toFixed(2)}` },
      { key: "purpose", label: "Groceries only", your_words: null, source: "you" as const, result: outside.length ? ("fail" as const) : ("pass" as const), fact: outside.map((i) => i.item_name).join(", ") || null },
      { key: "shop_text", label: "Shop text can't change your rules", your_words: null, source: "built_in" as const, result: "pass" as const, fact: null },
    ];
    const reason = overLimit ? "over_order_limit" : outside.length ? "item_outside_purpose" : null;
    return {
      decision: reason ? "step_up" : "approve",
      reason_codes: reason ? [reason] : ["within_rules"],
      headline: reason ? "Not sure this fits" : "Fits all your rules",
      because: reason ? "Something in this order doesn't fit your leash." : "This order fits all your rules.",
      checks,
      uncertainty: [],
      shop_text_quarantine: null,
      engine_version: "test-rules-0",
    };
  },
};

let server: Server;
let base: string;
let service: LeashService;
let platform: OfflinePlatform;
const events: { event: string; data: unknown }[] = [];
const streamAbort = new AbortController();

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as T };
}

async function listen() {
  const res = await fetch(`${base}/app/stream`, { signal: streamAbort.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  void (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
        }
      }
    } catch {
      // aborted at the end of the test
    }
  })();
}

beforeAll(async () => {
  platform = new OfflinePlatform(pack);
  service = new LeashService({ api: platform, pack, engine: testEngine, mode: "offline", worker: { pollWaitSeconds: 0 } });
  server = createLeashServer(service, { heartbeatMs: 60_000 });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  await listen();
});

afterAll(async () => {
  streamAbort.abort();
  service.worker.stop();
  await new Promise((r) => server.close(r));
});

describe("app API, offline end to end", () => {
  it("S1–S3: parse, refuse without Face ID, confirm with answers", async () => {
    expect((await call<LeashView>("GET", "/app/leash")).body.status).toBe("none");

    const parsed = await call<{ rules: { key: string }[]; open_questions: { id: string }[] }>("POST", "/app/leash/parse", { instruction: SCEN0001 });
    expect(parsed.status).toBe(200);
    expect(parsed.body.rules).toHaveLength(4);
    expect(parsed.body.open_questions.map((q) => q.id)).toEqual(["q_split_orders"]);

    const refused = await call<{ error: { code: string } }>("POST", "/app/leash", { instruction: SCEN0001, confirmed: false });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("confirmation_required");

    const created = await call<LeashView>("POST", "/app/leash", { instruction: SCEN0001, confirmed: true, answers: { q_split_orders: "Yes" } });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ status: "active", token: "on" });
    expect(created.body.rules.map((r) => r.key)).toContain("split_orders");
    expect(created.body.built_in).toHaveLength(4);
  });

  it("S4–S6: a run fills the feed, asks carry the customer's words, the budget counts approvals", async () => {
    const started = await call<{ run_id: string }>("POST", "/api/runs", { scenario_id: "SCEN0001", use_current_leash: true });
    expect(started.status).toBe(202);
    await service.waitForRun(started.body.run_id);

    const feed = await call<StoredDecision[]>("GET", "/app/feed");
    expect(feed.body).toHaveLength(10);
    const asks = await call<StoredDecision[]>("GET", "/app/asks");
    expect(asks.body.length).toBeGreaterThan(0);

    const card = await call<StoredDecision>("GET", `/app/decisions/${asks.body[0]!.id}`);
    const orderCheck = card.body.checks.find((c) => c.key === "order_limit")!;
    expect(orderCheck.your_words).toBe("each order at or below CHF 120 including delivery");
    expect(card.body.checks.find((c) => c.key === "shop_text")!.your_words).toBeNull();

    const leash = (await call<LeashView>("GET", "/app/leash")).body;
    expect(leash.card).toEqual({ id: "CA0001", label: "Debit card •• 0001" });
    expect(leash.budget!.limit_chf).toBe(300);
    expect(leash.budget!.spent_chf).toBeGreaterThan(0);
    expect(leash.budget!.left_chf).toBeCloseTo(Math.max(0, 300 - leash.budget!.spent_chf), 2); // the test engine ignores the weekly budget, so it can overshoot
    expect(leash.budget!.next_release).not.toBeNull();
    expect(leash.known_shops.some((s) => s.name === "Alpine Basket")).toBe(true);

    expect(events.some((e) => e.event === "decision")).toBe(true);
    expect(events.some((e) => e.event === "ask")).toBe(true);
  });

  it("D1: declining the cosmetics basket offers 'Never buy cosmetics', accepting adds a learned rule at Viseca", async () => {
    const asks = (await call<StoredDecision[]>("GET", "/app/asks")).body;
    const cosmetics = asks.find((d) => d.items.some((i) => i.category === "cosmetics"))!;
    expect(cosmetics).toBeDefined();

    const resolved = await call<StoredDecision>("POST", `/app/asks/${cosmetics.id}/resolve`, { decision: "decline" });
    expect(resolved.body.status).toBe("declined_by_you");
    expect(resolved.body.suggestion!.text).toBe("Never buy cosmetics");

    const again = await call<{ error: { code: string } }>("POST", `/app/asks/${cosmetics.id}/resolve`, { decision: "approve" });
    expect(again.status).toBe(409);

    const accepted = await call<LeashView>("POST", `/app/suggestions/${resolved.body.suggestion!.id}/accept`);
    expect(accepted.body.learned_rules[0]).toMatchObject({ source: "learned", label: "Never buy cosmetics" });
    expect((await platform.getMandate(accepted.body.mandate_id!)).hard_rules).toContainEqual({ field: "items.item_category", operator: "not_in", value: ["cosmetics"] });
  });

  it("S8: tighten only ever tightens", async () => {
    const lower = await call<LeashView>("PATCH", "/app/leash/rules", { type: "lower_order_limit", value: 100 });
    expect(lower.body.rules.filter((r) => r.key === "order_limit").map((r) => r.label)).toEqual(["Each order CHF 100 or less"]);

    const looser = await call<{ error: { code: string } }>("PATCH", "/app/leash/rules", { type: "lower_order_limit", value: 150 });
    expect(looser.status).toBe(400);
    expect(looser.body.error.code).toBe("not_tighter");

    const blocked = await call<LeashView>("PATCH", "/app/leash/rules", { type: "block_shop", merchant_id: "ME0001" });
    expect(blocked.body.rules.at(-1)!.label).toBe("Never buy from Alpine Basket");

    const unsure = await call<LeashView>("PATCH", "/app/leash/rules", { type: "unsure_decline" });
    expect(unsure.body.uncertainty_policy).toBe("decline");
    const stored = await platform.getMandate(unsure.body.mandate_id!);
    expect(stored.uncertainty_policy).toBe("decline");
    expect(stored.hard_rules).toContainEqual({ field: "merchant.merchant_id", operator: "not_in", value: ["ME0001"] });
    expect(events.some((e) => e.event === "leash_changed")).toBe(true);
  });

  it("pause declines everything, resume lifts it", async () => {
    const paused = await call<LeashView>("POST", "/app/leash/pause", { hours: 24 });
    expect(paused.body).toMatchObject({ status: "paused", token: "off" });
    const run = await call<{ run_id: string }>("POST", "/api/runs", { scenario_id: "SCEN0000", use_current_leash: true });
    await service.waitForRun(run.body.run_id);
    const rows = (await call<StoredDecision[]>("GET", `/app/feed?run_id=${run.body.run_id}`)).body;
    expect(rows.every((d) => d.decision === "decline" && d.reason_codes.includes("leash_paused"))).toBe(true);
    expect((await call<LeashView>("POST", "/app/leash/resume")).body.status).toBe("active");
  });

  it("judge view summarises the run", async () => {
    const judge = await call<{ summary: { approved: number; asked: number; declined: number; deadline_misses: number }; rows: unknown[] }>("GET", "/judge/decisions");
    expect(judge.body.rows.length).toBeGreaterThan(0);
    expect(judge.body.summary.deadline_misses).toBe(0);
  });

  it("tokens: every approval gets one; a fooled agent can't pay elsewhere, more, later or twice", async () => {
    const feed = (await call<StoredDecision[]>("GET", "/app/feed")).body;
    const approved = feed.filter((d) => d.status === "approved");
    expect(approved.length).toBeGreaterThan(1);
    expect(approved.every((d) => d.token?.status === "active")).toBe(true);
    expect(feed.filter((d) => d.status === "waiting_for_you").every((d) => !d.token)).toBe(true);
    // Tokens respect the leash: never above the CHF 120 per order that was active when they were issued.
    expect(approved.every((d) => d.token!.max_chf <= Math.max(120, d.amount.chf))).toBe(true);

    const tokens = (await call<DecisionToken[]>("GET", "/app/tokens")).body;
    const [a, b] = approved.map((d) => d.token!.id);
    expect(tokens.map((t) => t.id)).toEqual(expect.arrayContaining([a, b]));

    const charge = (id: string, body: object) => call<ChargeResult>("POST", `/demo/tokens/${id}/charge`, body);
    expect((await charge(a!, { merchant_id: "ME0099" })).body.code).toBe("wrong_merchant");
    expect((await charge(a!, { amount_chf: 900 })).body.code).toBe("over_amount");
    expect((await charge(a!, {})).body).toMatchObject({ ok: true, code: "charged" });
    expect((await charge(a!, {})).body.code).toBe("token_used");
    expect((await call<ChargeResult>("POST", `/demo/tokens/${a}/refund`, {})).body.code).toBe("refunded");
    expect((await charge(b!, { later: true })).body.code).toBe("token_expired");

    const decision = (await call<StoredDecision>("GET", `/app/decisions/${approved[0]!.id}`)).body;
    expect(decision.token!.history.map((h) => h.type)).toEqual(["issued", "declined", "declined", "charged", "declined", "refunded"]);
    expect(events.some((e) => e.event === "token")).toBe(true);
    expect((await call("GET", "/app/tokens/tok_demo_nope")).status).toBe(404);
  });

  it("S9: revoke turns the token off and stops new runs", async () => {
    const activeBefore = (await call<DecisionToken[]>("GET", "/app/tokens")).body.filter((t) => t.status === "active");
    expect(activeBefore.length).toBeGreaterThan(0);
    const revoked = await call<LeashView>("DELETE", "/app/leash");
    expect(revoked.body).toMatchObject({ status: "revoked", token: "off" });
    const after = (await call<DecisionToken[]>("GET", "/app/tokens")).body;
    expect(after.filter((t) => t.status === "active")).toEqual([]);
    expect((await call<ChargeResult>("POST", `/demo/tokens/${activeBefore[0]!.id}/charge`, {})).body.code).toBe("token_revoked");
    const blocked = await call<{ error: { code: string } }>("POST", "/api/runs", { scenario_id: "SCEN0000", use_current_leash: true });
    expect(blocked.status).toBe(409);
  });

  it("unknown routes and methods", async () => {
    expect((await call("GET", "/nope")).status).toBe(404);
    expect((await call("PUT", "/app/leash")).status).toBe(405);
  });
});
