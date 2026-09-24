// Guard 5: item scope. EVERY basket line must be in the allowed categories.
// The shop's category does not prove what each line is.
import type { Guard } from "../types";
import { chf } from "./limitBand";

export const itemScope: Guard = ({ auth, policy }) => {
  const allowed = policy.allowedCategories;
  if (!allowed) return { guard: "item_scope", verdict: "SKIP", evidence: [] };

  const outside = auth.items.filter((i) => !allowed.includes(i.item_category));
  const evidence = auth.items.map((i) => ({
    fact: "item_category",
    value: i.item_category,
    comparator: "in",
    threshold: allowed.join(","),
    source: `items[${i.line_no}].item_category`,
  }));

  if (outside.length === 0) return { guard: "item_scope", verdict: "PASS", evidence };

  const first = outside[0];
  return {
    guard: "item_scope",
    verdict: "STEP_UP",
    reason_code: "item_outside_purpose",
    evidence,
    message: `The basket has "${first.item_name}" (${chf(first.unit_price * first.quantity)}), which is not ${allowed.join(" or ")}. Approve the whole order of ${chf(auth.billing_amount_chf)}?`,
  };
};
