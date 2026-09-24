// Guard 11: "only shops I have used". Known = at least one approved purchase on THIS card.
// A shop used only with the customer's other card is a question, not a yes.
// A card with little history is judged on all the customer's cards ("baseline: customer").
// No history at all: we cannot tell, so we ask. Never a decline on missing history.
import type { Guard } from "../types";

export const merchantFamiliarity: Guard = ({ auth, policy, card, base, customerId, habits, habitsScope, ledger }) => {
  if (!policy.familiarShopsOnly) return { guard: "familiarity", verdict: "SKIP", evidence: [] };
  const mId = auth.merchant.merchant_id;

  // The customer already said yes to this shop in this run (or it passed): it is a shop they use now.
  const approvedHere = ledger.approvedAtMerchant(mId);
  if (approvedHere > 0) {
    return {
      guard: "familiarity",
      verdict: "PASS",
      evidence: [{ fact: "approved_in_this_run", value: approvedHere, comparator: ">=", threshold: 1, source: "ledger" }],
    };
  }
  const baseline = { fact: "baseline", value: habitsScope, comparator: null, threshold: null, source: "authorization_history" };

  if (habitsScope === "none") {
    // Always an ask, whatever the uncertainty policy says: missing history is not a reason to decline.
    return {
      guard: "familiarity",
      verdict: "STEP_UP",
      reason_code: "no_shop_history",
      evidence: [{ fact: "card_history_purchases", value: card.purchases, comparator: ">=", threshold: 1, source: "authorization_history" }, baseline],
      message: `We have no purchase history for this card or its owner, so we cannot tell whether you know ${auth.merchant.merchant_name}. Is it a shop you use?`,
    };
  }

  if (habitsScope === "customer") {
    const onAnyCard = habits.merchants.get(mId) ?? 0;
    const evidence = [{ fact: "approved_purchases_any_card", value: onAnyCard, comparator: ">=", threshold: 1, source: "authorization_history" }, baseline];
    if (onAnyCard > 0) return { guard: "familiarity", verdict: "PASS", evidence };
    return { guard: "familiarity", verdict: "STEP_UP", reason_code: "new_shop", evidence, message: `You have never bought at ${auth.merchant.merchant_name}. You asked for shops you have used before.` };
  }

  const onCard = card.merchants.get(mId) ?? 0;
  const onCustomer = customerId ? base.customerMerchants.get(customerId)?.get(mId) ?? 0 : 0;
  const onOtherCards = onCustomer - onCard;
  const evidence = [
    { fact: "approved_purchases_this_card", value: onCard, comparator: ">=", threshold: 1, source: "authorization_history" },
    { fact: "approved_purchases_other_cards", value: onOtherCards, comparator: null, threshold: null, source: "authorization_history" },
    baseline,
  ];
  if (onCard > 0) return { guard: "familiarity", verdict: "PASS", evidence };
  if (onOtherCards > 0) {
    return { guard: "familiarity", verdict: "STEP_UP", reason_code: "shop_used_other_card", evidence, message: `You bought at ${auth.merchant.merchant_name} ${onOtherCards}× with your other card, never with this one. Count it as a shop you know?` };
  }
  return { guard: "familiarity", verdict: "STEP_UP", reason_code: "new_shop", evidence, message: `You have never bought at ${auth.merchant.merchant_name}. You asked for shops you have used before.` };
};
