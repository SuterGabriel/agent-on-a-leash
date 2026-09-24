import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadDataPack } from "@leash/shared";
import { applyAnswers, compile, QUESTION_IDS, toMandateDraft } from "../src/compiler/compile.js";

const pack = loadDataPack(fileURLToPath(new URL("../../../data", import.meta.url)));
const instruction = (id: string) => pack.scenarios.get(id)!.cardholder_instruction;
const keys = (id: string) => compile(instruction(id)).rules.map((r) => r.key);

describe("policy compiler", () => {
  it("understands every sentence of the five scenario instructions", () => {
    for (const s of pack.scenarios.values()) {
      const r = compile(s.cardholder_instruction);
      expect(r.not_understood, s.scenario_id).toEqual([]);
      expect(r.warnings, s.scenario_id).toEqual([]);
      expect(r.uncertainty_policy).toBe("ask");
    }
  });

  it("keeps the customer's exact words with correct offsets", () => {
    for (const s of pack.scenarios.values()) {
      const r = compile(s.cardholder_instruction);
      for (const rule of r.rules) {
        expect(r.instruction.slice(rule.your_words!.start, rule.your_words!.end)).toBe(rule.your_words!.text);
      }
    }
  });

  it("finds the right rules per scenario", () => {
    expect(keys("SCEN0000")).toEqual(["order_limit", "purpose", "one_item", "known_shop"]);
    expect(keys("SCEN0001")).toEqual(["period_budget", "order_limit", "purpose", "delivery"]);
    expect(keys("SCEN0002")).toEqual(["order_limit", "requested_item", "item_size", "merchant_type", "return_window"]);
    expect(keys("SCEN0003")).toEqual(["order_limit", "purpose", "known_shop", "session"]);
    expect(keys("SCEN0004")).toEqual(["order_limit", "requested_item", "known_shop", "no_extras"]);
  });

  it("does not read the weekly budget as a per-order limit", () => {
    const r = compile(instruction("SCEN0001"));
    const hard = toMandateDraft(r, r.rules).hard_rules;
    expect(hard).toContainEqual({ field: "authorization.billing_amount_chf", operator: "<=", value: 300, currency: "CHF", scope: "period", period_days: 7 });
    expect(hard).toContainEqual({ field: "authorization.billing_amount_chf", operator: "<=", value: 120, currency: "CHF", scope: "purchase" });
  });

  it("reads the example chip wording from the app", () => {
    const r = compile("Order our groceries, max CHF 120 per order and CHF 300 per week.");
    expect(r.rules.map((x) => x.label)).toEqual(["Any 7 days: CHF 300 or less in total", "Each order CHF 120 or less", "Groceries only"]);
  });

  it("never drops an instruction it doesn't understand", () => {
    const r = compile("Get me something nice for the weekend. Decline when unsure.");
    expect(r.rules).toEqual([]);
    expect(r.not_understood).toEqual(["Get me something nice for the weekend."]);
    expect(r.warnings.length).toBe(2);
    expect(r.uncertainty_policy).toBe("decline");
  });

  it("answers only add or narrow rules", () => {
    const parsed = compile(instruction("SCEN0004"));
    const rules = applyAnswers(parsed, { [QUESTION_IDS.splitOrders]: "Yes", [QUESTION_IDS.otherCard]: "Yes" });
    expect(rules.map((r) => r.key)).toContain("split_orders");
    expect(rules.find((r) => r.key === "known_shop")!.hard_rule!.value).toEqual(["used_on_this_card", "used_on_other_card"]);
    expect(parsed.rules.find((r) => r.key === "known_shop")!.hard_rule!.value).toEqual(["used_on_this_card"]);
    expect(toMandateDraft(parsed, rules, { [QUESTION_IDS.splitOrders]: "Yes", [QUESTION_IDS.otherCard]: "Yes" }).open_questions).toEqual([]);
  });
});
