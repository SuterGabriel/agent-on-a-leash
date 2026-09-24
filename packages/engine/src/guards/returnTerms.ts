// Guard 9: return terms. A missing fact is never permission.
import type { Guard } from "../types";

export const returnTerms: Guard = ({ auth, policy, shop, addonLines }) => {
  const min = policy.minReturnDays;
  if (min === null) return { guard: "return_terms", verdict: "SKIP", evidence: [] };

  const lines = shop.lines.filter((l) => !addonLines.has(l.line_no));
  const days = lines.map((l) => l.returnDays).filter((d): d is number => d !== null);
  const shortest = days.length ? Math.min(...days) : null;
  const evidence = [
    { fact: "order_returnable", value: auth.order_returnable, comparator: "=", threshold: "true", source: "authorization.order_returnable" },
    { fact: "return_days_stated", value: shortest, comparator: ">=", threshold: min, source: "items[].item_details" },
  ];

  if (auth.order_returnable === "false" || lines.some((l) => l.finalSale)) {
    return { guard: "return_terms", verdict: "DECLINE", reason_code: "final_sale", evidence, message: `This is sold as final sale and cannot be returned. You asked for returns of at least ${min} days.` };
  }
  if (shortest !== null && shortest < min) {
    return { guard: "return_terms", verdict: "DECLINE", reason_code: "returns_too_short", evidence, message: `Returns are accepted within ${shortest} days only. You asked for at least ${min} days.` };
  }
  if (shortest !== null) return { guard: "return_terms", verdict: "PASS", evidence };
  return { guard: "return_terms", verdict: "UNCERTAIN", reason_code: "missing_info", evidence, message: `The shop does not state a return policy. You asked for returns of at least ${min} days.` };
};
