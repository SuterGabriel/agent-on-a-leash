// Guard: "refundable only" / "only if it can be returned". Non-refundable or final sale: decline.
// Not stated: UNCERTAIN (the customer's uncertainty policy decides; a missing fact is never permission).
import type { Guard } from "../types";

const NON_REFUNDABLE = /\bnon[-\s]?refundable\b|\bfinal\s+sale\b|\bno\s+returns\b|\bnon[-\s]?returnable\b/i;
const REFUNDABLE = /(?<!non[-\s]?)\brefundable\b|\bfree\s+cancell?ation\b/i;

export const refundableOrder: Guard = ({ auth, policy, shop, addonLines }) => {
  if (!policy.refundableRequired) return { guard: "refundable", verdict: "SKIP", evidence: [] };

  const lines = auth.items.filter((i) => !addonLines.has(i.line_no));
  const facts = lines.map((i) => ({ i, f: shop.lines.find((l) => l.line_no === i.line_no) }));
  const evidence = [
    { fact: "order_returnable", value: auth.order_returnable, comparator: "=", threshold: "true", source: "authorization.order_returnable" },
    { fact: "order_cancellable", value: auth.order_cancellable, comparator: "=", threshold: "true", source: "authorization.order_cancellable" },
  ];

  const nonRefundable = facts.find(({ i, f }) => NON_REFUNDABLE.test(i.item_name) || f?.finalSale);
  if (nonRefundable || (auth.order_returnable === "false" && auth.order_cancellable !== "true")) {
    const what = nonRefundable ? `"${nonRefundable.i.item_name}" is not refundable` : "This order cannot be returned or cancelled";
    return { guard: "refundable", verdict: "DECLINE", reason_code: "not_refundable", evidence, message: `${what}. You asked for refundable only.` };
  }
  const stated =
    auth.order_returnable === "true" ||
    auth.order_cancellable === "true" ||
    (facts.length > 0 && facts.every(({ i, f }) => REFUNDABLE.test(i.item_name) || f?.refundable));
  if (stated) return { guard: "refundable", verdict: "PASS", evidence };
  return {
    guard: "refundable",
    verdict: "UNCERTAIN",
    reason_code: "missing_info",
    evidence,
    message: "The shop does not say whether this can be refunded or returned. You asked for refundable only.",
  };
};
