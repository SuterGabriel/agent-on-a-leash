// Guard 13: duplicate order. Different live ID, but same shop, same items, same amount (±5 %)
// within 2 hours of an approved order. (A retry, same live ID, is handled in decide.ts.)
import type { Guard } from "../types";

const WINDOW_MS = 2 * 60 * 60 * 1000;

export const duplicateOrder: Guard = ({ auth, ledger, simTime }) => {
  if (auth.related_authorization_status === "declined" || auth.related_authorization_status === "cancelled") {
    return { guard: "duplicate", verdict: "PASS", evidence: [] };
  }
  const sig = auth.items.map((i) => `${i.item_id}x${i.quantity}`).sort().join("|");
  const twin = ledger
    .approvedAtMerchantSince(auth.merchant.merchant_id, simTime - WINDOW_MS, simTime)
    .find((e) => e.item_signature === sig && Math.abs(e.amount_chf - auth.billing_amount_chf) <= 0.05 * e.amount_chf);
  if (!twin) return { guard: "duplicate", verdict: "PASS", evidence: [] };
  const minutes = Math.round((simTime - twin.sim_time) / 60000);
  return {
    guard: "duplicate",
    verdict: "STEP_UP",
    reason_code: "duplicate_order",
    evidence: [{ fact: "same_order_approved_minutes_ago", value: minutes, comparator: ">", threshold: 120, source: "ledger" }],
    message: `You already bought the same thing at ${auth.merchant.merchant_name} ${minutes} minutes ago. Buy it again?`,
  };
};
