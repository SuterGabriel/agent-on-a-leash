import { RULE_FIELDS, RULE_KEYS, type AppRuleValues, type AppSmart, type AppSuggestResponse, type LeashRule, type LeashView, type Row } from "@leash/shared";

// The v4 app sets up an "Agent Card" from two numbers and four switches (app-web 1.3 / 1.4), not from a sentence.
// This module turns those into an instruction our compiler reads, and reads the numbers back out of a leash.
// It also proposes the numbers from the card's history (GET /v4/app/leash/suggest), with the evidence the app shows.

export const DEFAULT_SMART: AppSmart = { unsure: "ask", night: "decline", newShops: "ask", learn: "on" };
export const DEFAULT_VALUES: AppRuleValues = { orderLimit: 300, monthBudget: 1500 };
export const MONTH_DAYS = 30;

const whole = (n: number) => String(Math.round(n));

/**
 * The card rules as one instruction. Every sentence matches a compiler pattern, so the leash gets
 * order_limit, period_budget (30 days), known_shop (when new shops are off) and the uncertainty policy.
 */
export function instructionFromCard(rules: AppRuleValues, smart: Pick<AppSmart, "unsure" | "newShops">): string {
  const parts = [
    `Each order at or below CHF ${whole(rules.orderLimit)} including delivery.`,
    `Keep the total across any ${MONTH_DAYS} days at or below CHF ${whole(rules.monthBudget)}.`,
  ];
  if (smart.newShops === "known") parts.push("Only from shops I have used before.");
  parts.push(smart.unsure === "decline" ? "Decline when uncertain." : "Ask me when uncertain.");
  return parts.join(" ");
}

/** The numbers a leash enforces: the tightest order limit and period budget across its rules. */
export function valuesFromLeash(view: LeashView, fallback: AppRuleValues): AppRuleValues & { knownShopsOnly: boolean } {
  const all: LeashRule[] = [...view.rules, ...view.learned_rules];
  const orderLimits = all.filter((r) => r.key === RULE_KEYS.order_limit && r.hard_rule).map((r) => Number(r.hard_rule!.value));
  return {
    orderLimit: orderLimits.length ? Math.min(...orderLimits) : fallback.orderLimit,
    monthBudget: view.budget?.limit_chf ?? fallback.monthBudget,
    knownShopsOnly: all.some((r) => r.key === RULE_KEYS.known_shop),
  };
}

// ── History analysis ───────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 3600 * 1000;
const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", hourCycle: "h23" });
const monthFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit" });

const roundUpTo = (n: number, step: number) => Math.ceil(n / step) * step;
const titleCase = (s: string) =>
  s
    .replace(/_/g, " ")
    .split(" ")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");

export interface AnalyzeOptions {
  windowDays?: number;
  /** End of the window (ms). Default: the card's latest approved purchase. */
  until?: number;
}

/** Approved purchases on one card, as history rows. */
export function cardPurchases(rows: Row[], cardId: string): Row[] {
  return rows.filter((r) => r.card_id === cardId && r.status === "approved" && r.transaction_type === "purchase");
}

