// Guard 8: unrequested add-ons (protection plans, subscriptions, memberships).
// Declined when the customer said "nothing extra", otherwise asked.
import type { Guard } from "../types";
import { chf } from "./limitBand";

export const unrequestedAddon: Guard = ({ auth, policy, addonLines }) => {
  if (addonLines.size === 0) return { guard: "addon", verdict: "PASS", evidence: [] };
  const lines = auth.items.filter((i) => addonLines.has(i.line_no));
  const first = lines[0];
  return {
    guard: "addon",
    verdict: policy.noExtras ? "DECLINE" : "STEP_UP",
    reason_code: "unrequested_addon",
    evidence: lines.map((i) => ({
      fact: "addon_line",
      value: `${i.item_name} (${i.item_category}, ${chf(i.unit_price * i.quantity)})`,
      comparator: null,
      threshold: null,
      source: `items[${i.line_no}]`,
    })),
    message: policy.noExtras
      ? `The agent added "${first.item_name}" (${chf(first.unit_price * first.quantity)}). You said not to add anything you did not ask for.`
      : `The agent added "${first.item_name}" (${chf(first.unit_price * first.quantity)}), which you did not ask for. Approve the whole order of ${chf(auth.billing_amount_chf)}?`,
  };
};
