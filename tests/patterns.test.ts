// General instruction patterns and the guards behind them.
// Every phrase here is invented for the test; none is copied from a scenario.
import { describe, expect, it } from "vitest";
import { buildBaselines, swissWeekday, type Baselines } from "../packages/shared/src/baselines";
import { compilePolicy, toHardRules } from "../packages/shared/src/compiler";
import { buildEvent } from "../packages/shared/src/csvEvent";
import { loadDataPack, type Row } from "../packages/shared/src/loaders";
import type { AuthorizationEvent } from "../packages/shared/src/types";
import { decide } from "../packages/engine/src/decide";
import { Ledger } from "../packages/engine/src/ledger";
import { getBaselines } from "../packages/engine/src/replay";

const pack = loadDataPack();
// A clean purchase from the public set (one electronics line, returnable, known shop on its card).
const BASE = pack.attempts.find((a) => a.card_id === "CA0039" && a.replay_order === "1")!;

function event(instruction: string, mutate: (e: AuthorizationEvent) => void = () => {}, run = `t${Math.random()}`): AuthorizationEvent {
  const p = compilePolicy(instruction);
  const e = buildEvent(pack, BASE, { mandate_id: "TM_t", instruction, hard_rules: toHardRules(p), uncertainty_policy: p.uncertainty }, run);
  mutate(e);
  return e;
}
const run = (instruction: string, e: AuthorizationEvent, ledger = new Ledger(), base: Baselines = getBaselines()) =>
  decide(e, compilePolicy(instruction), ledger, base);

describe("A1 amounts in any currency, period word before or after", () => {
  it("converts EUR, GBP, USD and francs to CHF with the fixed rates", () => {
    expect(compilePolicy("Spend at most EUR 80 per order.").perOrderLimitChf).toBe(76);
    expect(compilePolicy("Keep it under £50.").perOrderLimitChf).toBe(56);
    expect(compilePolicy("No more than USD 100 for the lot.").perOrderLimitChf).toBe(87);
    expect(compilePolicy("Up to 30 francs.").perOrderLimitChf).toBe(30);
    expect(compilePolicy("Fr. 45 maximum.").perOrderLimitChf).toBe(45);
  });
  it("reads the period after or before the amount", () => {
    expect(compilePolicy("A budget of CHF 400 over any 14-day period.").periodLimit).toEqual({ amountChf: 400, days: 14 });
    expect(compilePolicy("Spend CHF 90 per week at most.").periodLimit).toEqual({ amountChf: 90, days: 7 });
    expect(compilePolicy("Weekly spending up to CHF 120.").periodLimit).toEqual({ amountChf: 120, days: 7 });
    const both = compilePolicy("CHF 60 per order or CHF 200 in any 10-day stretch.");
    expect(both.perOrderLimitChf).toBe(60);
    expect(both.periodLimit).toEqual({ amountChf: 200, days: 10 });
  });
});

describe("A2 per-unit limits", () => {
  it("per night / per item / each, but 'purchases … each' stays per order", () => {
    expect(compilePolicy("A room for at most CHF 150 per night.").perUnitLimit).toEqual({ amountChf: 150, unit: "night" });
    expect(compilePolicy("A room for at most CHF 150 per night.").perOrderLimitChf).toBeNull();
    expect(compilePolicy("Stickers at CHF 3 per item.").perUnitLimit).toEqual({ amountChf: 3, unit: "item" });
    expect(compilePolicy("Tickets at CHF 25 each.").perUnitLimit).toEqual({ amountChf: 25, unit: "item" });
    const orders = compilePolicy("Purchases of up to CHF 70 each.");
    expect(orders.perUnitLimit).toBeNull();
    expect(orders.perOrderLimitChf).toBe(70);
  });
});

