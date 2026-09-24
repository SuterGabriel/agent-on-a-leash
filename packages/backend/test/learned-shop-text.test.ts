import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { loadDataPack, type AppDecision, type AppFeedResponse, type AppLeash } from "@leash/shared";
import { OfflinePlatform } from "../src/offline/platform.js";
import { LeashService } from "../src/leash/service.js";
import { createLeashServer } from "../src/http/server.js";
import { LeashEngine } from "../src/engine/leashEngine.js";

// Kim's demo beat at 0:50: the customer declines the purchase whose shop text gave orders, the app offers
// "Always decline when a shop's text gives orders", and from then on such a purchase is declined, not asked.

const pack = loadDataPack(fileURLToPath(new URL("../../../data", import.meta.url)));
let server: Server;
let base: string;

const call = async <T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> => {
  const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (res.status === 204 ? undefined : await res.json()) as T };
};

/** Runs SCEN0004 to the end, answering every ask with `answer`, and returns the feed in replay order. */
async function runScenario(answer: "approve" | "decline"): Promise<AppDecision[]> {
  const run = await call<{ run_id: string }>("POST", "/v4/api/runs", { scenario_id: "SCEN0004" });
  expect(run.status).toBe(202);
  const mine = (d: AppDecision) => d.id.startsWith(`${run.body.run_id}-`);
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const feed = await call<AppFeedResponse>("GET", "/v4/app/feed");
    for (const a of feed.body.asks) await call("POST", `/v4/app/asks/${a.id}/resolve`, { decision: answer, face_id_confirmed: true });
    const st = await call<{ latest_run: { status: string } | null }>("GET", "/v4/api/status");
    if (st.body.latest_run && st.body.latest_run.status !== "running" && !feed.body.asks.length) break;
  }
  const feed = await call<AppFeedResponse>("GET", "/v4/app/feed");
  return feed.body.decisions.filter(mine).sort((a, b) => (a.replay_order ?? 0) - (b.replay_order ?? 0));
}

beforeAll(async () => {
  const platform = new OfflinePlatform(pack);
  const engine = new LeashEngine();
  const service = new LeashService({ api: platform, pack, engine, mode: "offline", worker: { pollWaitSeconds: 0 } });
  engine.follow(service.bus);
  server = createLeashServer(service, { heartbeatMs: 60_000 });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await call("POST", "/v4/app/leash", { instruction: "", rules: { orderLimit: 400, monthBudget: 5000 }, smart: { unsure: "ask", night: "decline", newShops: "ask", learn: "on" } });
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("learned rule: always decline when a shop's text gives orders", () => {
  let suggestionId: string;
  let approvedBefore = 0;

  it("a declined shop-text ask carries the suggestion, and the quoted shop text travels with the decision", async () => {
    const first = await runScenario("decline");
    const shopText = first.filter((d) => d.reason_codes.includes("shop_text_manipulation"));
    expect(shopText.length).toBe(2);
    for (const d of shopText) expect(d.shop_text_quarantine).toBeTruthy();
    const asked = shopText.find((d) => d.status === "declined_by_you");
    expect(asked, "the purchase whose only problem is the shop text is asked, then declined by the customer").toBeTruthy();
    expect(asked!.suggestion?.text).toBe("Always decline when a shop's text gives orders");
    suggestionId = asked!.suggestion!.id;
    approvedBefore = first.filter((d) => d.decision === "approve").length;
    expect(approvedBefore).toBeGreaterThan(0);
  });

  it("accepting it adds a learned rule, and the next run declines that purchase without asking", async () => {
    const accept = await call("POST", `/v4/app/suggestions/${suggestionId}/accept`, {});
    expect(accept.status).toBe(204);
    const leash = await call<AppLeash>("GET", "/v4/app/leash");
    expect(leash.body.learned.map((l) => l.text)).toContain("Always decline when a shop's text gives orders");

    const second = await runScenario("decline");
    const shopText = second.filter((d) => d.reason_codes.includes("shop_text_manipulation"));
    expect(shopText.length).toBe(2);
    for (const d of shopText) {
      expect(d.decision).toBe("decline");
      expect(d.status).toBe("declined");
    }
    // Everything the engine approved before is still approved: the learned rule only tightens.
    expect(second.filter((d) => d.decision === "approve").length).toBe(approvedBefore);
  });
});
