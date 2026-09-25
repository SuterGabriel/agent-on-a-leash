// Guard: shops the customer blocked. From the mandate (merchant.merchant_id not_in) and from memory, so a block
// survives a new mandate (loosening re-creates it). Always a decline: the customer said never.
import type { Guard } from "../types";

export const blockedShop: Guard = ({ auth, policy, learned }) => {
  const id = auth.merchant.merchant_id;
  const inMandate = policy.blockedMerchants?.includes(id) ?? false;
  const inMemory = learned?.blockedShops.has(id) ?? false;
  if (!policy.blockedMerchants?.length && !learned?.blockedShops.size) return { guard: "blocked_shop", verdict: "SKIP", evidence: [] };
  const evidence = [{ fact: "merchant_blocked_by_you", value: inMandate || inMemory ? "yes" : "no", comparator: "=", threshold: "no", source: inMemory ? "memory" : "mandate" }];
  if (!inMandate && !inMemory) return { guard: "blocked_shop", verdict: "PASS", evidence };
  return { guard: "blocked_shop", verdict: "DECLINE", reason_code: "blocked_shop", evidence, message: `You blocked ${auth.merchant.merchant_name}. Your agent can't pay there.` };
};
