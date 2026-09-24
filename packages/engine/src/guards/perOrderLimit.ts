// Guard 2: per-order limit, with a small-overshoot band that asks instead of declining.
import type { Guard } from "../types";
import { chf, limitBand, pct } from "./limitBand";

export const perOrderLimit: Guard = ({ auth, policy }) => {
  const limit = policy.perOrderLimitChf;
  if (limit === null) return { guard: "per_order_limit", verdict: "SKIP", evidence: [] };

  const amount = auth.billing_amount_chf;
  const verdict = limitBand(amount, limit, policy.overshootTolerance);
  const evidence = [
    {
      fact: "billing_amount_chf",
      value: amount,
      comparator: "<=",
      threshold: limit,
      source: "authorization.billing_amount_chf",
    },
  ];

  if (verdict === "PASS") return { guard: "per_order_limit", verdict, evidence };

  const over = pct(amount, limit);
  return {
    guard: "per_order_limit",
    verdict,
    reason_code: "over_order_limit",
    evidence,
    message:
      verdict === "STEP_UP"
        ? `This order is ${chf(amount)}, ${over} above your limit of ${chf(limit)} per order. Approve anyway?`
        : `This order is ${chf(amount)}, above your limit of ${chf(limit)} per order.`,
  };
};
