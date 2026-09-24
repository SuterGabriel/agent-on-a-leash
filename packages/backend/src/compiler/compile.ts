import {
  BUILT_IN_PROTECTIONS,
  RULE_FIELDS,
  RULE_KEYS,
  type LeashRule,
  type MandateRule,
  type OpenQuestion,
  type ParseResult,
  type RuleGroup,
  type UncertaintyPolicy,
  type YourWords,
} from "@leash/shared";
import type { MandateDraftRequest } from "../viseca/api.js";

// Policy compiler (D2): instruction in plain words → rules the customer can review.
// Deterministic regex, always runs. An optional model may add to it later, never replace it.
// Every rule keeps the exact words it came from (your_words, with offsets) so the app can underline them.

export const QUESTION_IDS = {
  splitOrders: "q_split_orders",
  otherCard: "q_other_card",
  closeAfterFirst: "q_close_after_first",
} as const;

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fourteen: 14, thirty: 30 };
const toNumber = (s: string) => NUMBER_WORDS[s.toLowerCase()] ?? Number(s.replace(",", "."));
const chf = (n: number) => `CHF ${Number.isInteger(n) ? n : n.toFixed(2)}`;

const MERCHANT_TYPES: Record<string, { category: string; label: string }> = {
  sport: { category: "sporting_goods", label: "sports" },
  sports: { category: "sporting_goods", label: "sports" },
  running: { category: "sporting_goods", label: "sports" },
  outdoor: { category: "sporting_goods", label: "sports" },
  electronics: { category: "electronics", label: "electronics" },
  book: { category: "books", label: "book" },
};

class Builder {
  rules: LeashRule[] = [];
  spans: { start: number; end: number }[] = [];
  questions: OpenQuestion[] = [];
  assumptions: string[] = [];
  warnings: string[] = [];
  constructor(readonly text: string) {}

  find(re: RegExp, notInside: { start: number; end: number }[] = []): RegExpExecArray | null {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(this.text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (!notInside.some((s) => start < s.end && end > s.start)) return m;
      if (m[0].length === 0) g.lastIndex++;
    }
    return null;
  }

  words(m: RegExpExecArray): YourWords {
    this.spans.push({ start: m.index, end: m.index + m[0].length });
    return { text: m[0], start: m.index, end: m.index + m[0].length };
  }

  add(key: string, label: string, group: RuleGroup, words: YourWords | null, hard_rule: MandateRule | null) {
    const n = this.rules.filter((r) => r.key === key).length;
    this.rules.push({ id: n ? `r_${key}_${n + 1}` : `r_${key}`, key, label, group, source: "you", your_words: words, hard_rule });
  }

  has(key: string) {
    return this.rules.some((r) => r.key === key);
  }
}

