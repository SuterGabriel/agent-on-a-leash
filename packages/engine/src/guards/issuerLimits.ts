// Guard: the card's own limit. The account behind the card has a per-transaction limit set by the issuer
// (reference data); a purchase above it is declined whatever the customer's instruction says.
import type { Guard } from "../types";
import { chf } from "./limitBand";

export const issuerLimits: Guard = ({ auth, base }) => {
  const limits = base.cardLimits.get(auth.card_id);
  if (!limits) return { guard: "issuer_limits", verdict: "SKIP", evidence: [] };
  const evidence = [
    { fact: "billing_amount_chf", value: auth.billing_amount_chf, comparator: "<=", threshold: limits.perTransactionChf, source: `account ${limits.accountId}.per_transaction_limit_chf` },
  ];
  if (Math.round(auth.billing_amount_chf * 100) <= Math.round(limits.perTransactionChf * 100)) {
    return { guard: "issuer_limits", verdict: "PASS", evidence };
  }
  return {
    guard: "issuer_limits",
    verdict: "DECLINE",
    reason_code: "over_card_limit",
    evidence,
    message: `This order is ${chf(auth.billing_amount_chf)}, above your card's limit of ${chf(limits.perTransactionChf)} per purchase.`,
  };
};
