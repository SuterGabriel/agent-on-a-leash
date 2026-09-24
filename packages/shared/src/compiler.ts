// Regex policy compiler: customer instruction -> internal policy + platform hard_rules.
// Always runs, no model needed. Every interpretation is written down as an assumption
// so the customer can see and correct it before confirming.
import type { HardRule, Policy } from "./types";

const PERIOD_WORDS: Array<[RegExp, number]> = [
  [/(any\s+)?(seven|7)\s+days|per\s+week|a\s+week|weekly/i, 7],
  [/(any\s+)?(thirty|30)\s+days|per\s+month|a\s+month|monthly/i, 30],
];

const CATEGORY_WORDS: Array<[RegExp, string]> = [
  [/grocer(y|ies)/i, "groceries"],
  [/\bclothing\b|\bclothes\b/i, "clothing"],
];

const SHOP_TYPE_WORDS: Array<[RegExp, string]> = [
  [/sports?|sporting/i, "sporting_goods"],
  [/electronics?/i, "electronics"],
  [/grocery|supermarket/i, "groceries"],
  [/clothing|fashion/i, "clothing"],
];

const STOPWORDS = new Set(["the", "a", "an", "my", "one", "new", "worn", "old", "i", "me", "for", "of"]);

/** Lowercase word stems, used to compare a requested item with a cart line. */
export function itemTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

