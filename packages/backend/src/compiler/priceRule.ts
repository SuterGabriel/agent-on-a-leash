import type { MandateRule, UncertaintyPolicy } from "@leash/shared";

// Placeholder until the policy compiler (Step 5): reads only the per-order CHF limit
// and the uncertainty choice, so a run can start with a meaningful mandate.

export function seedRules(instruction: string): { hard_rules: MandateRule[]; uncertainty_policy: UncertaintyPolicy } {
  const hard_rules: MandateRule[] = [];
  const perOrder = instruction.match(/(?:CHF\s*(\d+(?:\.\d+)?)\s*or less|(?:at or below|no more than|up to)\s*CHF\s*(\d+(?:\.\d+)?)|for\s*CHF\s*(\d+(?:\.\d+)?)\s*or less)/i);
  const limit = perOrder ? Number(perOrder[1] ?? perOrder[2] ?? perOrder[3]) : null;
  if (limit !== null) {
    hard_rules.push({ field: "authorization.billing_amount_chf", operator: "<=", value: limit, currency: "CHF", scope: "purchase" });
  }
  const uncertainty_policy: UncertaintyPolicy = /decline when (?:uncertain|unsure)/i.test(instruction) ? "decline" : "ask";
  return { hard_rules, uncertainty_policy };
}