describe("A3 how often", () => {
  it("counts per day, week and month", () => {
    expect(compilePolicy("At most two orders per week.").maxOrdersPerPeriod).toEqual({ count: 2, days: 7 });
    expect(compilePolicy("Once a day is enough.").maxOrdersPerPeriod).toEqual({ count: 1, days: 1 });
    expect(compilePolicy("Three deliveries a month.").maxOrdersPerPeriod).toEqual({ count: 3, days: 30 });
    expect(compilePolicy("Spend CHF 50 a day.").maxOrdersPerPeriod).toBeNull(); // an amount, not a count
  });
});

describe("A4 days", () => {
  it("weekends, weekdays and single days", () => {
    expect(compilePolicy("Not on weekends.").allowedWeekdays).toEqual([1, 2, 3, 4, 5]);
    expect(compilePolicy("Weekdays only.").allowedWeekdays).toEqual([1, 2, 3, 4, 5]);
    expect(compilePolicy("Never on Sundays.").allowedWeekdays).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("A5 exclusions", () => {
  it("maps negated terms to real categories and keywords", () => {
    const p = compilePolicy("No tobacco, no vouchers, no make-up.");
    expect(p.blockedCategories).toEqual(expect.arrayContaining(["gift_card", "cosmetics"]));
    expect(p.blockedKeywords).toEqual(expect.arrayContaining(["tobacco", "voucher", "makeup"]));
    expect(compilePolicy("Book it without insurance.").blockedKeywords).toContain("insurance");
    expect(compilePolicy("No beer, no plane tickets, no premium plans, no yearly billing.").blockedKeywords).toEqual(
      expect.arrayContaining(["beer", "flight", "premium", "annual"]),
    );
  });
  it("a negated category is blocked, not allowed", () => {
    const p = compilePolicy("Groceries are fine but no gadgets.");
    expect(p.allowedCategories).toEqual(["groceries"]);
    expect(p.blockedCategories).toEqual(["electronics"]);
  });
});

describe("A6 categories", () => {
  it("knows the new categories and their synonyms", () => {
    expect(compilePolicy("Household essentials, up to CHF 40.").allowedCategories).toEqual(["household"]);
    expect(compilePolicy("Hotels only.").allowedCategories).toEqual(["hotel"]);
    expect(compilePolicy("A streaming subscription.").allowedCategories).toEqual(["subscriptions", "membership"]);
    expect(compilePolicy("Gadgets under CHF 50.").allowedCategories).toEqual(["electronics"]);
    expect(compilePolicy("Stock up at the supermarket.").allowedCategories).toEqual(["groceries"]);
  });
});

describe("A7 requested item", () => {
  it("need / want / looking for", () => {
    expect(compilePolicy("I want a new espresso machine.").requestedItem?.phrase).toBe("espresso machine");
    expect(compilePolicy("I'm looking for a winter coat, size M.").requestedItem?.phrase).toBe("winter coat");
    expect(compilePolicy("I need trail shoes.").requestedItem?.phrase).toBe("trail shoes");
  });
});

describe("A8 returns", () => {
  it("days, or returnable / refundable without days", () => {
    expect(compilePolicy("It must be returnable for at least 30 days.").minReturnDays).toBe(30);
    expect(compilePolicy("I must be able to return it within at least 21 days.").minReturnDays).toBe(21);
    expect(compilePolicy("Only if it can be refunded.").refundableRequired).toBe(true);
    expect(compilePolicy("Free cancellation only.").refundableRequired).toBe(true);
    expect(compilePolicy("It must be returnable for at least 30 days.").refundableRequired).toBe(false);
  });
});

describe("A9 known shops", () => {
  it("already know / my usual / no new", () => {
    expect(compilePolicy("From vendors I already know.").familiarShopsOnly).toBe(true);
    expect(compilePolicy("Use my regular stores.").familiarShopsOnly).toBe(true);
    expect(compilePolicy("No new providers.").familiarShopsOnly).toBe(true);
    expect(compilePolicy("Any shop is fine.").familiarShopsOnly).toBe(false);
  });
});

describe("A10–A12 extras, session, doubt", () => {
  it("nothing else / only that item", () => {
    expect(compilePolicy("Nothing else in the cart.").noExtras).toBe(true);
    expect(compilePolicy("Buy only that item.").noExtras).toBe(true);
  });
  it("session wording", () => {
    expect(compilePolicy("If the session seems odd, pause it.").sessionIntegrity).toBe(true);
    expect(compilePolicy("Stop anything that doesn't look like me.").sessionIntegrity).toBe(true);
  });
  it("ask or decline when unsure", () => {
    expect(compilePolicy("When in doubt, decline.").uncertainty).toBe("decline");
    expect(compilePolicy("If you are not sure, reject it.").uncertainty).toBe("decline");
    const ask = compilePolicy("If unsure, ask.");
    expect(ask.uncertainty).toBe("ask");
    expect(ask.assumptions.some((a) => a.startsWith("No rule for uncertain"))).toBe(false);
    expect(compilePolicy("Ask me first.").assumptions.some((a) => a.startsWith("No rule for uncertain"))).toBe(false);
  });
});

describe("B guards", () => {
  it("per-unit limit compares each line's unit price", () => {
    const I = "Rooms at most CHF 100 per night.";
    const over = run(I, event(I, (e) => { e.authorization.items[0].unit_price = 150; e.authorization.items[0].currency = "CHF"; }));
    expect(over.decision).toBe("decline");
    expect(over.reason_codes).toContain("over_unit_limit");
    const ok = run(I, event(I, (e) => { e.authorization.items[0].unit_price = 90; e.authorization.items[0].currency = "CHF"; }));
    expect(ok.decision).toBe("approve");
  });

  it("order frequency uses the ledger and simulated time (one a day)", () => {
    const I = "At most one order a day.";
    const ledger = new Ledger();
    const first = run(I, event(I, () => {}, "f1"), ledger);
    expect(first.decision).toBe("approve");
    const later = event(I, (e) => { e.authorization.timestamp = new Date(Date.parse(e.authorization.timestamp) + 60 * 60 * 1000).toISOString(); }, "f2");
    const second = run(I, later, ledger);
    expect(second.decision).toBe("decline");
    expect(second.reason_codes).toContain("too_many_orders");
    const nextDay = event(I, (e) => { e.authorization.timestamp = new Date(Date.parse(e.authorization.timestamp) + 26 * 60 * 60 * 1000).toISOString(); }, "f3");
    expect(run(I, nextDay, ledger).reason_codes).not.toContain("too_many_orders");
  });

  it("allowed weekdays, in Swiss time", () => {
    const I = "Please shop Monday to Friday.";
    const saturday = "2026-08-08T10:00:00Z";
    const wednesday = "2026-08-05T10:00:00Z";
    expect(swissWeekday(Date.parse(saturday))).toBe(6);
    expect(swissWeekday(Date.parse(wednesday))).toBe(3);
    const sat = run(I, event(I, (e) => { e.authorization.timestamp = saturday; }));
    expect(sat.decision).toBe("decline");
    expect(sat.reason_codes).toContain("not_allowed_day");
    expect(run(I, event(I, (e) => { e.authorization.timestamp = wednesday; })).reason_codes).not.toContain("not_allowed_day");
  });

  it("blocked keywords in the item name and in clean shop text; a negated mention is not a hit", () => {
    const I = "No wine or beer, and no vouchers.";
    const wine = run(I, event(I, (e) => { e.authorization.items[0].item_name = "Red wine selection"; }));
    expect(wine.decision).toBe("decline");
    expect(wine.reason_codes).toContain("blocked_item");
    const inText = run(I, event(I, (e) => { e.authorization.items[0].item_details = "Comes with a gift voucher worth CHF 10."; }));
    expect(inText.reason_codes).toContain("blocked_item");
    const negated = run(I, event(I, (e) => { e.authorization.items[0].item_details = "No voucher included."; }));
    expect(negated.reason_codes).not.toContain("blocked_item");
  });

  it("refundable only: unknown asks, non-refundable declines, stated passes", () => {
    const I = "Only if it is refundable.";
    const unknown = run(I, event(I, (e) => { e.authorization.order_returnable = "unknown"; e.authorization.order_cancellable = "unknown"; e.authorization.items[0].item_details = "Ships in two days."; }));
    expect(unknown.decision).toBe("step_up");
    const nonRef = run(I, event(I, (e) => { e.authorization.items[0].item_name = "Room, non-refundable rate"; }));
    expect(nonRef.decision).toBe("decline");
    expect(nonRef.reason_codes).toContain("not_refundable");
    const ok = run(I, event(I, (e) => { e.authorization.order_returnable = "true"; }));
    expect(ok.reason_codes).not.toContain("not_refundable");
    expect(ok.reason_codes).not.toContain("missing_info");
  });
});

describe("C card with little history", () => {
  const row = (card: string, merchant: string, i: number): Row => ({
    card_id: card, customer_id: "CU_T", transaction_type: "purchase", status: "approved", merchant_id: merchant,
    customer_device_id: "DV_T", recurring: "false", timestamp: `2026-06-${String(1 + (i % 28)).padStart(2, "0")}T12:00:00Z`, merchant_country: "CH",
  });
  const history = [...Array.from({ length: 12 }, (_, i) => row("CA_BIG", "ME_KNOWN", i)), row("CA_THIN", "ME_OTHER", 1)];
  const base = buildBaselines(history, new Map());
  const onCard = (card: string, merchant: string, customer: string) => (e: AuthorizationEvent) => {
    e.authorization.card_id = card;
    e.mandate.customer_id = customer;
    e.authorization.merchant.merchant_id = merchant;
  };

  it("uses all the customer's cards and says so in the evidence", () => {
    const I = "Only from shops I already use.";
    const r = run(I, event(I, onCard("CA_THIN", "ME_KNOWN", "CU_T")), new Ledger(), base);
    const fam = r.guards.find((g) => g.guard === "familiarity")!;
    expect(fam.verdict).toBe("PASS");
    expect(fam.evidence).toContainEqual(expect.objectContaining({ fact: "baseline", value: "customer" }));
  });

  it("no history at all: asks, never declines, even when the customer says decline when unsure", () => {
    const I = "Only from shops I already use. When in doubt, decline.";
    const r = run(I, event(I, onCard("CA_NONE", "ME_KNOWN", "CU_NONE")), new Ledger(), base);
    expect(r.decision).toBe("step_up");
    expect(r.reason_codes).toContain("no_shop_history");
  });

  it("session with no history at all only asks", () => {
    const I = "Stop anything that doesn't look like me.";
    const r = run(I, event(I, onCard("CA_NONE", "ME_KNOWN", "CU_NONE")), new Ledger(), base);
    expect(r.decision).toBe("step_up");
  });
});

describe("lookalike against every established shop at the issuer", () => {
  const hist = (merchant: string, name: string, category: string, customer: string, i: number): Row => ({
    card_id: `CA_${customer}`, customer_id: customer, account_id: `AC_${customer}`, transaction_type: "purchase", status: "approved",
    merchant_id: merchant, merchant_name: name, merchant_category: category, customer_device_id: "DV_X", recurring: "false",
    timestamp: `2026-05-${String(1 + i).padStart(2, "0")}T12:00:00Z`, merchant_country: "CH",
  });
  const history = [
    ...Array.from({ length: 5 }, (_, i) => hist("ME_EST", "Harbourline Grocers", "groceries", "CU_OTHER", i)),
    hist("ME_TWIN", "Harbourline Grocer", "groceries", "CU_OTHER", 9), // similar name, but an established shop itself
  ];
  const base = buildBaselines(history, new Map());
  const I = "Up to CHF 500 per order.";
  const at = (id: string, name: string, category = "groceries") => (e: AuthorizationEvent) => {
    e.authorization.merchant.merchant_id = id;
    e.authorization.merchant.merchant_name = name;
    e.authorization.merchant.merchant_category = category;
    e.authorization.card_id = "CA_NEWCOMER";
    e.mandate.customer_id = "CU_NEWCOMER";
  };

  it("a never-used shop named almost like an established one is a question, even for a customer with no history", () => {
    // The customer never bought at the original, so it may be their usual shop with a different spelling: ask, never decline.
    const r = run(I, event(I, at("ME_FAKE", "Harbourlime Grocers")), new Ledger(), base);
    expect(r.decision).toBe("step_up");
    expect(r.reason_codes).toContain("lookalike_shop");
  });
  it("a spelling twin of an established shop in another town is asked about, not stopped", () => {
    const twin = [...history, ...Array.from({ length: 20 }, (_, i) => hist("ME_ORIG", "Moonlit Noodle Bar", "restaurants", "CU_OTHER", i))];
    const r = run(I, event(I, at("ME_MINE", "Moon lit Noodle Bar", "restaurants")), new Ledger(), buildBaselines(twin, new Map()));
    expect(r.decision).toBe("step_up");
    expect(r.reason_codes).toContain("lookalike_shop");
  });
  it("two established shops with similar names are just two shops", () => {
    expect(run(I, event(I, at("ME_TWIN", "Harbourline Grocer")), new Ledger(), base).reason_codes).not.toContain("lookalike_shop");
  });
  it("another category or a clearly different name is not a lookalike", () => {
    expect(run(I, event(I, at("ME_FAKE", "Harbourlime Grocers", "electronics")), new Ledger(), base).reason_codes).not.toContain("lookalike_shop");
    expect(run(I, event(I, at("ME_FAKE", "Birchwood Pantry")), new Ledger(), base).reason_codes).not.toContain("lookalike_shop");
  });
});

describe("issuer limits: the card's own per-purchase limit", () => {
  const base = buildBaselines([], new Map(), {
    cards: [{ card_id: "CA_LIM", account_id: "AC_LIM" }],
    accounts: [{ account_id: "AC_LIM", per_transaction_limit_chf: "300", monthly_limit_chf: "1000" }],
  });
  const I = "Up to CHF 5000 per order.";
  const onCard = (card: string, chf: number) => (e: AuthorizationEvent) => {
    e.authorization.card_id = card;
    e.authorization.billing_amount_chf = chf;
  };

  it("above the account's per-transaction limit declines, even when the customer allows more", () => {
    const r = run(I, event(I, onCard("CA_LIM", 350)), new Ledger(), base);
    expect(r.decision).toBe("decline");
    expect(r.reason_codes).toContain("over_card_limit");
  });
  it("exactly at the limit passes, and a card with no known limit is not checked", () => {
    expect(run(I, event(I, onCard("CA_LIM", 300)), new Ledger(), base).reason_codes).not.toContain("over_card_limit");
    const unknown = run(I, event(I, onCard("CA_UNLISTED", 9000)), new Ledger(), base);
    expect(unknown.guards.find((g) => g.guard === "issuer_limits")?.verdict).toBe("SKIP");
  });
});

describe("a shop the customer approved in this run is a shop they use", () => {
  const I = "Only from shops I have used before, up to CHF 500 per order.";
  // `daysLater` moves the purchase on and changes the basket, so the second order is not a duplicate of the first.
  const newcomer = (id: string, name: string, daysLater = 0) => (e: AuthorizationEvent) => {
    e.authorization.merchant.merchant_id = id;
    e.authorization.merchant.merchant_name = name;
    e.authorization.merchant.merchant_category = "groceries";
    e.authorization.card_id = "CA_NEWCOMER";
    e.mandate.customer_id = "CU_NEWCOMER";
    if (daysLater) {
      e.authorization.timestamp = new Date(Date.parse(e.authorization.timestamp) + daysLater * 86_400_000).toISOString();
      e.authorization.items[0].quantity += daysLater;
    }
  };

  it("first purchase asks (no history), the customer says yes, the second one at the same shop is approved", () => {
    const ledger = new Ledger();
    const first = run(I, event(I, newcomer("ME_LOCAL", "Corner Larder"), "same-run-1"), ledger);
    expect(first.decision).toBe("step_up");
    expect(first.reason_codes).toContain("no_shop_history");
    ledger.resolve(first.authorization_id, "approve");
    const second = run(I, event(I, newcomer("ME_LOCAL", "Corner Larder", 3), "same-run-2"), ledger);
    expect(second.decision).toBe("approve");
    expect(second.reason_codes).not.toContain("no_shop_history");
  });

  it("a declined ask teaches nothing, and another shop is still asked about", () => {
    const ledger = new Ledger();
    const first = run(I, event(I, newcomer("ME_LOCAL", "Corner Larder"), "same-run-3"), ledger);
    ledger.resolve(first.authorization_id, "decline");
    expect(run(I, event(I, newcomer("ME_LOCAL", "Corner Larder", 2), "same-run-4"), ledger).decision).toBe("step_up");
    ledger.resolve(run(I, event(I, newcomer("ME_LOCAL", "Corner Larder", 4), "same-run-5"), ledger).authorization_id, "approve");
    expect(run(I, event(I, newcomer("ME_OTHER", "Birch Street Deli", 6), "same-run-6"), ledger).decision).toBe("step_up");
  });

  it("the same-run approval also clears the lookalike check for that shop", () => {
    const hist = (i: number): Row => ({
      card_id: "CA_X", customer_id: "CU_X", account_id: "AC_X", transaction_type: "purchase", status: "approved",
      merchant_id: "ME_EST", merchant_name: "Corner Larders", merchant_category: "groceries", customer_device_id: "DV_X", recurring: "false",
      timestamp: `2026-05-${String(1 + i).padStart(2, "0")}T12:00:00Z`, merchant_country: "CH",
    });
    const base = buildBaselines(Array.from({ length: 5 }, (_, i) => hist(i)), new Map());
    const ledger = new Ledger();
    const first = run(I, event(I, newcomer("ME_LOCAL", "Corner Larder"), "same-run-7"), ledger, base);
    expect(first.reason_codes).toContain("lookalike_shop");
    ledger.resolve(first.authorization_id, "approve");
    const second = run(I, event(I, newcomer("ME_LOCAL", "Corner Larder", 3), "same-run-8"), ledger, base);
    expect(second.reason_codes).not.toContain("lookalike_shop");
    expect(second.decision).toBe("approve");
  });
});

describe("session: 'stop and ask me' asks, 'pause anything' stops", () => {
  const ASK = "Small purchases up to CHF 300. If the session looks unusual, a new device or shops abroad, stop and ask me.";
  const STOP = "Small purchases up to CHF 300. Pause anything that looks like someone other than me is driving the session.";
  const threeSignals = (e: AuthorizationEvent) => {
    e.authorization.customer_device_id = "DVC-NEVER-SEEN";
    e.authorization.merchant.merchant_country = "JP";
    e.authorization.merchant.merchant_id = "ME_UNKNOWN";
    e.authorization.merchant.merchant_name = "Shinjuku Gadgets";
  };

  it("the compiler reads the action from the customer's words", () => {
    expect(compilePolicy(ASK).sessionIntegrity).toBe(true);
    expect(compilePolicy(ASK).sessionAction).toBe("ask");
    expect(compilePolicy(STOP).sessionAction).toBe("stop");
    expect(compilePolicy("If it doesn't look like me, don't ask, just decline.").sessionAction).toBe("stop");
    expect(toHardRules(compilePolicy(ASK)).find((r) => r.field === "session.integrity")?.value).toBe("ask");
    expect(toHardRules(compilePolicy(STOP)).find((r) => r.field === "session.integrity")?.value).toBe("required");
  });

  it("three signals: asked under 'stop and ask me', declined under 'pause anything'", () => {
    const asked = run(ASK, event(ASK, threeSignals));
    expect(asked.reason_codes).toContain("session_not_you");
    expect(asked.decision).toBe("step_up");
    const stopped = run(STOP, event(STOP, threeSignals));
    expect(stopped.reason_codes).toContain("session_not_you");
    expect(stopped.decision).toBe("decline");
  });
});