export function compilePolicy(instruction: string): Policy {
  const assumptions: string[] = [];
  const openQuestions: string[] = [];
  let perOrderLimitChf: number | null = null;
  let periodLimit: Policy["periodLimit"] = null;

  // --- Amounts. The words just before "CHF 120" decide: per order or per period.
  for (const m of instruction.matchAll(/CHF\s*(\d+(?:[.,]\d{1,2})?)/gi)) {
    const value = Number(m[1].replace(",", "."));
    const clauseStart = Math.max(instruction.lastIndexOf(",", m.index), instruction.lastIndexOf(".", m.index - 1), 0);
    const before = instruction.slice(clauseStart, m.index);
    const period = PERIOD_WORDS.find(([re]) => re.test(before));
    if (period) {
      periodLimit = { amountChf: value, days: period[1] };
      assumptions.push(`CHF ${value} is a rolling ${period[1]}-day budget. Only approved purchases count.`);
    } else if (perOrderLimitChf === null) {
      perOrderLimitChf = value;
      assumptions.push(`CHF ${value} is the limit per order, delivery included.`);
    }
  }

  // --- What may be bought: a category ("groceries") or one named item ("the 27-inch monitor").
  const allowed = CATEGORY_WORDS.filter(([re]) => re.test(instruction)).map(([, c]) => c);
  const allowedCategories = allowed.length ? allowed : null;
  if (allowedCategories) assumptions.push(`Every basket line must be ${allowedCategories.join(" or ")}.`);

  let requestedItem: Policy["requestedItem"] = null;
  if (!allowedCategories) {
    const m = instruction.match(
      /\b(?:replace|buy|order|get)\s+(?:me\s+)?(?:my\s+)?(?:worn\s+|old\s+)?(?:the\s+|a\s+|an\s+|one\s+)?(.+?)(?=\s+(?:I\s+chose|in\s+size|size|for|from|up\s+to)\b|[.,;]|$)/i,
    );
    if (m && !/^only\b/i.test(m[1])) {
      requestedItem = { phrase: m[1].trim(), tokens: itemTokens(m[1]) };
      assumptions.push(`The agent may buy only "${requestedItem.phrase}". A different item, even in the same category, is declined.`);
    }
  }

  const sizeMatch = instruction.match(/\bsize\s+([A-Za-z0-9.]+)/i);
  const size = sizeMatch ? sizeMatch[1].replace(/\.$/, "") : null;
  if (size) assumptions.push(`Size must be ${size}. A different size is declined; no size stated means I ask you.`);

  const ret = instruction.match(/returned\s+within\s+(\d+)\s+days|(\d+)[-\s]day\s+returns?/i);
  const minReturnDays = ret ? Number(ret[1] ?? ret[2]) : null;
  if (minReturnDays !== null) {
    assumptions.push(`The order must be returnable for at least ${minReturnDays} days. Final sale is declined; no return policy stated means I ask you.`);
  }

  // --- Where: a type of shop, and/or only shops already used.
  const shopType = instruction.match(/(?:specialist\s+)?(\w+)\s+(?:retailer|shop|store)s?\b/i);
  const typeHit = shopType ? SHOP_TYPE_WORDS.find(([re]) => re.test(shopType[1])) : undefined;
  const requiredMerchantCategories = typeHit ? [typeHit[1]] : null;
  if (requiredMerchantCategories) assumptions.push(`Only shops of type ${requiredMerchantCategories[0]}.`);

  const familiarShopsOnly =
    /(shops?|sellers?|stores?|merchants?)\s+I\s+(have\s+)?(used|use|bought\s+from|buy\s+from|shopped\s+at)/i.test(instruction);
  if (familiarShopsOnly) {
    assumptions.push("A known shop is one where THIS card has at least one approved purchase.");
    openQuestions.push("A shop you used only with your other card: count it as known?");
  }

  const noExtras = /(do\s+not|don't|never)\s+add\s+anything|nothing\s+extra|no\s+extras/i.test(instruction);
  if (noExtras) assumptions.push("Add-ons you did not ask for (protection plans, subscriptions) are declined.");

  const sessionIntegrity = /someone\s+other\s+than\s+me|not\s+me\b|driving\s+the\s+session|someone\s+else/i.test(instruction);
  if (sessionIntegrity) {
    assumptions.push("I watch for a new device, an hour you never shop at, a burst of orders, a new country and an unknown shop. One sign: I ask. Three or more: I stop it.");
  }

  let uncertainty: Policy["uncertainty"] = "ask";
  if (/decline\s+(it\s+)?when\s+(un(sure|certain)|in\s+doubt)/i.test(instruction)) uncertainty = "decline";
  else if (!/ask\s+me/i.test(instruction)) assumptions.push("No rule for uncertain cases was given; I will ask you.");

  if (perOrderLimitChf === null && periodLimit === null) {
    openQuestions.push("I could not find an amount. What is the most the agent may spend per order?");
  }
  if (perOrderLimitChf !== null) openQuestions.push("Two orders at the same shop within 10 minutes: treat them as one order?");
  if (requestedItem) openQuestions.push(`After "${requestedItem.phrase}" is bought once, should later orders of it be asked?`);

  return {
    instruction,
    perOrderLimitChf,
    periodLimit,
    allowedCategories,
    requestedItem,
    size,
    minReturnDays,
    requiredMerchantCategories,
    familiarShopsOnly,
    noExtras,
    sessionIntegrity,
    uncertainty,
    overshootTolerance: 0.1,
    assumptions,
    openQuestions,
  };
}

/** The part of the policy the Viseca platform can store (field names are our convention, spec §4.2). */
export function toHardRules(p: Policy): HardRule[] {
  const rules: HardRule[] = [];
  if (p.perOrderLimitChf !== null) {
    rules.push({ field: "authorization.billing_amount_chf", operator: "<=", value: p.perOrderLimitChf, currency: "CHF", scope: "purchase" });
  }
  if (p.periodLimit) {
    rules.push({
      field: "authorization.billing_amount_chf",
      operator: "<=",
      value: p.periodLimit.amountChf,
      currency: "CHF",
      scope: "period",
      period_days: p.periodLimit.days,
    });
  }
  if (p.allowedCategories) rules.push({ field: "items.item_category", operator: "in", value: p.allowedCategories });
  if (p.requestedItem) rules.push({ field: "items.requested_item", operator: "=", value: p.requestedItem.phrase });
  if (p.size) rules.push({ field: "items.size", operator: "=", value: p.size });
  if (p.minReturnDays !== null) rules.push({ field: "order.return_window_days", operator: ">=", value: p.minReturnDays });
  if (p.requiredMerchantCategories) rules.push({ field: "merchant.merchant_category", operator: "in", value: p.requiredMerchantCategories });
  if (p.familiarShopsOnly) rules.push({ field: "merchant.familiar_on_card", operator: "=", value: "true" });
  if (p.noExtras) rules.push({ field: "order.addons_allowed", operator: "=", value: "false" });
  if (p.sessionIntegrity) rules.push({ field: "session.integrity", operator: "=", value: "required" });
  return rules;
}
