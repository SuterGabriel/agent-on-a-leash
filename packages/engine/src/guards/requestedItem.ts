// Guard 7: the right item, in the right size. Add-on lines are judged by the add-on guard.
import { itemTokens } from "../../../shared/src/compiler";
import type { Evidence } from "../../../shared/src/types";
import type { Guard } from "../types";

export const requestedItem: Guard = ({ auth, policy, shop, addonLines }) => {
  const req = policy.requestedItem;
  if (!req) return { guard: "requested_item", verdict: "SKIP", evidence: [] };

  const lines = auth.items.filter((i) => !addonLines.has(i.line_no));
  const matches = (name: string) => {
    const t = new Set(itemTokens(name));
    return req.tokens.every((x) => t.has(x));
  };
  const evidence: Evidence[] = lines.map((i) => ({
    fact: "item_matches_request",
    value: `${i.item_name} (${i.item_category})`,
    comparator: "=",
    threshold: req.phrase,
    source: `items[${i.line_no}].item_name`,
  }));

  const wrong = lines.find((i) => !matches(i.item_name));
  if (wrong || lines.length === 0) {
    return {
      guard: "requested_item",
      verdict: "DECLINE",
      reason_code: "wrong_item",
      evidence,
      message: `The cart holds "${wrong?.item_name ?? "nothing you asked for"}", but you asked for "${req.phrase}".`,
    };
  }

  if (policy.size) {
    for (const i of lines) {
      const size = shop.lines.find((l) => l.line_no === i.line_no)?.size ?? null;
      evidence.push({ fact: "size", value: size, comparator: "=", threshold: policy.size, source: `items[${i.line_no}].item_details` });
      if (size === null) {
        return { guard: "requested_item", verdict: "UNCERTAIN", reason_code: "missing_info", evidence, message: `The shop does not state the size. You asked for size ${policy.size}.` };
      }
      if (size.toUpperCase() !== policy.size.toUpperCase()) {
        return { guard: "requested_item", verdict: "DECLINE", reason_code: "wrong_size", evidence, message: `This is size ${size}. You asked for size ${policy.size}.` };
      }
    }
  }
  return { guard: "requested_item", verdict: "PASS", evidence };
};
