import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { loadDataPack, type EngineVerdict, type LeashView } from "@leash/shared";
import { OfflinePlatform } from "../src/offline/platform.js";
import { LeashService, ServiceError } from "../src/leash/service.js";
import { createLeashServer } from "../src/http/server.js";
import type { Engine } from "../src/engine/port.js";
import type { StoredDecision } from "../src/store.js";
import type { ResolveBody } from "../src/viseca/api.js";

// Answers that race each other, the budget at the moment of approval, and who may answer at all.

const pack = loadDataPack(fileURLToPath(new URL("../../../data", import.meta.url)));
const SCEN0001 = pack.scenarios.get("SCEN0001")!.cardholder_instruction; // CHF 300 a week

/** Asks about everything, so nothing is approved until the customer says so. */
const askEverything: Engine = {
  version: "test-ask-all",
  decide: (): EngineVerdict => ({
    decision: "step_up",
    reason_codes: ["test_ask"],
    headline: "Asking you",
    because: "Test engine asks about every purchase.",
    checks: [],
    uncertainty: [],
    shop_text_quarantine: null,
    engine_version: "test-ask-all",
  }),
};

/** Viseca with a slow /resolve, so concurrent answers really overlap. */
class SlowResolvePlatform extends OfflinePlatform {
  resolveCalls: { id: string; decision: string }[] = [];
  override async resolve(id: string, body: ResolveBody) {
    this.resolveCalls.push({ id, decision: body.decision });
    await new Promise((r) => setTimeout(r, 30));
    return super.resolve(id, body);
  }
}

async function setup() {
  const platform = new SlowResolvePlatform(pack);
  const service = new LeashService({ api: platform, pack, engine: askEverything, mode: "offline", worker: { pollWaitSeconds: 0 } });
  await service.createLeash({ instruction: SCEN0001, confirmed: true });
  const run = await service.startRun("SCEN0001", true);
  await service.waitForRun(run.run_id);
  return { platform, service, asks: service.asks() };
}

const settle = <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e: Error & { code?: string }) => ({ ok: false as const, code: e.code }));

describe("answering an ask", () => {
  it("a double tap sends one answer to Viseca, not two", async () => {
    const { platform, service, asks } = await setup();
    const id = asks[0]!.id;
    const [a, b] = await Promise.all([settle(service.resolve(id, "decline")), settle(service.resolve(id, "approve"))]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)!.code).toBe("busy");
    expect(platform.resolveCalls.filter((c) => c.id === id)).toHaveLength(1);
    expect(service.decision(id).status).toBe("declined_by_you");
    service.worker.stop();
  });

  it("approvals racing each other can't spend more than the budget", async () => {
    const { service, asks } = await setup();
    const limit = service.getLeash().budget!.limit_chf;
    expect(asks.reduce((s, d) => s + d.amount.chf, 0)).toBeGreaterThan(limit); // otherwise the test proves nothing

    const results = await Promise.all(asks.map((d) => settle(service.resolve(d.id, "approve"))));
    const approved = asks.filter((_, i) => results[i]!.ok);
    expect(results.some((r) => !r.ok && r.code === "over_budget")).toBe(true);
    expect(approved.reduce((s, d) => s + d.amount.chf, 0)).toBeLessThanOrEqual(limit);
    expect(service.getLeash().budget!.spent_chf).toBeLessThanOrEqual(limit);
    service.worker.stop();
  });

  it("over budget is the customer's call: the warning names the overshoot, approving again buys it", async () => {
    const { service, asks } = await setup();
    const limit = service.getLeash().budget!.limit_chf;
    let refused: StoredDecision | undefined;
    for (const d of asks) {
      try {
        await service.resolve(d.id, "approve");
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceError);
        expect((err as ServiceError).message).toMatch(/^This puts you CHF \d+\.\d{2} over your 7-day budget/);
        refused = d;
        break;
      }
    }
    expect(refused).toBeDefined();
    expect(service.decision(refused!.id).status).toBe("waiting_for_you");
    expect((await service.resolve(refused!.id, "approve", false, true)).status).toBe("approved_by_you");
    expect(service.getLeash().budget!.spent_chf).toBeGreaterThan(limit);
    service.worker.stop();
  });
});

describe("only the app can answer", () => {
  let server: Server;
  let base: string;
  let service: LeashService;
  let asks: StoredDecision[];
  const SECRET = "test-app-secret";

  beforeAll(async () => {
    ({ service, asks } = await setup());
    server = createLeashServer(service, { heartbeatMs: 60_000, corsOrigin: "http://localhost:5173", appSecret: SECRET });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    service.worker.stop();
    await new Promise((r) => server.close(r));
  });

  const call = (method: string, path: string, body?: unknown, secret?: string) =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("refuses writes without the app's secret, or with a wrong one", async () => {
    const id = asks[0]!.id;
    const none = await call("POST", `/app/asks/${id}/resolve`, { decision: "approve" });
    expect(none.status).toBe(401);
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
    expect((await call("POST", `/app/asks/${id}/resolve`, { decision: "approve" }, "wrong")).status).toBe(401);
    expect((await call("DELETE", "/app/leash")).status).toBe(401);
    expect(service.decision(id).status).toBe("waiting_for_you");
  });

  it("an approve needs Face ID; a decline never does", async () => {
    // The two cheapest asks, so the approve is not refused for being over budget.
    const cheapest = [...asks].sort((a, b) => a.amount.chf - b.amount.chf);
    const [first, second] = [cheapest[0]!.id, cheapest[1]!.id];
    const noFaceId = await call("POST", `/app/asks/${first}/resolve`, { decision: "approve" }, SECRET);
    expect(noFaceId.status).toBe(403);
    expect(((await noFaceId.json()) as { error: { code: string } }).error.code).toBe("face_id_required");
    expect(service.decision(first).status).toBe("waiting_for_you");

    const withFaceId = await call("POST", `/app/asks/${first}/resolve`, { decision: "approve", face_id_confirmed: true }, SECRET);
    expect(withFaceId.status).toBe(200);
    expect(service.decision(first).status).toBe("approved_by_you");

    const decline = await call("POST", `/app/asks/${second}/resolve`, { decision: "decline" }, SECRET);
    expect(decline.status).toBe(200);
    expect(service.decision(second).status).toBe("declined_by_you");
  });

  it("lets the app in, keeps reads open, and allows only the app's origin", async () => {
    const read = await call("GET", "/app/leash");
    expect(read.status).toBe(200);
    expect(read.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const ok = await call("POST", `/app/asks/${asks[0]!.id}/resolve`, { decision: "decline" }, SECRET);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as StoredDecision).status).toBe("declined_by_you");
    expect(((await (await call("GET", "/app/leash")).json()) as LeashView).status).toBe("active");
  });
});