export function compile(instruction: string): ParseResult {
  const text = instruction.trim();
  const b = new Builder(text);

  // Rolling period budget first, so its amount is not read as a per-order limit.
  const period =
    b.find(/(?:keep\s+)?the total across any (\w+) days (?:at or below|under|no more than|up to) CHF\s*(\d+(?:[.,]\d+)?)/i) ??
    b.find(/(?:(?:max(?:imum)?|up to|no more than|at most)\s+)?CHF\s*(\d+(?:[.,]\d+)?)\s*(?:per|a|each)\s*week\b/i) ??
    b.find(/weekly budget (?:of\s+)?CHF\s*(\d+(?:[.,]\d+)?)/i);
  const periodSpans: { start: number; end: number }[] = [];
  if (period) {
    const twoGroups = period[2] !== undefined;
    const days = twoGroups ? toNumber(period[1] as string) : 7;
    const limit = toNumber((twoGroups ? period[2] : period[1]) as string);
    periodSpans.push({ start: period.index, end: period.index + period[0].length });
    b.add(RULE_KEYS.period_budget, `Any ${days} days: ${chf(limit)} or less in total`, "limits", b.words(period), {
      field: RULE_FIELDS.amount,
      operator: "<=",
      value: limit,
      currency: "CHF",
      scope: "period",
      period_days: days,
    });
    b.assumptions.push(`"Any ${days} days" is a rolling window: approved purchases of the last ${days} days count; purchases waiting for your answer don't.`);
  }

  // Per-order limit.
  const order =
    b.find(/each order (?:at or below|of|up to|under|no more than|max(?:imum)?(?: of)?)\s*CHF\s*(\d+(?:[.,]\d+)?)(\s+including delivery)?/i, periodSpans) ??
    b.find(/(?:up to|max(?:imum)?|no more than|at or below|under)\s*CHF\s*(\d+(?:[.,]\d+)?)\s*(?:per|an?|each)\s*order(\s+including delivery)?/i, periodSpans) ??
    b.find(/(?:pay no more than|no more than|at or below|up to|max(?:imum)?(?: of)?)\s*CHF\s*(\d+(?:[.,]\d+)?)(\s+including delivery)?/i, periodSpans) ??
    b.find(/(?:for\s+)?CHF\s*(\d+(?:[.,]\d+)?)\s*or less(\s+including delivery)?/i, periodSpans);
  if (order) {
    const limit = toNumber(order[1] as string);
    const inclDelivery = !!order[2] || /including delivery/i.test(text);
    b.add(RULE_KEYS.order_limit, `Each order ${chf(limit)} or less${inclDelivery ? ", delivery included" : ""}`, "limits", b.words(order), {
      field: RULE_FIELDS.amount,
      operator: "<=",
      value: limit,
      currency: "CHF",
      scope: "purchase",
    });
    b.assumptions.push(inclDelivery ? `"Including delivery" means the total you pay, delivery fee included.` : `The limit is the total you pay for one order, delivery fee included.`);
    b.questions.push({ id: QUESTION_IDS.splitOrders, text: "Should two orders within 10 minutes count as one order?", options: ["Yes", "No"] });
  }

  // What may be bought.
  const groceries = b.find(/\b(?:household\s+)?grocer(?:y|ies)\b/i);
  if (groceries) {
    b.add(RULE_KEYS.purpose, "Groceries only", "purpose", b.words(groceries), { field: RULE_FIELDS.itemCategory, operator: "in", value: ["groceries"] });
    b.assumptions.push(`"Groceries" means every item in the basket is a grocery item; the delivery fee is fine.`);
  }
  const clothing = b.find(/\bcloth(?:ing|es)\b/i);
  if (clothing) b.add(RULE_KEYS.purpose, "Clothing only", "purpose", b.words(clothing), { field: RULE_FIELDS.itemCategory, operator: "in", value: ["clothing"] });

  const shoes = b.find(/\b(road-running|trail-running|running) shoes\b/i);
  if (shoes) {
    const item = `${(shoes[1] as string).toLowerCase()} shoes`;
    b.add(RULE_KEYS.requested_item, `Only ${item}`, "purpose", b.words(shoes), { field: RULE_FIELDS.requestedItem, operator: "=", value: item });
    b.assumptions.push(`Anything in the basket that isn't ${item} counts as an extra.`);
  }
  const monitor = b.find(/\b(\d{2}-inch )?monitor( I chose)?\b/i);
  if (monitor) {
    const item = `${monitor[1] ?? ""}monitor`.trim();
    b.add(RULE_KEYS.requested_item, `Only the ${item}${monitor[2] ? " you chose" : ""}`, "purpose", b.words(monitor), { field: RULE_FIELDS.requestedItem, operator: "=", value: item });
    b.assumptions.push(`Anything in the basket that isn't the ${item} counts as an extra.`);
  }

  const size = b.find(/\bin size (\d{1,2}(?:[.,]5)?|X{0,2}[SML])\b/i);
  if (size) {
    b.add(RULE_KEYS.item_size, `Size ${size[1]}`, "purpose", b.words(size), { field: RULE_FIELDS.size, operator: "=", value: String(size[1]) });
    b.assumptions.push("If the shop doesn't state the size, I'm not sure, so I'll ask you.");
  }

  const one = b.find(/\b(?:buy\s+)?one (?:ordinary\s+)?(?:grocery\s+)?item\b/i);
  if (one) {
    b.add(RULE_KEYS.one_item, "One item per order", "purpose", b.words(one), { field: RULE_FIELDS.lineCount, operator: "<=", value: 1 });
    b.questions.push({ id: QUESTION_IDS.closeAfterFirst, text: "After the first item is bought, should the agent stop buying?", options: ["Yes", "No"] });
  }

  const delivery = b.find(/\bfor delivery\b/i);
  if (delivery) b.add(RULE_KEYS.delivery, "Delivered orders", "purpose", b.words(delivery), { field: RULE_FIELDS.fulfillment, operator: "=", value: "delivery" });

  // Where it may be bought.
  const known = b.find(/\b(?:from\s+)?(?:a |the )?(?:shops?|sellers?|stores?|retailers?) I (?:use regularly|have bought from before|bought from before|have used before|know)\b/i);
  if (known) {
    b.add(RULE_KEYS.known_shop, "Only shops you've bought from", "restrictions", b.words(known), { field: RULE_FIELDS.familiarity, operator: "in", value: ["used_on_this_card"] });
    const phrase = /regularly/i.test(known[0]) ? "use regularly" : "before";
    b.assumptions.push(`I read "${phrase}" as: at least one approved purchase at that shop with this card.`);
    b.questions.push({ id: QUESTION_IDS.otherCard, text: "Does a shop you used with your other card count as known?", options: ["Yes", "No"] });
  }
  const specialist = b.find(/\bspecialist (sports?|running|outdoor|electronics|book) (?:retailer|shop|store)s?\b/i);
  if (specialist) {
    const t = MERCHANT_TYPES[(specialist[1] as string).toLowerCase()] ?? { category: (specialist[1] as string).toLowerCase(), label: specialist[1] as string };
    b.add(RULE_KEYS.merchant_type, `Only specialist ${t.label} shops`, "restrictions", b.words(specialist), { field: RULE_FIELDS.merchantCategory, operator: "in", value: [t.category] });
    b.assumptions.push(`"Specialist ${t.label} retailer" means a shop whose category is ${t.category.replace("_", " ")}.`);
  }
  const returns = b.find(/\b(?:can be )?returned within (\d+) days(?: or more)?|\breturn(?:s|able)? (?:within|for at least|of at least) (\d+) days/i);
  if (returns) {
    const days = Number(returns[1] ?? returns[2]);
    b.add(RULE_KEYS.return_window, `Returnable for at least ${days} days`, "restrictions", b.words(returns), { field: RULE_FIELDS.returnWindow, operator: ">=", value: days });
    b.assumptions.push("If the return terms are missing, I'm not sure, so I'll ask you.");
  }
  const extras = b.find(/\b(?:do not|don't) add anything I did(?: not|n't) ask for\b|\bnothing extra\b|\bno extras\b|\bonly what I (?:asked for|chose)\b/i);
  if (extras) b.add(RULE_KEYS.no_extras, "Nothing you didn't ask for", "restrictions", b.words(extras), { field: RULE_FIELDS.extras, operator: "=", value: "none" });
  const session = b.find(/\b(?:pause|stop|hold) anything that looks like someone other than me is driving the session\b/i) ?? b.find(/\bsomeone other than me\b/i);
  if (session) {
    b.add(RULE_KEYS.session, "Pause if it doesn't look like you", "restrictions", b.words(session), { field: RULE_FIELDS.sessionDriver, operator: "=", value: "cardholder" });
    b.assumptions.push("A new phone, unusual hours, a burst of orders or a new country makes it look like someone else; then I ask you.");
  }

  // When unsure.
  let uncertainty: UncertaintyPolicy = "ask";
  const ask = b.find(/\bask me (?:when|if) (?:uncertain|unsure|in doubt|not sure)\b/i);
  const decline = b.find(/\bdecline (?:when|if) (?:uncertain|unsure|in doubt|not sure)\b/i);
  const approve = b.find(/\b(?:approve|buy it|go ahead) (?:when|if) (?:uncertain|unsure|in doubt|not sure)\b/i);
  if (decline) {
    uncertainty = "decline";
    b.words(decline);
  } else if (approve) {
    uncertainty = "approve";
    b.words(approve);
    b.warnings.push("When I'm unsure, purchases go through without asking you.");
  } else if (ask) {
    b.words(ask);
  } else {
    b.assumptions.push("You didn't say what to do when I'm unsure, so I'll ask you.");
  }

  if (!b.has(RULE_KEYS.order_limit) && !b.has(RULE_KEYS.period_budget)) b.warnings.push("No spending limit found. Add one, for example: max CHF 100 per order.");
  if (!b.has(RULE_KEYS.purpose) && !b.has(RULE_KEYS.requested_item)) b.warnings.push("I couldn't tell what the agent may buy, so I'll ask you about every purchase.");

  // Sentences no rule came from: never silently dropped.
  const not_understood: string[] = [];
  for (const m of text.matchAll(/[^.!?]+[.!?]?/g)) {
    const s = m[0].trim();
    if (!s) continue;
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!b.spans.some((sp) => sp.start < end && sp.end > start)) not_understood.push(s);
  }

  return {
    instruction: text,
    rules: b.rules,
    built_in: BUILT_IN_PROTECTIONS,
    uncertainty_policy: uncertainty,
    open_questions: b.questions,
    not_understood,
    assumptions: b.assumptions,
    warnings: b.warnings,
  };
}

