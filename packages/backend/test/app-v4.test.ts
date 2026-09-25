import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { loadDataPack, type AppDecision, type AppFeedResponse, type AppLeash, type AppSuggestResponse, type ParseResult } from "@leash/shared";
import { OfflinePlatform } from "../src/offline/platform.js";
import { LeashService } from "../src/leash/service.js";
import { createLeashServer } from "../src/http/server.js";
import { LeashEngine } from "../src/engine/leashEngine.js";
import { analyzeCard, instructionFromCard } from "../src/leash/cardLeash.js";

// The v4 app contract (app-web) end to end: card set up from numbers, the task arriving with a run,
// decisions in the app's shape on feed and stream, answers and learned rules, tighten / loosen, pause, off.

const pack = loadDataPack(fileURLToPath(new URL("../../../data", import.meta.url)));

let server: Server;
let base: string;
let service: LeashService;
const events: { event: string; data: Record<string, unknown> }[] = [];
const streamAbort = new AbortController();

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (res.status === 204 ? undefined : await res.json()) as T };
}

async function listen() {
  const res = await fetch(`${base}/v4/app/stream`, { signal: streamAbort.signal });
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
      // aborted at the end
    }
  })();
}

const SMART = { unsure: "ask", night: "decline", newShops: "ask", learn: "on" } as const;

/** Stream frames travel over the loopback after the HTTP answer; give them a moment. */
const settle = () => new Promise((r) => setTimeout(r, 60));

beforeAll(async () => {
  const platform = new OfflinePlatform(pack);
  const engine = new LeashEngine();
  service = new LeashService({ api: platform, pack, engine, mode: "offline", worker: { pollWaitSeconds: 0 } });
  engine.follow(service.bus);
  server = createLeashServer(service, { heartbeatMs: 60_000 });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await listen();
});