/** Numbers the "Rules from your shopping" screen shows, plus the values we suggest from them. */
export function analyzeCard(rows: Row[], cardId: string, opts: AnalyzeOptions = {}): AppSuggestResponse {
  const windowDays = opts.windowDays ?? 90;
  const all = cardPurchases(rows, cardId).map((r) => ({ r, t: Date.parse(r.timestamp as string), chf: Number(r.billing_amount_chf) })).filter((x) => !Number.isNaN(x.t));
  const until = opts.until ?? (all.length ? Math.max(...all.map((x) => x.t)) : Date.now());
  const rowsInWindow = all.filter((x) => x.t > until - windowDays * DAY_MS && x.t <= until);

  const amounts = rowsInWindow.map((x) => x.chf).sort((a, b) => a - b);
  const total = amounts.reduce((s, n) => s + n, 0);
  const typical = amounts.length ? amounts[Math.floor(amounts.length / 2)]! : 0;
  const biggest = amounts.length ? amounts[amounts.length - 1]! : 0;
  const perMonth = total / (windowDays / MONTH_DAYS);

  const byMonth = new Map<string, number>();
  const byShop = new Map<string, { name: string; count: number }>();
  const byCategory = new Map<string, number>();
  let night = 0;
  for (const x of rowsInWindow) {
    const month = monthFmt.format(new Date(x.t));
    byMonth.set(month, (byMonth.get(month) ?? 0) + x.chf);
    const shop = byShop.get(x.r.merchant_id as string);
    byShop.set(x.r.merchant_id as string, { name: x.r.merchant_name as string, count: (shop?.count ?? 0) + 1 });
    const cat = (x.r.merchant_category as string) || "other";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + x.chf);
    const hour = Number(hourFmt.format(new Date(x.t)));
    if (hour >= 23 || hour < 6) night += 1;
  }
  const biggestMonth = Math.max(0, ...byMonth.values());
  const topCategories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const categoryShare = total ? Math.round((topCategories.reduce((s, [, chf]) => s + chf, 0) / total) * 100) : 0;
  const shops = [...byShop.values()].sort((a, b) => b.count - a.count);

  const suggested: AppRuleValues = rowsInWindow.length
    ? { orderLimit: Math.max(50, roundUpTo(biggest * 1.1, 50)), monthBudget: Math.max(200, roundUpTo(biggestMonth * 1.6, 100)) }
    : { ...DEFAULT_VALUES };

  const shopEvidence = shops.length
    ? `${shops
        .slice(0, 2)
        .map((s) => `${s.name} ${s.count} ${s.count === 1 ? "time" : "times"}`)
        .join(", ")}${shops.length > 2 ? ` and ${shops.length - 2} more` : ""}. New shops ask you first`
    : "No purchases on this card yet. New shops ask you first";
  const categories = topCategories.map(([c]) => titleCase(c));

  return {
    window_days: windowDays,
    analysis: {
      purchases: rowsInWindow.length,
      typical_chf: Math.round(typical),
      biggest_chf: Math.round(biggest),
      per_month_chf: Math.round(perMonth),
      biggest_month_chf: Math.round(biggestMonth),
      night_purchases: night,
      shops_used: shops.length,
      categories,
      category_share: categoryShare,
    },
    rules: [
      {
        key: "orderLimit",
        suggested_value: suggested.orderLimit,
        evidence: rowsInWindow.length ? `Your biggest online payment was CHF ${Math.round(biggest)}` : "No purchases on this card yet",
        hard_rule: { field: RULE_FIELDS.amount, operator: "<=", value: suggested.orderLimit, currency: "CHF", scope: "purchase" },
      },
      {
        key: "monthBudget",
        suggested_value: suggested.monthBudget,
        evidence: rowsInWindow.length ? `About CHF ${Math.round(perMonth)} a month, your biggest month was CHF ${Math.round(biggestMonth)}` : "No purchases on this card yet",
        hard_rule: { field: RULE_FIELDS.amount, operator: "<=", value: suggested.monthBudget, currency: "CHF", scope: "period", period_days: MONTH_DAYS },
      },
      { key: "knownShops", suggested_value: null, evidence: shopEvidence, hard_rule: null },
      {
        key: "categories",
        suggested_value: categories,
        evidence: categories.length ? `${categories.join(", ")} · ${categoryShare}% of what you spent` : "No purchases on this card yet",
        hard_rule: null,
      },
    ],
    smart: {
      ...DEFAULT_SMART,
      evidence: {
        unsure: "You get one question and 2 minutes to answer",
        night: `Only ${night} of your ${rowsInWindow.length} purchases were at night. Declined ones wait in your morning summary`,
        newShops: `${shops.length} shops in the last ${windowDays} days. A new one asks you first`,
        learn: "After you answer, we offer one rule. You decide each time",
      },
    },
    instruction_generated: instructionFromCard(suggested, DEFAULT_SMART),
  };
}
