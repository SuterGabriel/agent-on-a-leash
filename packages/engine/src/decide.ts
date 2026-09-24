// decide(event, policy, ledger, baselines) -> decision with reasons, message and evidence.
import { EMPTY_CARD, type Baselines } from "../../shared/src/baselines";
import { itemTokens } from "../../shared/src/compiler";
import type { AuthorizationEvent, CartLine, Policy } from "../../shared/src/types";
import { aggregate } from "./aggregate";
import type { Ledger } from "./ledger";
import { quarantine, type ShopTextReport } from "./shoptext";
import type { DecisionResult, Facts, Guard, GuardResult } from "./types";
import { perOrderLimit } from "./guards/perOrderLimit";
import { periodBudget } from "./guards/periodBudget";
import { splitOrder } from "./guards/splitOrder";
import { itemScope } from "./guards/itemScope";
import { shopTextManipulation } from "./guards/shopText";
import { requestedItem } from "./guards/requestedItem";
import { unrequestedAddon } from "./guards/addon";
import { returnTerms } from "./guards/returnTerms";
import { merchantType } from "./guards/merchantType";
import { merchantFamiliarity } from "./guards/familiarity";
import { lookalikeMerchant } from "./guards/lookalike";
import { duplicateOrder } from "./guards/duplicate";
import { requote } from "./guards/requote";
import { sessionIntegrity } from "./guards/session";
import { perUnitLimit } from "./guards/perUnitLimit";
import { orderFrequency } from "./guards/orderFrequency";
import { allowedWeekday } from "./guards/weekday";
import { blockedItems } from "./guards/blocked";
import { refundableOrder } from "./guards/refundable";
import { issuerLimits } from "./guards/issuerLimits";
import { destination } from "./guards/destination";

export const ENGINE_VERSION = "leash-0.3.0";

/** Below this many approved purchases, a card is judged on all the customer's cards. */
export const MIN_CARD_HISTORY = 10;

// Order matters only for the order of reason codes among equally strict findings.
export const GUARDS: Guard[] = [
  perOrderLimit,
  issuerLimits,
  perUnitLimit,
  periodBudget,
  orderFrequency,
  allowedWeekday,
  splitOrder,
  itemScope,
  blockedItems,
  requestedItem,
  unrequestedAddon,
  returnTerms,
  refundableOrder,
  destination,
  merchantType,
  merchantFamiliarity,
  lookalikeMerchant,
  duplicateOrder,
  sessionIntegrity,
  shopTextManipulation,
  requote,
];

const ADDON_CATEGORIES = new Set(["subscriptions", "membership"]);
const ADDON_NAME = /protection\s+plan|insurance|extended\s+warranty|add[-\s]?on|membership|subscription/i;

/** Lines that are extras on top of what was asked for. */
function findAddonLines(items: CartLine[], policy: Policy, shop: ShopTextReport): Set<number> {
  const req = policy.requestedItem;
  const isRequested = (i: CartLine) => {
    if (!req) return false;
    const t = new Set(itemTokens(i.item_name));
    return req.tokens.every((x) => t.has(x));
  };
  const out = new Set<number>();
  for (const i of items) {
    if (isRequested(i)) continue;
    const recurring = shop.lines.find((l) => l.line_no === i.line_no)?.billedRecurring ?? false;
    if (ADDON_CATEGORIES.has(i.item_category) || ADDON_NAME.test(i.item_name) || recurring) out.add(i.line_no);
  }
  return out;
}

function runGuard(g: Guard, f: Facts): GuardResult {
  try {
    return g(f);
  } catch (err) {
    return {
      guard: g.name || "unknown",
      verdict: "STEP_UP",
      reason_code: "guard_error",
      message: "One of our checks failed, so we ask you to confirm this purchase.",
      evidence: [{ fact: "guard_error", value: String(err), comparator: null, threshold: null, source: "engine" }],
    };
  }
}

export function decide(
  event: AuthorizationEvent,
  policy: Policy,
  ledger: Ledger,
  base: Baselines,
  guards = GUARDS,
): DecisionResult {
  const t0 = performance.now();
  const auth = event.authorization;

  // Guard 1: retry. Same live ID -> same stored answer, counted once.
  const seen = ledger.get(auth.authorization_id);
  if (seen) {
    const stored = seen.stored_result as DecisionResult;
    return { ...stored, replayed: true, elapsed_ms: performance.now() - t0 };
  }

  const shop = quarantine(auth.items);
  const card = base.cards.get(auth.card_id) ?? EMPTY_CARD;
  const customerId = event.mandate.customer_id ?? base.cardCustomer.get(auth.card_id) ?? null;
  const customerHabits = customerId ? base.customers.get(customerId) : undefined;
  const habitsScope: Facts["habitsScope"] =
    card.purchases >= MIN_CARD_HISTORY ? "card" : customerHabits && customerHabits.purchases > card.purchases ? "customer" : card.purchases > 0 ? "card" : "none";
  const facts: Facts = {
    auth,
    policy,
    ledger,
    simTime: Date.parse(auth.timestamp),
    base,
    card,
    habits: habitsScope === "customer" && customerHabits ? customerHabits : card,
    habitsScope,
    customerId,
    shop,
    addonLines: findAddonLines(auth.items, policy, shop),
  };

  const results = guards.map((g) => runGuard(g, facts));
  const { decision, reason_codes, lead } = aggregate(results, policy.uncertainty);

  let message =
    lead?.message ?? `${auth.merchant.merchant_name}, CHF ${auth.billing_amount_chf.toFixed(2)}: within your rules.`;
  if (shop.flagged.length && lead?.guard !== "shop_text") {
    message += ` The shop's text also tried to instruct your agent ("${shop.flagged[0].text}"). We ignored it.`;
  }

  const result: DecisionResult = {
    authorization_id: auth.authorization_id,
    decision,
    reason_codes: reason_codes.length ? reason_codes : ["all_checks_passed"],
    customer_message: message,
    evidence: results.flatMap((r) => r.evidence),
    engine_version: ENGINE_VERSION,
    guards: results,
    flagged_shop_text: shop.flagged.map((f) => f.text),
    elapsed_ms: 0,
    replayed: false,
  };
  result.elapsed_ms = performance.now() - t0;

  ledger.record({
    authorization_id: auth.authorization_id,
    decision,
    final_status: decision === "approve" ? "approved" : decision === "decline" ? "declined" : "pending",
    amount_chf: auth.billing_amount_chf,
    merchant_id: auth.merchant.merchant_id,
    item_signature: auth.items.map((i) => `${i.item_id}x${i.quantity}`).sort().join("|"),
    sim_time: facts.simTime,
    stored_result: result,
  });

  return result;
}

/** Only the fields the Viseca platform accepts. */
export function toPlatformBody(r: DecisionResult) {
  return {
    authorization_id: r.authorization_id,
    decision: r.decision,
    reason_codes: r.reason_codes,
    customer_message: r.customer_message,
    evidence: r.evidence,
    engine_version: r.engine_version,
  };
}
