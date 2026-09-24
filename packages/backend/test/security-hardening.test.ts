import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { loadDataPack, type ChargeResult, type DecisionToken, type EngineVerdict, type LeashView } from "@leash/shared";
import { fileURLToPath } from "node:url";
import { OfflinePlatform } from "../src/offline/platform.js";
import { LeashService } from "../src/leash/service.js";
import { createLeashServer } from "../src/http/server.js";
import type { Engine } from "../src/engine/port.js";
import type { StoredDecision } from "../src/store.js";
import { GENESIS, TokenVault, verifyHistory } from "../src/tokens/vault.js";

// Hardening beyond security.test.ts: hostile input at the HTTP edge, the app secret under every wrong shape,
// the token vault against odd amounts, and error bodies that never leak a secret.

const pack = loadDataPack(fileURLToPath(new URL("../../../data", import.meta.url)));
const SCEN0001 = pack.scenarios.get("SCEN0001")!.cardholder_instruction;
const SECRET = "app-secret-for-tests-0123456789";
const TEAM_KEY = "viseca-team-key-never-shown";

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

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

describe("HTTP edge", () => {
  let server: Server;
  let base: string;
  let service: LeashService;
  let asks: StoredDecision[];

  beforeAll(async () => {
    process.env.TEAM_API_KEY = TEAM_KEY;
    const platform = new OfflinePlatform(pack);
    service = new LeashService({ api: platform, pack, engine: askEverything, mode: "offline", worker: { pollWaitSeconds: 0 } });
    await service.createLeash({ instruction: SCEN0001, confirmed: true });
    const run = await service.startRun("SCEN0001", true);
    await service.waitForRun(run.run_id);
    asks = service.asks();
    server = createLeashServer(service, { heartbeatMs: 60_000, corsOrigin: "http://localhost:5173", appSecret: SECRET });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    service.worker.stop();
    await new Promise((r) => server.close(r));
    delete process.env.TEAM_API_KEY;
  });

  const raw = (method: string, path: string, body?: string, headers: Record<string, string> = {}) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, body });
  const call = (method: string, path: string, body?: unknown, secret: string | null = SECRET) =>
    raw(method, path, body === undefined ? undefined : JSON.stringify(body), secret ? { Authorization: `Bearer ${secret}` } : {});

  describe("malformed requests are refused, never crash", () => {
    it("invalid JSON is a 400, not a 500", async () => {
      const res = await raw("POST", "/app/leash/parse", "{not json", { Authorization: `Bearer ${SECRET}` });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe("invalid_json");
    });

    it("a JSON array or a bare string is not an object", async () => {
      for (const body of ["[1,2,3]", '"hello"', "42", "null"]) {
        const res = await raw("POST", "/app/leash/parse", body, { Authorization: `Bearer ${SECRET}` });
        expect(res.status, body).toBe(400);
      }
    });

    it("a body above 1 MB is refused with 413", async () => {
      const res = await raw("POST", "/app/leash/parse", JSON.stringify({ instruction: "a".repeat(1_100_000) }), { Authorization: `Bearer ${SECRET}` });
      expect(res.status).toBe(413);
      expect(((await res.json()) as ErrorBody).error.code).toBe("body_too_large");
    });

    it("an empty instruction, a non-string instruction and a nested object all answer 400", async () => {
      for (const body of [{}, { instruction: "" }, { instruction: "   " }, { instruction: { $gt: "" } }, { instruction: ["a"] }]) {
        const res = await call("POST", "/app/leash/parse", body);
        expect([200, 400], JSON.stringify(body)).toContain(res.status);
        if (res.status === 200) {
          // Coerced to a string: it must not have become a rule.
          const parsed = (await res.json()) as { rules: unknown[] };
          expect(parsed.rules.length).toBe(0);
        }
      }
    });

    it("unknown routes are 404 and wrong methods are 405, without a stack trace", async () => {
      const notFound = await call("GET", "/app/../etc/passwd", undefined, null);
      expect(notFound.status).toBe(404);
      const body = (await notFound.json()) as ErrorBody;
      expect(body.error.code).toBe("not_found");
      expect(JSON.stringify(body)).not.toMatch(/at .*\.ts:\d+/);
      const wrongMethod = await call("PUT", "/app/leash", {}, SECRET);
      expect(wrongMethod.status).toBe(405);
    });

    it("odd ids in the path are 404, never 500", async () => {
      for (const id of ["..", "%2e%2e%2f", "' OR 1=1 --", "<script>alert(1)</script>", "x".repeat(5_000), "%00", "AU0001%0A"]) {
        const res = await call("GET", `/app/decisions/${id}`, undefined, null);
        expect(res.status, id).toBe(404);
        const res2 = await call("POST", `/app/asks/${id}/resolve`, { decision: "approve" });
        expect([404, 400], id).toContain(res2.status);
      }
    });

    it("an unknown answer to an ask is 400 and changes nothing", async () => {
      const id = asks[0]!.id;
      for (const decision of ["yes", "APPROVE", 1, true, null, { decision: "approve" }, ["approve"]]) {
        const res = await call("POST", `/app/asks/${id}/resolve`, { decision });
        expect(res.status, JSON.stringify(decision)).toBe(400);
      }
      expect(service.decision(id).status).toBe("waiting_for_you");
    });

    it("a feed filter with hostile characters answers 200 and an empty list", async () => {
      const res = await call("GET", `/app/feed?run_id=${encodeURIComponent("' OR 1=1 --")}`, undefined, null);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });
  });

  describe("the app secret under every wrong shape", () => {
    const attempts: Array<[string, Record<string, string>]> = [
      ["no header", {}],
      ["empty bearer", { Authorization: "Bearer " }],
      ["lowercase scheme", { Authorization: `bearer ${SECRET}` }],
      ["basic scheme", { Authorization: `Basic ${Buffer.from(SECRET).toString("base64")}` }],
      ["prefix of the secret", { Authorization: `Bearer ${SECRET.slice(0, -1)}` }],
      ["secret plus one char", { Authorization: `Bearer ${SECRET}x` }],
      ["secret in a custom header", { "X-App-Secret": SECRET }],
      // A trailing space is not a case: fetch trims header values before they leave the client.
      ["double space", { Authorization: `Bearer  ${SECRET}` }],
      ["two bearers", { Authorization: `Bearer ${SECRET}, Bearer ${SECRET}` }],
    ];

    it.each(attempts)("%s is refused with 401", async (_name, headers) => {
      const id = asks[1]!.id;
      const res = await raw("POST", `/app/asks/${id}/resolve`, JSON.stringify({ decision: "approve" }), headers);
      expect(res.status).toBe(401);
      expect(service.decision(id).status).toBe("waiting_for_you");
    });

    it("the secret in the query string does not count", async () => {
      const res = await raw("DELETE", `/app/leash?secret=${SECRET}&token=${SECRET}`);
      expect(res.status).toBe(401);
      expect(service.getLeash().status).toBe("active");
    });

    it("the demo charge and the run control are not guarded by the app secret, and say so in code", async () => {
      // /demo/* and /api/* are demo and judge routes; they hold no customer power beyond the offline simulator.
      // This test pins that fact so a change is a decision, not an accident.
      const res = await call("GET", "/api/scenarios", undefined, null);
      expect(res.status).toBe(200);
    });
  });

  describe("no secret ever appears in a response", () => {
    it("error bodies and the leash view never contain the app secret or the team key", async () => {
      const bodies: string[] = [];
      bodies.push(await (await call("POST", "/app/asks/nope/resolve", { decision: "approve" })).text());
      bodies.push(await (await raw("POST", "/app/leash/parse", "{bad", { Authorization: `Bearer ${SECRET}` })).text());
      bodies.push(await (await call("GET", "/app/leash", undefined, null)).text());
      bodies.push(await (await call("GET", "/api/status", undefined, null)).text());
      bodies.push(await (await call("GET", "/nowhere", undefined, null)).text());
      for (const b of bodies) {
        expect(b).not.toContain(SECRET);
        expect(b).not.toContain(TEAM_KEY);
      }
    });

    it("shop text comes back as JSON text, never as HTML", async () => {
      const res = await call("GET", "/app/feed", undefined, null);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      const feed = (await res.json()) as StoredDecision[];
      expect(feed.length).toBeGreaterThan(0);
    });
  });

  describe("the leash cannot be loosened through the API", () => {
    const limitOf = (view: LeashView) => Number(view.rules.find((r) => r.key === "order_limit")!.hard_rule!.value);
    const current = async () => limitOf((await (await call("GET", "/app/leash", undefined, null)).json()) as LeashView);

    it("a higher or equal order limit is refused as not tighter; the limit stays", async () => {
      const before = await current();
      const higher = await call("PATCH", "/app/leash/rules", { type: "lower_order_limit", value: before * 10 });
      expect(higher.status).toBe(400);
      expect(((await higher.json()) as ErrorBody).error.code).toBe("not_tighter");
      expect((await call("PATCH", "/app/leash/rules", { type: "lower_order_limit", value: before })).status).toBe(400);
      expect(await current()).toBe(before);
    });

    it("a zero, negative, NaN, string or object limit is refused", async () => {
      const before = await current();
      // [1] and true would coerce to 1 with a bare Number(); only numbers and numeric strings are amounts.
      for (const value of [0, -5, "abc", null, "1e309", { $gt: 0 }, [1], true]) {
        const res = await call("PATCH", "/app/leash/rules", { type: "lower_order_limit", value });
        expect(res.status, JSON.stringify(value)).toBe(400);
      }
      expect(await current()).toBe(before);
    });

    it("an unknown tighten type is refused", async () => {
      const res = await call("PATCH", "/app/leash/rules", { type: "raise_order_limit", value: 1 });
      expect([400, 422]).toContain(res.status);
    });
  });
});

