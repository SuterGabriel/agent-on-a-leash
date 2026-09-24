import { ENGINE_READABLE_RULES, RULE_FIELDS, type Decision, type MandateRule } from "@leash/shared";

// D1 "the leash learns, only tighter": after the customer declines, offer one rule that would have caught it.
// Reason codes as defined in docs/PRODUCT_SPEC.md §3.4. Loosening is never offered; that needs a new leash.

export interface SuggestionDraft {
  reason_code: string;
  text: string;
  rule: MandateRule;
}

const STATIC: Record<string, Omit<SuggestionDraft, "reason_code">> = {
  unrequested_addon: { text: "Always decline when something is added I didn't ask for", rule: { field: RULE_FIELDS.addonsAllowed, operator: "=", value: "false" } },
  shop_text_manipulation: { text: "Always decline when a shop's text gives orders", rule: { field: RULE_FIELDS.shopTextInstructions, operator: "=", value: "decline" } },
  lookalike_shop: { text: "Block shops that look like my known shops", rule: { field: RULE_FIELDS.lookalike, operator: "=", value: "decline" } },
  possible_split_order: { text: "Treat orders within 10 minutes as one order", rule: { field: RULE_FIELDS.combineWithin, operator: "=", value: 10 } },
  session_not_you: { text: "Always decline purchases from a new phone at night", rule: { field: RULE_FIELDS.newDeviceAtNight, operator: "=", value: "decline" } },
  new_shop: { text: "Only buy from shops I've used with this card", rule: { field: RULE_FIELDS.familiarOnCard, operator: "=", value: "true" } },
};

/** Only offer rules the engine can read; the others wait for engine support (see ruleFields.ts). */
const engineReads = (rule: MandateRule) => ENGINE_READABLE_RULES.has(`${rule.field} ${rule.operator}`);

/** The one suggestion for a purchase the customer declined, or null. */
export function suggestionFor(decision: Pick<Decision, "reason_codes" | "items">, purposeCategories: string[] = []): SuggestionDraft | null {
  const s = anySuggestionFor(decision, purposeCategories);
  return s && engineReads(s.rule) ? s : null;
}

function anySuggestionFor(decision: Pick<Decision, "reason_codes" | "items">, purposeCategories: string[] = []): SuggestionDraft | null {
  for (const code of decision.reason_codes) {
    if (code === "item_outside_purpose") {
      // Block exactly the categories that fell outside the purpose, e.g. cosmetics in a grocery basket.
      const outside = [...new Set(decision.items.map((i) => i.category).filter((c) => !purposeCategories.includes(c)))];
      if (outside.length > 0) {
        return { reason_code: code, text: `Never buy ${outside.join(" or ").replace(/_/g, " ")}`, rule: { field: RULE_FIELDS.itemCategory, operator: "not_in", value: outside } };
      }
      continue;
    }
    const s = STATIC[code];
    if (s) return { reason_code: code, ...structuredClone(s) };
  }
  return null;
}

/** Reason codes where an approval by the customer teaches us a known shop (memory grows only through approvals). */
export const LEARNS_SHOP_ON_APPROVE = new Set(["new_shop", "shop_used_other_card"]);
