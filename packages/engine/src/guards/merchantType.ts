// Guard 10: the kind of shop the customer asked for ("specialist sports retailer").
import type { Guard } from "../types";

export const merchantType: Guard = ({ auth, policy }) => {
  const req = policy.requiredMerchantCategories;
  if (!req) return { guard: "merchant_type", verdict: "SKIP", evidence: [] };
  const cat = auth.merchant.merchant_category;
  const evidence = [{ fact: "merchant_category", value: cat, comparator: "in", threshold: req.join(","), source: "authorization.merchant.merchant_category" }];
  if (req.includes(cat)) return { guard: "merchant_type", verdict: "PASS", evidence };
  return {
    guard: "merchant_type",
    verdict: "DECLINE",
    reason_code: "shop_type_mismatch",
    evidence,
    message: `${auth.merchant.merchant_name} is a ${cat.replace(/_/g, " ")} shop. You asked for a ${req[0].replace(/_/g, " ")} shop.`,
  };
};
