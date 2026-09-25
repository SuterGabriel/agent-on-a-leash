import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { buildEvent, loadDataPack, type EventMandate } from "@leash/shared";
import { LeashEngine } from "../src/engine/leashEngine.js";
import { compile, toMandateDraft } from "../src/compiler/compile.js";

// Live scenario cards (e.g. CA1331 in SCEN0101) have no rows in the authorization history.
// "Never bought here" or "doesn't look like you" would be guesses: the engine must call it unknown and ask.

const pack = loadDataPack(fileURLToPath(new URL("../../../data", import.meta.url)));
const engine = new LeashEngine();

function eventFor(au: string, scenarioId: string, over: { card_id: string; recent_attempt_count_10m?: number }) {
  const parsed = compile(pack.scenarios.get(scenarioId)!.cardholder_instruction);
  const draft = toMandateDraft(parsed, parsed.rules);
  const mandate: EventMandate = { mandate_id: "TM-LIVE", status: "active", customer_id: "CU1217", card_id: over.card_id, instruction: draft.instruction, hard_rules: draft.hard_rules, uncertainty_policy: draft.uncertainty_policy, profile_id: "P" };
  const e = buildEvent(pack, pack.attempts.get(au)!, {
    liveAuthorizationId: `${au}-live-${Math.random()}`,
    requestId: "r",
    mandate,
    relatedLiveId: null,
    context: { approved_spend_in_period_chf: 0, recent_authorizations: [] },
    receivedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 8000).toISOString(),
  });
  e.authorization.card_id = over.card_id;
  if (over.recent_attempt_count_10m !== undefined) e.authorization.recent_attempt_count_10m = over.recent_attempt_count_10m;
  return e;
}

describe("a card with no history (live scenarios)", () => {
  // Team decision (24-09): no history is always an ask (no_shop_history), never left to the uncertainty policy,
  // so "decline when unsure" can't turn missing history into a decline.
  it("'shops I use': unknown, asked, with an honest message", () => {
    const v = engine.decide(eventFor("AU0001", "SCEN0000", { card_id: "CA1331" }), { runId: `r-${Math.random()}`, currentMandate: null });
    expect(v.decision).toBe("step_up");
    expect(v.reason_codes).toEqual(["no_shop_history"]);
    expect(v.because).toBe("We have no purchase history for this card yet, so we cannot tell whether you know Alpine Basket. Approve it once and we remember it.");
    expect(v.checks.find((c) => c.key === "familiarity")!.result).toBe("unsure");
  });

  it("'someone other than me': a normal purchase is asked, not declined", () => {
    const v = engine.decide(eventFor("AU0024", "SCEN0003", { card_id: "CA9999", recent_attempt_count_10m: 0 }), { runId: `r-${Math.random()}`, currentMandate: null });
    expect(v.decision).toBe("step_up");
    expect(v.reason_codes).not.toContain("session_not_you");
    expect(v.checks.find((c) => c.key === "session")!.result).toBe("unsure");
  });

  it("a burst of orders is still caught without history", () => {
    const v = engine.decide(eventFor("AU0024", "SCEN0003", { card_id: "CA9999", recent_attempt_count_10m: 3 }), { runId: `r-${Math.random()}`, currentMandate: null });
    expect(v.decision).toBe("step_up");
    expect(v.reason_codes).toContain("session_not_you");
  });
});
