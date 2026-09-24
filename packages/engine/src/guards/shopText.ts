// Guard 6: shop text manipulation. A sentence aimed at the agent is quoted to the customer and
// is a reason to ASK. It can never make a purchase pass; any other decline still wins.
import type { Guard } from "../types";

export const shopTextManipulation: Guard = ({ shop }) => {
  if (shop.flagged.length === 0) return { guard: "shop_text", verdict: "PASS", evidence: [] };
  const first = shop.flagged[0];
  return {
    guard: "shop_text",
    verdict: "STEP_UP",
    reason_code: "shop_text_manipulation",
    evidence: shop.flagged.map((f) => ({
      fact: "shop_text_flagged",
      value: f.text,
      comparator: null,
      threshold: f.patterns.join(","),
      source: `items[${f.line_no}].item_details`,
    })),
    message: `The shop's text tries to instruct your agent: "${first.text}" We ignored it. Everything else must still meet your rules.`,
  };
};
