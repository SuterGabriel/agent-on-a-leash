import { describe, expect, it } from "vitest";
import { TokenVault, tokenMax } from "../src/tokens/vault.js";

// The five cases from the idea, plus the fixes: caps from the leash, no card numbers, revoke kills tokens.

const shoes = { decision_id: "d1", merchant_id: "ME0010", merchant_name: "Alpenlauf Sport", approved_chf: 89 };

describe("decision-bound tokens", () => {
  it("1) pays once at the approved shop, then refuses a replay", () => {
    const v = new TokenVault();
    const t = v.issue(shoes);
    expect(v.charge(t.id, "ME0010", 89)).toMatchObject({ ok: true, code: "charged" });
    expect(v.charge(t.id, "ME0010", 89)).toMatchObject({ ok: false, code: "token_used" });
  });

  it("2) refuses more than approved (the 'pre-authorised CHF 900' shop)", () => {
    const v = new TokenVault();
    const t = v.issue({ decision_id: "d2", merchant_id: "ME0040", merchant_name: "PixelHarbor", approved_chf: 249 });
    const r = v.charge(t.id, "ME0040", 900);
    expect(r).toMatchObject({ ok: false, code: "over_amount" });
    expect(r.message).toBe("CHF 900.00 is more than this token allows (CHF 261.45).");
  });

  it("3) refuses another shop", () => {
    const v = new TokenVault();
    const t = v.issue(shoes);
    expect(v.charge(t.id, "ME0099", 50)).toMatchObject({ ok: false, code: "wrong_merchant", message: "This token only works at Alpenlauf Sport." });
  });

  it("4) refuses after expiry", () => {
    let now = 1_000_000;
    const v = new TokenVault(() => now, 60_000);
    const t = v.issue(shoes);
    now += 61_000;
    expect(v.charge(t.id, "ME0010", 89)).toMatchObject({ ok: false, code: "token_expired" });
    expect(v.get(t.id)!.status).toBe("expired");
  });

  it("5) refunds after the token is used up, never more than was charged", () => {
    const v = new TokenVault();
    const t = v.issue(shoes);
    v.charge(t.id, "ME0010", 89);
    expect(v.refund(t.id, 100)).toMatchObject({ ok: false, code: "refund_rejected" });
    expect(v.refund(t.id, 89)).toMatchObject({ ok: true, code: "refunded" });
    expect(v.get(t.id)!.charged_chf).toBe(0);
  });

  it("the tolerance never goes above the customer's per-order limit (AU0004: CHF 126 vs CHF 120)", () => {
    const v = new TokenVault();
    const t = v.issue({ decision_id: "d3", merchant_id: "ME0001", merchant_name: "Alpine Basket", approved_chf: 120, order_limit_chf: 120 });
    expect(t.max_chf).toBe(120);
    expect(t.max_reason).toBe("Approved CHF 120.00, capped at your CHF 120.00 per order.");
    expect(v.charge(t.id, "ME0001", 126)).toMatchObject({ ok: false, code: "over_amount" });
  });

  it("nor above what's left of the budget", () => {
    expect(tokenMax({ ...shoes, approved_chf: 100, budget_left_chf: 2 })).toEqual({ max: 102, reason: "Approved CHF 100.00, capped by what's left of your budget." });
    expect(tokenMax({ ...shoes, approved_chf: 100, budget_left_chf: 0 }).max).toBe(100);
  });

  it("a purchase the customer approved above the limit can still be paid exactly", () => {
    expect(tokenMax({ ...shoes, approved_chf: 126, order_limit_chf: 120 }).max).toBe(126);
  });

  it("one token per decision, and IDs are clearly not card numbers", () => {
    const v = new TokenVault();
    const a = v.issue(shoes);
    expect(v.issue(shoes).id).toBe(a.id);
    expect(a.id).toMatch(/^tok_demo_[0-9a-f]{8}$/);
    expect(a.label).toMatch(/^DEMO token ••[0-9a-f]{4}$/);
    expect(a.id).not.toMatch(/\d{12,}/);
  });

  it("revoking kills every unused token, except one kept on purpose", () => {
    const v = new TokenVault();
    const used = v.issue(shoes);
    v.charge(used.id, "ME0010", 89);
    const open = v.issue({ ...shoes, decision_id: "d4" });
    const kept = v.issue({ ...shoes, decision_id: "d5" });
    expect(v.revokeActive("d5").map((t) => t.id)).toEqual([open.id]);
    expect(v.charge(open.id, "ME0010", 10)).toMatchObject({ code: "token_revoked" });
    expect(v.get(used.id)!.status).toBe("used");
    expect(v.get(kept.id)!.status).toBe("active");
  });

  it("every attempt lands in the token's history", () => {
    const v = new TokenVault();
    const t = v.issue(shoes);
    v.charge(t.id, "ME0099", 50);
    v.charge(t.id, "ME0010", 89);
    v.charge(t.id, "ME0010", 89);
    expect(v.get(t.id)!.history.map((h) => h.type)).toEqual(["issued", "declined", "charged", "declined"]);
  });
});
