// Guard 11: "only shops I have used". Known = at least one approved purchase on THIS card.
// A shop used only with the customer's other card is a question, not a yes.
import type { Guard } from "../types";

export const merchantFamiliarity: Guard = ({ auth, policy, card, base, customerId }) => {
  if (!policy.familiarShopsOnly) return { guard: "familiarity", verdict: "SKIP", evidence: [] };
  const mId = auth.merchant.merchant_id;
  const onCard = card.merchants.get(mId) ?? 0;
  const onCustomer = customerId ? base.customerMerchants.get(customerId)?.get(mId) ?? 0 : 0;
  const onOtherCards = onCustomer - onCard;
  const evidence = [
    { fact: "approved_purchases_this_card", value: onCard, comparator: ">=", threshold: 1, source: "authorization_history" },
    { fact: "approved_purchases_other_cards", value: onOtherCards, comparator: null, threshold: null, source: "authorization_history" },
  ];
  if (onCard > 0) return { guard: "familiarity", verdict: "PASS", evidence };
  if (onOtherCards > 0) {
    return { guard: "familiarity", verdict: "STEP_UP", reason_code: "shop_used_other_card", evidence, message: `You bought at ${auth.merchant.merchant_name} ${onOtherCards}× with your other card, never with this one. Count it as a shop you know?` };
  }
  return { guard: "familiarity", verdict: "STEP_UP", reason_code: "new_shop", evidence, message: `You have never bought at ${auth.merchant.merchant_name}. You asked for shops you have used before.` };
};
