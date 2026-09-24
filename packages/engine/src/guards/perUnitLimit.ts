// Guard: per-unit limit ("CHF 200 per night", "CHF 30 per item"). Each line's unit price, in CHF,
// against the limit, with the same small-overshoot band as the per-order limit.
import { toChf } from "../../../shared/src/fxRates";
import type { Evidence } from "../../../shared/src/types";
import type { Guard } from "../types";
import { chf, limitBand } from "./limitBand";

export const perUnitLimit: Guard = ({ auth, policy }) => {
  const limit = policy.perUnitLimit;
  if (!limit) return { guard: "per_unit_limit", verdict: "SKIP", evidence: [] };

  const lines = auth.items.map((i) => ({ i, unitChf: toChf(i.unit_price, i.currency) }));
  const evidence: Evidence[] = lines.map(({ i, unitChf }) => ({
    fact: `unit_price_chf_per_${limit.unit}`,
    value: unitChf,
    comparator: "<=",
    threshold: limit.amountChf,
    source: `items[${i.line_no}].unit_price`,
  }));
  const rank = { PASS: 0, STEP_UP: 1, DECLINE: 2 } as const;
  let worst: { i: (typeof lines)[number]["i"]; unitChf: number; verdict: "PASS" | "STEP_UP" | "DECLINE" } | null = null;
  for (const l of lines) {
    const verdict = limitBand(l.unitChf, limit.amountChf, policy.overshootTolerance) as "PASS" | "STEP_UP" | "DECLINE";
    if (!worst || rank[verdict] > rank[worst.verdict]) worst = { ...l, verdict };
  }
  if (!worst || worst.verdict === "PASS") return { guard: "per_unit_limit", verdict: "PASS", evidence };
  return {
    guard: "per_unit_limit",
    verdict: worst.verdict,
    reason_code: "over_unit_limit",
    evidence,
    message:
      worst.verdict === "STEP_UP"
        ? `"${worst.i.item_name}" costs ${chf(worst.unitChf)} per ${limit.unit}, a little above your limit of ${chf(limit.amountChf)}. Approve anyway?`
        : `"${worst.i.item_name}" costs ${chf(worst.unitChf)} per ${limit.unit}. Your limit is ${chf(limit.amountChf)} per ${limit.unit}.`,
  };
};
