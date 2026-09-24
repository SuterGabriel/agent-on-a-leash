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
    expect(rules.find((r) => r.key === "known_shop")!.label).toBe("Only shops you've bought from, with either card");
    expect(rules.find((r) => r.key === "known_shop")!.hard_rule).toEqual({ field: "merchant.familiar_on_card", operator: "=", value: "true" });
    expect(toMandateDraft(parsed, rules, { [QUESTION_IDS.splitOrders]: "Yes", [QUESTION_IDS.otherCard]: "Yes" }).open_questions).toEqual([]);
  });
});

describe("a limit per night or per item is not a limit per order", () => {
  const hard = (text: string) => {
    const p = compile(text);
    return toMandateDraft(p, p.rules).hard_rules;
  };

  it("'at most CHF 200 per night' writes a unit-price rule and no order limit", () => {
    const rules = hard("Book a hotel for 3 nights, at most CHF 200 per night, refundable rate only. Ask me when uncertain.");
    expect(rules.find((r) => r.field === "items.unit_price_chf")).toMatchObject({ operator: "<=", value: 200 });
    expect(rules.find((r) => r.field === "authorization.billing_amount_chf")).toBeUndefined();
    const parsed = compile("Book a hotel for 3 nights, at most CHF 200 per night, refundable rate only. Ask me when uncertain.");
    expect(parsed.rules.find((r) => r.key === "unit_limit")?.label).toBe("CHF 200 per night or less");
    expect(parsed.rules.find((r) => r.key === "unit_limit")?.your_words?.text).toBe("at most CHF 200 per night");
  });

  it("'CHF 60 a night' and 'CHF 25 each' are unit limits; 'purchases up to CHF 70 each' stays an order limit", () => {
    expect(hard("Rooms for up to CHF 60 a night.").find((r) => r.field === "items.unit_price_chf")).toMatchObject({ operator: "<=", value: 60 });
    expect(hard("Tickets at CHF 25 each.").find((r) => r.field === "items.unit_price_chf")).toMatchObject({ value: 25 });
    const orders = hard("Purchases of up to CHF 70 each.");
    expect(orders.find((r) => r.field === "items.unit_price_chf")).toBeUndefined();
    expect(orders.find((r) => r.field === "authorization.billing_amount_chf")).toMatchObject({ value: 70, scope: "purchase" });
  });

  it("an order limit next to a unit limit is still read", () => {
    const rules = hard("Each order at or below CHF 500, and no more than CHF 120 per item.");
    expect(rules.find((r) => r.field === "authorization.billing_amount_chf")).toMatchObject({ value: 500 });
    expect(rules.find((r) => r.field === "items.unit_price_chf")).toMatchObject({ value: 120 });
  });
});

describe("a stay: destination and nights become chips the engine reads back", () => {
  it("'A hotel in Lyon for 3 nights' gives a Stay in Lyon chip and a 3 nights chip with hard rules", () => {
    const parsed = compile("A hotel in Lyon for 3 nights, at most CHF 150 per night. Ask me when uncertain.");
    const city = parsed.rules.find((r) => r.key === "destination");
    const nights = parsed.rules.find((r) => r.key === "nights");
    expect(city?.label).toBe("Stay in Lyon");
    expect(city?.your_words?.text).toBe("hotel in Lyon");
    expect(city?.hard_rule).toEqual({ field: "order.destination_city", operator: "=", value: "Lyon" });
    expect(nights?.label).toBe("3 nights");
    expect(nights?.hard_rule).toEqual({ field: "order.nights", operator: "=", value: 3 });
    expect(parsed.not_understood).toEqual([]);
  });
  it("no stay, no chips", () => {
    const keys = compile("Groceries up to CHF 100 per order.").rules.map((r) => r.key);
    expect(keys).not.toContain("destination");
    expect(keys).not.toContain("nights");
  });
});
