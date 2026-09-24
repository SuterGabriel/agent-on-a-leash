// Guard 4: split order. An approved order at the same shop within 10 minutes,
// and both together are above the per-order limit.
import type { Guard } from "../types";
import { chf } from "./limitBand";

const WINDOW_MS = 10 * 60 * 1000;

export const splitOrder: Guard = ({ auth, policy, ledger, simTime }) => {
  const limit = policy.perOrderLimitChf;
  if (limit === null) return { guard: "split_order", verdict: "SKIP", evidence: [] };

  const recent = ledger.approvedAtMerchantSince(auth.merchant.merchant_id, simTime - WINDOW_MS, simTime);
  const combined = Math.round((recent.reduce((s, e) => s + e.amount_chf, 0) + auth.billing_amount_chf) * 100) / 100;

  const evidence = [
    { fact: "approved_same_shop_last_10m", value: recent.length, comparator: ">=", threshold: 1, source: "ledger" },
    { fact: "recent_attempt_count_10m", value: auth.recent_attempt_count_10m, comparator: null, threshold: null, source: "authorization.recent_attempt_count_10m" },
    { fact: "combined_amount_chf", value: combined, comparator: "<=", threshold: limit, source: "ledger + authorization.billing_amount_chf" },
  ];

  if (recent.length === 0 || combined <= limit) return { guard: "split_order", verdict: "PASS", evidence };

  return {
    guard: "split_order",
    verdict: "STEP_UP",
    reason_code: "possible_split_order",
    evidence,
    message: `A second order at ${auth.merchant.merchant_name} within 10 minutes. Together they are ${chf(combined)}, above your limit of ${chf(limit)} per order. Is this one order split in two?`,
  };
};
