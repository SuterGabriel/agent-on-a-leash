import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { buildEvent, loadDataPack, type EventMandate } from "@leash/shared";
import { PeerIndex } from "../src/coldstart/peers.js";
import { readProfileByKeywords } from "../src/coldstart/profileSignals.js";
import { LeashEngine } from "../src/engine/leashEngine.js";
import { compile, toMandateDraft } from "../src/compiler/compile.js";

// Cold start with invented customers: three with history (a grocer, a traveller, a gamer), one newcomer.

const pack = loadDataPack(fileURLToPath(new URL("../../../data", import.meta.url)));
type Row = Record<string, string>;

const customers: Row[] = [
  { customer_id: "C-GROCER", budget_style: "careful", home_region: "Lakeside", shopping_preferences: "Weekly supermarket runs.", typical_spending: "Small grocery payments.", background: "", travel_pattern: "" },
  { customer_id: "C-TRAVEL", budget_style: "flexible", home_region: "Hills", shopping_preferences: "Hotels and flights.", typical_spending: "Travel bookings.", background: "", travel_pattern: "Often in Germany." },
  { customer_id: "C-GAMER", budget_style: "balanced", home_region: "Hills", shopping_preferences: "Streaming and games in the evening.", typical_spending: "Online after 21:00.", background: "", travel_pattern: "" },
  { customer_id: "C-NEW", budget_style: "careful", home_region: "Lakeside", shopping_preferences: "Familiar supermarkets and fresh produce.", typical_spending: "Small grocery payments.", background: "", travel_pattern: "" },
];
const accounts: Row[] = customers.map((c, i) => ({ account_id: `A${i}`, customer_id: c.customer_id, per_transaction_limit_chf: c.budget_style === "careful" ? "800" : "3000", monthly_limit_chf: c.budget_style === "careful" ? "3000" : "9000", account_purpose: "daily_spending" }));
const cards: Row[] = customers.map((c, i) => ({ card_id: `K${i}`, account_id: `A${i}`, online_enabled: "true", international_enabled: "true", virtual_card: "false" }));
const buy = (customer: string, card: string, merchant: string, name: string, cat: string, chf: number, day: number, hour = 12, country = "CH"): Row => ({
  customer_id: customer, card_id: card, transaction_type: "purchase", status: "approved", merchant_id: merchant, merchant_name: name, merchant_category: cat,
  billing_amount_chf: String(chf), timestamp: `2026-05-${String(day).padStart(2, "0")}T${String(hour - 2).padStart(2, "0")}:00:00Z`, merchant_country: country, recurring: "false",
});
const history: Row[] = [
  ...Array.from({ length: 12 }, (_, i) => buy("C-GROCER", "K0", "M-FRESH", "Fresh Corner", "groceries", 30 + i, i + 1)),
  ...Array.from({ length: 12 }, (_, i) => buy("C-TRAVEL", "K1", "M-STAY", "Stay Well", "hotel", 300 + i * 10, i + 1, 14, "DE")),
  ...Array.from({ length: 12 }, (_, i) => buy("C-GAMER", "K2", "M-PLAY", "Play Loop", "entertainment", 15, i + 1, 22)),
];
const index = () => new PeerIndex({ customers, accounts, cards, history });

describe("profile signals from the customer's own words", () => {
  it("reads categories, late shopping, travel and known-shop preference", () => {
    const s = readProfileByKeywords({ shopping_preferences: "Refundable hotel rates and the same meal-delivery service.", typical_spending: "Mostly online after 21:00.", travel_pattern: "Trips to Austria." });
    expect(s.categories).toEqual(expect.arrayContaining(["hotel", "food_delivery"]));
    expect(s.night_owl).toBe(true);
    expect(s.travel_countries).toContain("AT");
    expect(s.prefers_refundable).toBe(true);
    expect(s.prefers_known_shops).toBe(true);
  });
});

describe("nearest neighbours for a customer without history", () => {
  it("the newcomer's closest neighbour is the one who shops like their profile says", () => {
    const i = index().insight("C-NEW")!;
    expect(i.neighbours[0]!.customer_id).toBe("C-GROCER");
    expect(i.neighbours[0]!.why.join(" ")).toMatch(/same budget style/);
    expect(i.predicted_categories[0]!.category).toBe("groceries");
    expect(i.predicted_categories[0]!.from).toEqual(["your profile", "customers like you"]);
  });

  it("a customer with enough history gets no cold start; the result is deterministic", () => {
    expect(index().insight("C-GROCER")).toBeNull();
    expect(JSON.stringify(index().insight("C-NEW"))).toBe(JSON.stringify(index().insight("C-NEW")));
  });

  it("peers never approve: a newcomer's purchase at a shop every neighbour uses still asks", () => {
    const peers = index();
    const parsed = compile("Groceries up to CHF 100 per order, only from shops I have used before. Ask me when unsure.");
    const draft = toMandateDraft(parsed, parsed.rules);
    const mandate: EventMandate = { mandate_id: "TM-CS", status: "active", customer_id: "C-NEW", card_id: "K3", instruction: draft.instruction, hard_rules: draft.hard_rules, uncertainty_policy: draft.uncertainty_policy, profile_id: "P" };
    const e = buildEvent(pack, pack.attempts.get("AU0001")!, { liveAuthorizationId: "L-CS", requestId: "r", mandate, relatedLiveId: null, context: { approved_spend_in_period_chf: 0, recent_authorizations: [] }, receivedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 8000).toISOString() });
    e.authorization.card_id = "K3";
    e.authorization.merchant.merchant_id = "M-FRESH";
    e.authorization.merchant.merchant_name = "Fresh Corner";
    const engine = new LeashEngine();
    engine.usePeers(peers.lookup);
    const v = engine.decide(e, { runId: "cs", currentMandate: null });
    expect(v.decision).toBe("step_up");
    expect(v.reason_codes).toContain("no_shop_history");
    expect(v.because).toMatch(/customers like you/i);
  });
});
