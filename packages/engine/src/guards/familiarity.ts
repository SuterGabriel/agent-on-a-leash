// Guard 11: "only shops I have used". Known = at least one approved purchase on THIS card.
// A shop used only with the customer's other card is a question, not a yes.
// A card with little history is judged on all the customer's cards ("baseline: customer").
// No history at all: we cannot tell, so we ask. Never a decline on missing history.
import type { Evidence } from "../../../shared/src/types";
import type { Guard } from "../types";

export const merchantFamiliarity: Guard = ({ auth, policy, card, base, customerId, habits, habitsScope, ledger, learned, peers }) => {
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
  // The customer confirmed this shop before (an approved ask, "Yes, it was me"), in any earlier run: it is known.
  const confirmed = learned?.shops.get(mId);
  if (confirmed) {
    return {
      guard: "familiarity",
      verdict: "PASS",
      evidence: [{ fact: "confirmed_by_you", value: confirmed.count, comparator: ">=", threshold: 1, source: `memory (last ${confirmed.last_at.slice(0, 10)})` }],
    };
  }
  const baseline = { fact: "baseline", value: habitsScope, comparator: null, threshold: null, source: "authorization_history" };

  if (habitsScope === "none") {
    // Always an ask, whatever the uncertainty policy says: missing history is not a reason to decline.
    // Customers like this one can tell the customer something useful, but they never make the shop "known".
    const peerShop = peers?.shops.get(mId);
    const evidence: Evidence[] = [{ fact: "card_history_purchases", value: card.purchases, comparator: ">=", threshold: 1, source: "authorization_history" }, baseline];
    if (peers) evidence.push({ fact: "peers_who_buy_here", value: peerShop?.neighbours ?? 0, comparator: null, threshold: null, source: `${peers.neighbours.length} customers like you` });
    const top = peers?.categories[0]?.category.replace(/_/g, " ");
    const hint = peerShop
      ? ` ${peerShop.neighbours} of ${peers!.neighbours.length} customers like you buy there.`
      : peers && top
        ? ` Customers like you mostly buy ${top}.`
        : "";
    return {
      guard: "familiarity",
      verdict: "STEP_UP",
      reason_code: "no_shop_history",
      evidence,
      message: `We have no purchase history for this card yet, so we cannot tell whether you know ${auth.merchant.merchant_name}.${hint} Approve it once and we remember it.`,
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