afterAll(async () => {
  streamAbort.abort();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("card rules as an instruction", () => {
  it("compiles into an order limit, a 30-day budget and the uncertainty policy", () => {
    const text = instructionFromCard({ orderLimit: 300, monthBudget: 1500 }, { unsure: "ask", newShops: "known" });
    const parsed = service.parse(text);
    const byKey = Object.fromEntries(parsed.rules.map((r) => [r.key, r.hard_rule]));
    expect(byKey.order_limit).toMatchObject({ operator: "<=", value: 300, scope: "purchase" });
    expect(byKey.period_budget).toMatchObject({ operator: "<=", value: 1500, scope: "period", period_days: 30 });
    expect(byKey.known_shop).toBeTruthy();
    expect(parsed.uncertainty_policy).toBe("ask");
    expect(service.parse(instructionFromCard({ orderLimit: 300, monthBudget: 1500 }, { unsure: "decline", newShops: "ask" })).uncertainty_policy).toBe("decline");
  });

  it("proposes rounded values from the card's history with evidence", () => {
    const rows = [
      { card_id: "CA1", status: "approved", transaction_type: "purchase", timestamp: "2026-08-01T10:00:00Z", billing_amount_chf: "40", merchant_id: "M1", merchant_name: "Shop A", merchant_category: "books" },
      { card_id: "CA1", status: "approved", transaction_type: "purchase", timestamp: "2026-08-20T23:30:00Z", billing_amount_chf: "266", merchant_id: "M2", merchant_name: "Shop B", merchant_category: "electronics" },
      { card_id: "CA1", status: "declined", transaction_type: "purchase", timestamp: "2026-08-21T10:00:00Z", billing_amount_chf: "900", merchant_id: "M2", merchant_name: "Shop B", merchant_category: "electronics" },
      { card_id: "CA2", status: "approved", transaction_type: "purchase", timestamp: "2026-08-21T10:00:00Z", billing_amount_chf: "900", merchant_id: "M3", merchant_name: "Other card", merchant_category: "dining" },
    ];
    const s = analyzeCard(rows, "CA1", { until: Date.parse("2026-09-01T00:00:00Z") });
    expect(s.analysis).toMatchObject({ purchases: 2, biggest_chf: 266, night_purchases: 1, shops_used: 2, categories: ["Electronics", "Books"], category_share: 100 });
    expect(s.rules.find((r) => r.key === "orderLimit")).toMatchObject({ suggested_value: 300, evidence: "Your biggest online payment was CHF 266" });
    expect(s.rules.find((r) => r.key === "monthBudget")?.suggested_value).toBe(500);
    expect(s.rules.find((r) => r.key === "knownShops")?.evidence).toContain("Shop A 1 time");
    expect(s.instruction_generated).toContain("CHF 300");
  });
});

describe("/v4/app: the app's contract on our backend", () => {
  let leash: AppLeash;
  let firstMandate: string;

  it("GET /v4/app/leash/suggest reads the demo card's history", async () => {
    const r = await call<AppSuggestResponse>("GET", "/v4/app/leash/suggest");
    expect(r.status).toBe(200);
    expect(r.body.window_days).toBe(90);
    expect(r.body.analysis.purchases).toBeGreaterThan(0);
    expect(r.body.rules.map((x) => x.key)).toEqual(["orderLimit", "monthBudget", "knownShops", "categories"]);
    expect(r.body.smart.evidence.unsure).toBeTruthy();
    const parsed = await call<ParseResult>("POST", "/app/leash/parse", { instruction: r.body.instruction_generated });
    expect(parsed.body.rules.map((x) => x.key)).toEqual(expect.arrayContaining(["order_limit", "period_budget"]));
  });

  it("GET /v4/app/leash before setup is off", async () => {
    const r = await call<AppLeash>("GET", "/v4/app/leash");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("off");
  });

  it("POST /v4/app/leash creates the Agent Card from two numbers and the switches", async () => {
    const r = await call<AppLeash>("POST", "/v4/app/leash", { instruction: "", rules: { orderLimit: 300, monthBudget: 1500 }, smart: SMART });
    expect(r.status).toBe(200);
    leash = r.body;
    firstMandate = leash.mandate_id;
    expect(leash).toMatchObject({ status: "active", rules: { orderLimit: 300, monthBudget: 1500 }, smart: SMART, learned: [], task: null, month_spent_chf: 0 });
    expect(leash.instruction).toContain("CHF 300");
    await settle();
    expect(events.some((e) => e.event === "leash_changed" && (e.data.leash as AppLeash).status === "active")).toBe(true);
  });

  it("PATCH tightens without Face ID and refuses to loosen without it", async () => {
    const lower = await call<AppLeash>("PATCH", "/v4/app/leash/rules", { rules: { orderLimit: 250 } });
    expect(lower.status).toBe(200);
    expect(lower.body.rules.orderLimit).toBe(250);
    expect(lower.body.mandate_id).toBe(firstMandate);

    const budget = await call<AppLeash>("PATCH", "/v4/app/leash/rules", { rules: { monthBudget: 1200 } });
    expect(budget.body.rules.monthBudget).toBe(1200);

    const refused = await call<{ error: { code: string } }>("PATCH", "/v4/app/leash/rules", { rules: { orderLimit: 350 } });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("face_id_required");

    const loosened = await call<AppLeash>("PATCH", "/v4/app/leash/rules", { rules: { orderLimit: 350 }, face_id_confirmed: true });
    expect(loosened.status).toBe(200);
    expect(loosened.body.rules).toEqual({ orderLimit: 350, monthBudget: 1200 });
    expect(loosened.body.mandate_id).not.toBe(firstMandate);

    // "At night" is a real rule now: back from "decline" to "ask" loosens it, so it needs Face ID like any loosening.
    const nightLooser = await call<{ error: { code: string } }>("PATCH", "/v4/app/leash/rules", { smart: { night: "ask" } });
    expect(nightLooser.status).toBe(403);
    expect(nightLooser.body.error.code).toBe("face_id_required");
    const decline = await call<AppLeash>("PATCH", "/v4/app/leash/rules", { smart: { unsure: "decline" } });
    expect(decline.body.smart).toMatchObject({ unsure: "decline", night: "decline" });
    const nightAsk = await call<AppLeash>("PATCH", "/v4/app/leash/rules", { smart: { night: "ask" }, face_id_confirmed: true });
    expect(nightAsk.body.smart).toMatchObject({ unsure: "decline", night: "ask" });
    const back = await call<AppLeash>("PATCH", "/v4/app/leash/rules", { smart: { unsure: "ask" }, face_id_confirmed: true });
    expect(back.body.smart.unsure).toBe("ask");
    expect(back.body.rules).toEqual({ orderLimit: 350, monthBudget: 1200 });
  });

  it("PATCH block_shop by name adds a blocked shop", async () => {
    const r = await call<AppLeash>("PATCH", "/v4/app/leash/rules", { block_shop: pack.merchants.values().next().value!.merchant_name });
    expect(r.status).toBe(200);
    expect(service.getLeash().rules.some((x) => x.key === "blocked_shop")).toBe(true);
    const unknown = await call<{ error: { code: string } }>("PATCH", "/v4/app/leash/rules", { block_shop: "No Such Shop" });
    expect(unknown.status).toBe(404);
  });

  it("POST /v4/api/runs: the scenario becomes the task on top of the card rules, decisions arrive in the app's shape", async () => {
    const before = events.length;
    const r = await call<{ run_id: string }>("POST", "/v4/api/runs", { scenario_id: "SCEN0004" });
    expect(r.status).toBe(202);
    await service.waitForRun(r.body.run_id, 60_000);
    await settle();

    const l = await call<AppLeash>("GET", "/v4/app/leash");
    expect(l.body.task).not.toBeNull();
    expect(l.body.task!.instruction).toContain("27-inch monitor");
    expect(l.body.task!.rules.length).toBeGreaterThan(0);
    // Stricter wins: the card's CHF 350 beats the task's CHF 400.
    expect(l.body.rules.orderLimit).toBe(350);
    expect(l.body.rules.monthBudget).toBe(1200);
    expect(l.body.card_last4).toBe("0039");

    const feed = await call<AppFeedResponse>("GET", "/v4/app/feed");
    expect(feed.status).toBe(200);
    const all = [...feed.body.decisions, ...feed.body.asks];
    expect(all.length).toBe(11);
    for (const d of all) {
      expect(d.created_at).toMatch(/^\d{4}-/);
      expect(d.scenario_id).toBe("SCEN0004");
      expect(typeof d.replay_order).toBe("number");
      expect(d.headline.length).toBeGreaterThan(0);
      expect(d.because.length).toBeGreaterThan(0);
      expect(Array.isArray(d.checks)).toBe(true);
      expect(d.merchant.name.length).toBeGreaterThan(0);
      expect(typeof d.amount.chf).toBe("number");
    }
    expect(feed.body.decisions.every((d) => d.decision !== "step_up")).toBe(true);
    expect(feed.body.asks.every((d) => d.decision === "step_up" && d.status === "waiting_for_you" && d.deadline_at)).toBe(true);
    // Newest first.
    const times = feed.body.decisions.map((d) => d.created_at);
    expect([...times].sort().reverse()).toEqual(times);

    // Stream: every purchase once, asks as `ask` with a deadline, nothing as a bare step_up decision.
    const mine = events.slice(before);
    const decisions = mine.filter((e) => e.event === "decision").map((e) => e.data.decision as AppDecision);
    const asks = mine.filter((e) => e.event === "ask").map((e) => e.data);
    expect(decisions.length + asks.length).toBe(11);
    expect(new Set([...decisions.map((d) => d.id), ...asks.map((a) => (a.decision as AppDecision).id)]).size).toBe(11);
    expect(decisions.every((d) => d.decision !== "step_up")).toBe(true);
    expect(asks.every((a) => typeof a.deadline_at === "string")).toBe(true);
    expect(mine.some((e) => e.event === "leash_changed")).toBe(true);
  });

  it("POST /v4/app/asks/:id/resolve answers a question; the answer is shown as an answer, not a question", async () => {
    const feed = await call<AppFeedResponse>("GET", "/v4/app/feed");
    const ask = feed.body.asks[0];
    if (!ask) return; // the engine asked nothing in this scenario; nothing to answer
    const r = await call("POST", `/v4/app/asks/${ask.id}/resolve`, { decision: "decline" });
    expect(r.status).toBe(204);
    const d = await call<AppDecision>("GET", `/v4/app/decisions/${ask.id}`);
    expect(d.body.status).toBe("declined_by_you");
    expect(d.body.decision).toBe("decline");
    const after = await call<AppFeedResponse>("GET", "/v4/app/feed");
    expect(after.body.asks.some((x) => x.id === ask.id)).toBe(false);
    expect(after.body.decisions.some((x) => x.id === ask.id)).toBe(true);
    // Answering never re-sends the purchase on the stream.
    await settle();
    expect(events.filter((e) => e.event === "decision" && (e.data.decision as AppDecision).id === ask.id).length).toBe(0);

    if (d.body.suggestion) {
      const accept = await call("POST", `/v4/app/suggestions/${ask.id}/accept`, {});
      expect(accept.status).toBe(204);
      const l = await call<AppLeash>("GET", "/v4/app/leash");
      expect(l.body.learned.length).toBe(1);
      expect(l.body.learned[0]!.text).toBe(d.body.suggestion.text);
    }
    const none = await call<{ error: { code: string } }>("POST", "/v4/app/suggestions/AU9999/accept", {});
    expect(none.status).toBe(404);
  });

  it("pause and turn off", async () => {
    const p = await call("POST", "/v4/app/leash/pause", {});
    expect(p.status).toBe(204);
    expect((await call<AppLeash>("GET", "/v4/app/leash")).body.status).toBe("paused");
    const off = await call("DELETE", "/v4/app/leash");
    expect(off.status).toBe(204);
    expect((await call<AppLeash>("GET", "/v4/app/leash")).body.status).toBe("off");
    expect((await call("DELETE", "/v4/app/leash")).status).toBe(204);
  });
});
