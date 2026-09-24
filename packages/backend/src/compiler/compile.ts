import {
  BUILT_IN_PROTECTIONS,
  RULE_KEYS,
  type LeashRule,
  type MandateRule,
  type OpenQuestion,
  type ParseResult,
  type RuleGroup,
  type UncertaintyPolicy,
  type YourWords,
} from "@leash/shared";
import { compilePolicy, QUESTION_IDS, toHardRules, WEEKDAYS } from "../../../shared/src/compiler.js";
import type { Policy } from "../../../shared/src/types.js";
import type { MandateDraftRequest } from "../viseca/api.js";

// Policy compiler for the app (S1–S3). There is ONE reading of the instruction: shared/src/compiler.ts, the same one the
// engine uses. This file only presents its result for the app: rule chips with labels, the customer's own words
// (your_words, with offsets), open questions with ids and answer options, warnings and the sentences no rule came from.
// It never looks at the instruction's meaning itself, and every hard rule comes from toHardRules(), so what the
// customer confirms is exactly what the engine reads.

export { QUESTION_IDS };

const chf = (n: number) => `CHF ${Number.isInteger(n) ? n : n.toFixed(2)}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nice = (s: string) => s.replace(/_/g, " ");
const list = (xs: string[]) => xs.map(nice).join(" or ");

/** A hard rule → the chip the app shows, and the policy field its words came from. */
function describe(r: MandateRule, p: Policy): { key: string; label: string; group: RuleGroup; field: keyof Policy["sources"] } | null {
  const v = r.value;
  const arr = Array.isArray(v) ? (v as string[]) : [];
  switch (`${r.field} ${r.operator}`) {
    case "authorization.billing_amount_chf <=":
      return r.scope === "period"
        ? { key: RULE_KEYS.period_budget, label: `Any ${r.period_days} days: ${chf(Number(v))} or less in total`, group: "limits", field: "periodLimit" }
        : { key: RULE_KEYS.order_limit, label: `Each order ${chf(Number(v))} or less${/including\s+(?:the\s+)?delivery/i.test(p.sources.perOrderLimitChf?.text ?? "") ? ", delivery included" : ""}`, group: "limits", field: "perOrderLimitChf" };
    case "items.unit_price_chf <=":
      return { key: RULE_KEYS.unit_limit, label: `${chf(Number(v))} or less per ${p.perUnitLimit?.unit ?? "item"}`, group: "limits", field: "perUnitLimit" };
    case "orders.count <=":
      return { key: RULE_KEYS.order_frequency, label: `At most ${v} order${Number(v) === 1 ? "" : "s"} ${r.period_days === 1 ? "a day" : `in any ${r.period_days} days`}`, group: "limits", field: "maxOrdersPerPeriod" };
    case "authorization.weekday in":
      return { key: RULE_KEYS.weekdays, label: `Only on ${arr.map((d) => cap(d)).join(", ")}`, group: "restrictions", field: "allowedWeekdays" };
    case "items.item_category in":
      return { key: RULE_KEYS.purpose, label: `${cap(list(arr))} only`, group: "purpose", field: "allowedCategories" };
    case "items.item_category not_in":
      return { key: RULE_KEYS.blocked_category, label: `Never buy ${list(arr)}`, group: "restrictions", field: "blockedCategories" };
    case "items.keywords not_in":
      return { key: RULE_KEYS.blocked_keywords, label: `Nothing that mentions ${arr.slice(0, 4).join(", ")}${arr.length > 4 ? ", …" : ""}`, group: "restrictions", field: "blockedKeywords" };
    case "items.requested_item =":
      return { key: RULE_KEYS.requested_item, label: `Only ${v}`, group: "purpose", field: "requestedItem" };
    case "items.size =":
      return { key: RULE_KEYS.item_size, label: `Size ${v}`, group: "purpose", field: "size" };
    case "merchant.merchant_category in":
      return { key: RULE_KEYS.merchant_type, label: `Only ${list(arr)} shops`, group: "restrictions", field: "requiredMerchantCategories" };
    case "order.return_window_days >=":
      return { key: RULE_KEYS.return_window, label: `Returnable for at least ${v} days`, group: "restrictions", field: "minReturnDays" };
    case "order.refundable =":
      return { key: RULE_KEYS.refundable, label: "Refundable only", group: "restrictions", field: "refundableRequired" };
    case "merchant.familiar_on_card =":
      return { key: RULE_KEYS.known_shop, label: "Only shops you've bought from", group: "restrictions", field: "familiarShopsOnly" };
    case "order.addons_allowed =":
      return { key: RULE_KEYS.no_extras, label: "Nothing you didn't ask for", group: "restrictions", field: "noExtras" };
    case "session.integrity =":
      return { key: RULE_KEYS.session, label: "Pause if it doesn't look like you", group: "restrictions", field: "sessionIntegrity" };
    case "order.destination_city =":
      return { key: RULE_KEYS.destination, label: `Stay in ${v}`, group: "purpose", field: "destinationCity" };
    case "order.nights =":
      return { key: RULE_KEYS.nights, label: `${v} night${Number(v) === 1 ? "" : "s"}`, group: "purpose", field: "stayNights" };
    default:
      return null;
  }
}

// Chip order on screen: limits, what, where/how. Stable, so the app can rely on it.
const ORDER: string[] = [
  RULE_KEYS.period_budget, RULE_KEYS.order_limit, RULE_KEYS.unit_limit, RULE_KEYS.order_frequency,
  RULE_KEYS.purpose, RULE_KEYS.requested_item, RULE_KEYS.item_size, RULE_KEYS.one_item, RULE_KEYS.delivery,
  RULE_KEYS.destination, RULE_KEYS.nights, RULE_KEYS.known_shop, RULE_KEYS.merchant_type, RULE_KEYS.return_window,
  RULE_KEYS.refundable, RULE_KEYS.no_extras, RULE_KEYS.session, RULE_KEYS.weekdays, RULE_KEYS.blocked_category,
  RULE_KEYS.blocked_keywords,
];

export function compile(instruction: string): ParseResult {
  const text = instruction.trim();
  const p = compilePolicy(text);
  const words = (field: keyof Policy["sources"]): YourWords | null => p.sources[field] ?? null;

  const drafts: Omit<LeashRule, "id">[] = [];
  for (const hard_rule of toHardRules(p)) {
    const d = describe(hard_rule, p);
    // Every hard rule the compiler writes has a chip; an unknown one still shows, so nothing travels unseen.
    drafts.push(d ? { key: d.key, label: d.label, group: d.group, source: "you", your_words: words(d.field), hard_rule } : { key: hard_rule.field, label: `${hard_rule.field} ${hard_rule.operator} ${JSON.stringify(hard_rule.value)}`, group: "restrictions", source: "you", your_words: null, hard_rule });
  }
  // Shown to the customer, not sent as hard rules: the engine's guards already cover them.
  if (p.oneItem) drafts.push({ key: RULE_KEYS.one_item, label: "One item per order", group: "purpose", source: "you", your_words: words("oneItem"), hard_rule: null });
  if (p.forDelivery) drafts.push({ key: RULE_KEYS.delivery, label: "Delivered orders", group: "purpose", source: "you", your_words: words("forDelivery"), hard_rule: null });
  drafts.sort((a, b) => (ORDER.indexOf(a.key) + 1 || 99) - (ORDER.indexOf(b.key) + 1 || 99));

  const seen = new Map<string, number>();
  const rules: LeashRule[] = drafts.map((d) => {
    const n = (seen.get(d.key) ?? 0) + 1;
    seen.set(d.key, n);
    return { id: n > 1 ? `r_${d.key}_${n}` : `r_${d.key}`, ...d };
  });

  const open_questions: OpenQuestion[] = p.questions.map((q) => ({ id: q.id, text: q.text, options: ["Yes", "No"] }));

  const warnings: string[] = [];
  if (p.uncertainty === "approve") warnings.push("When I'm unsure, purchases go through without asking you.");
  if (p.perOrderLimitChf === null && p.periodLimit === null && p.perUnitLimit === null) warnings.push("No spending limit found. Add one, for example: max CHF 100 per order.");
  if (!p.allowedCategories && !p.requestedItem) warnings.push("I couldn't tell what the agent may buy, so I'll ask you about every purchase.");

  // Sentences none of the compiler's readings came from: never silently dropped.
  const spans = Object.values(p.sources).filter((s): s is YourWords => !!s);
  const not_understood: string[] = [];
  for (const m of text.matchAll(/[^.!?]+[.!?]?/g)) {
    const s = m[0].trim();
    if (!s) continue;
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!spans.some((sp) => sp.start < end && sp.end > start)) not_understood.push(s);
  }

  return {
    instruction: text,
    rules,
    built_in: BUILT_IN_PROTECTIONS,
    uncertainty_policy: p.uncertainty,
    open_questions,
    not_understood,
    assumptions: p.assumptions,
    warnings,
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
      hard_rule: null,
    });
  }
  if (yes(QUESTION_IDS.otherCard)) {
    const known = rules.find((r) => r.key === RULE_KEYS.known_shop);
    if (known) known.label = "Only shops you've bought from, with either card";
  }
  return rules;
}

export { WEEKDAYS };