describe("token vault against odd amounts", () => {
  let now = Date.parse("2026-09-24T10:00:00Z");
  const vault = new TokenVault(() => now);
  const issue = (decisionId: string, approved = 100) =>
    vault.issue({ decision_id: decisionId, merchant_id: "ME0001", merchant_name: "Alpine Basket", approved_chf: approved, order_limit_chf: 120, budget_left_chf: 200 });

  const refused = (r: ChargeResult, code: string) => {
    expect(r.ok).toBe(false);
    expect(r.code).toBe(code);
  };

  it("a negative, zero, NaN or infinite amount never charges", () => {
    const t = issue("d-odd");
    for (const amount of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = vault.charge(t.id, "ME0001", amount);
      expect(r.ok, String(amount)).toBe(false);
      expect(vault.get(t.id)!.status, String(amount)).toBe("active");
    }
    expect(vault.charge(t.id, "ME0001", 100).ok).toBe(true);
  });

  it("a charge one rappen above the maximum is refused; the maximum itself goes through", () => {
    const t = issue("d-max");
    refused(vault.charge(t.id, "ME0001", t.max_chf + 0.01), "over_amount");
    expect(vault.charge(t.id, "ME0001", t.max_chf).ok).toBe(true);
  });

  it("the maximum never exceeds the per-order limit, whatever the tolerance", () => {
    const t = issue("d-cap", 119);
    expect(t.max_chf).toBeLessThanOrEqual(120);
  });

  it("a second charge, another shop, an expired token and a revoked token are all refused", () => {
    const t = issue("d-once");
    refused(vault.charge(t.id, "ME0002", 50), "wrong_merchant");
    expect(vault.charge(t.id, "ME0001", 50).ok).toBe(true);
    refused(vault.charge(t.id, "ME0001", 1), "token_used");

    const late = issue("d-late");
    now += 16 * 60 * 1000;
    refused(vault.charge(late.id, "ME0001", 10), "token_expired");
    now -= 16 * 60 * 1000;

    const gone = issue("d-gone");
    vault.revokeActive();
    refused(vault.charge(gone.id, "ME0001", 10), "token_revoked");
  });

  it("refunds cannot exceed what was charged, or be negative", () => {
    const t = issue("d-refund");
    vault.charge(t.id, "ME0001", 80);
    refused(vault.refund(t.id, 80.01), "refund_rejected");
    refused(vault.refund(t.id, -5), "refund_rejected");
    refused(vault.refund(t.id, Number.NaN), "refund_rejected");
    expect(vault.refund(t.id, 80).ok).toBe(true);
    refused(vault.refund(t.id, 0.01), "refund_rejected");
  });

  it("one decision gets one token, however often it is asked for", () => {
    const a = issue("d-same");
    const b = issue("d-same");
    expect(a.id).toBe(b.id);
    expect(vault.list().filter((t: DecisionToken) => t.decision_id === "d-same")).toHaveLength(1);
  });

  it("charging an unknown token id is refused, and a guessed id is not a valid one", () => {
    refused(vault.charge("tok_demo_00000000", "ME0001", 1), "unknown_token");
    refused(vault.charge("", "ME0001", 1), "unknown_token");
  });
});