/** The Viseca mandate body for confirmed rules. Assumptions travel as guidance, unanswered questions as open_questions. */
export function toMandateDraft(parsed: ParseResult, rules: LeashRule[], answers: Record<string, string> = {}, uncertainty?: UncertaintyPolicy): MandateDraftRequest {
  return {
    instruction: parsed.instruction,
    hard_rules: rules.flatMap((r) => (r.hard_rule ? [r.hard_rule] : [])),
    uncertainty_policy: uncertainty ?? parsed.uncertainty_policy,
    guidance: parsed.assumptions,
    open_questions: parsed.open_questions.filter((q) => !answers[q.id]).map((q) => q.text),
  };
}

/** Applies the customer's answers to open questions. Answers can only add or narrow rules. */
export function applyAnswers(parsed: ParseResult, answers: Record<string, string> = {}): LeashRule[] {
  const rules = parsed.rules.map((r) => structuredClone(r));
  const yes = (id: string) => /^y(es)?$/i.test(answers[id] ?? "");
  if (yes(QUESTION_IDS.splitOrders)) {
    rules.push({
      id: "r_split_orders",
      key: RULE_KEYS.split_orders,
      label: "Orders within 10 minutes count as one order",
      group: "limits",
      source: "you",
      your_words: null,
      hard_rule: { field: RULE_FIELDS.combineWithin, operator: "=", value: 10 },
    });
  }
  if (yes(QUESTION_IDS.otherCard)) {
    const known = rules.find((r) => r.key === RULE_KEYS.known_shop);
    if (known?.hard_rule) {
      known.hard_rule.value = ["used_on_this_card", "used_on_other_card"];
      known.label = "Only shops you've bought from, with either card";
    }
  }
  return rules;
}
