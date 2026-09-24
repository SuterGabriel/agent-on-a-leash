// Guard 14: re-quote after a decline. A note for the customer, never a reason to block on its own.
import type { Guard } from "../types";

export const requote: Guard = ({ auth }) => {
  if (!auth.related_authorization_id || auth.related_authorization_status !== "declined") {
    return { guard: "requote", verdict: "SKIP", evidence: [] };
  }
  return {
    guard: "requote",
    verdict: "PASS",
    reason_code: "requote_after_decline",
    evidence: [{ fact: "related_authorization", value: auth.related_authorization_id, comparator: null, threshold: "declined", source: "authorization.related_authorization_id" }],
    message: `A new offer from ${auth.merchant.merchant_name} after we declined the earlier one. This one meets your rules.`,
  };
};