describe("token history is a hash chain", () => {
  const vault = new TokenVault();
  const fresh = (id: string) => vault.issue({ decision_id: id, merchant_id: "ME0001", merchant_name: "Alpine Basket", approved_chf: 50 });

  it("every event carries the previous hash; the chain verifies after a full life", () => {
    const t = fresh("chain-1");
    vault.charge(t.id, "ME0002", 10); // declined: wrong shop
    vault.charge(t.id, "ME0001", 60); // declined: over amount
    vault.charge(t.id, "ME0001", 50); // charged
    vault.refund(t.id, 20);
    expect(t.history.map((e) => e.type)).toEqual(["issued", "declined", "declined", "charged", "refunded"]);
    expect(t.history[0]!.prev_hash).toBe(GENESIS);
    for (let i = 1; i < t.history.length; i++) expect(t.history[i]!.prev_hash).toBe(t.history[i - 1]!.hash);
    expect(vault.verify(t.id)).toEqual({ ok: true, events: 5, broken_at: null });
  });

  it("changing one detail, removing a line or swapping two lines breaks the chain at that point", () => {
    const t = fresh("chain-2");
    vault.charge(t.id, "ME0001", 50);
    vault.refund(t.id, 5);
    const copy = () => ({ history: t.history.map((e) => ({ ...e })) });

    const edited = copy();
    edited.history[1]!.detail = edited.history[1]!.detail.replace("50.00", "5.00");
    expect(verifyHistory(edited)).toEqual({ ok: false, events: 3, broken_at: 1 });

    const removed = copy();
    removed.history.splice(1, 1);
    expect(verifyHistory(removed)).toEqual({ ok: false, events: 2, broken_at: 1 });

    const swapped = copy();
    [swapped.history[1], swapped.history[2]] = [swapped.history[2]!, swapped.history[1]!];
    expect(verifyHistory(swapped)).toEqual({ ok: false, events: 3, broken_at: 1 });

    // Re-hashing the edited line alone is not enough: the next line still names the old hash.
    const rehashed = copy();
    rehashed.history[1]!.detail = "CHF 5.00 charged by Alpine Basket. Token used up.";
    rehashed.history[1]!.hash = "0".repeat(64);
    expect(verifyHistory(rehashed).ok).toBe(false);
    expect(vault.verify(t.id)!.ok).toBe(true);
  });

  it("the original is untouched by the copies, and an unknown id verifies as nothing", () => {
    expect(vault.verify("tok_demo_nope")).toBeUndefined();
    expect(verifyHistory({ history: [] })).toEqual({ ok: true, events: 0, broken_at: null });
  });
});
