// Regex policy compiler: customer instruction -> internal policy + platform hard_rules.
// Always runs, no model needed. Every interpretation is written down as an assumption
// so the customer can see and correct it before confirming.
// Patterns are general English phrasings; nothing here may name a scenario or copy an instruction.
import { fxRate } from "./fxRates.js";
import type { HardRule, Policy } from "./types.js";

const NUMBER_WORDS: Record<string, number> = {
  one: 1, once: 1, two: 2, twice: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fourteen: 14, thirty: 30,
};
const toNumber = (w: string | undefined) => NUMBER_WORDS[(w ?? "").toLowerCase()] ?? Number(w);

// A period word next to an amount makes it a budget over that many days.
const PERIOD_WORDS: Array<[RegExp, number | null]> = [
  [/\b(\d+|seven|fourteen|thirty)[-\s]days?\b/i, null], // "any 7-day window", "any seven days": the number decides
  [/\bper\s+week|\ba\s+week\b|\bweekly\b|\beach\s+week|\bevery\s+week/i, 7],
  [/\bper\s+month|\ba\s+month\b|\bmonthly\b|\beach\s+month|\bevery\s+month/i, 30],
  [/\bper\s+day|\ba\s+day\b|\bdaily\b|\beach\s+day|\bevery\s+day/i, 1],
  [/\bper\s+year|\ba\s+year\b|\byearly\b|\bannually\b|\bper\s+annum/i, 365],
];

// "What may be bought". Each phrase maps to the category names used in items.csv / merchants.csv.
const CATEGORY_WORDS: Array<[RegExp, string[]]> = [
  [/\b(?:household\s+)?grocer(?:y|ies)\b|\bsupermarkets?\b/i, ["groceries"]],
  [/\bclothing\b|\bclothes\b/i, ["clothing"]],
  [/\belectronics?\b|\bgadgets?\b/i, ["electronics"]],
  [/\bhousehold\s+(basics|items|goods|supplies|essentials)\b|\beveryday\s+household\b|\bcleaning\s+supplies\b/i, ["household"]],
  [/\bhotels?\b|\baccommodation\b|\blodging\b/i, ["hotel"]],
  [/\bsubscriptions?\b|\bstreaming\b/i, ["subscriptions", "membership"]],
  [/\b(meal|food|dinner)\s+deliver(y|ies)\b|\btakeaway\b|\bdinners?\b/i, ["food_delivery", "dining"]],
];

const SHOP_TYPE_WORDS: Array<[RegExp, string]> = [
  [/sports?|sporting|outdoor/i, "sporting_goods"],
  [/electronics?/i, "electronics"],
  [/grocery|supermarket/i, "groceries"],
  [/clothing|fashion/i, "clothing"],
];

// "No alcohol, no gift cards …": a negated term blocks categories and/or keywords.
// Keywords are searched in item names, item categories and the clean sentences of the shop text.
const EXCLUSIONS: Array<{ re: RegExp; categories?: string[]; keywords: string[] }> = [
  { re: /\balcohol(ic)?\b|\bliquor\b|\bbooze\b|\bwines?\b|\bbeers?\b|\bspirits\b/i, keywords: ["alcohol", "wine", "beer", "spirits", "liquor", "whisky", "vodka", "gin", "rum", "champagne", "prosecco", "cider"] },
  { re: /\bgift\s*cards?\b|\bvouchers?\b|\bgift\s+certificates?\b|\bprepaid\s+cards?\b/i, categories: ["gift_card"], keywords: ["gift card", "gift voucher", "voucher", "prepaid card"] },
  { re: /\bcosmetics?\b|\bbeauty\b|\bmake-?up\b|\bfragrances?\b|\bperfumes?\b/i, categories: ["cosmetics"], keywords: ["cosmetic", "beauty", "fragrance", "perfume", "makeup", "make-up"] },
  { re: /\btobacco\b|\bcigarettes?\b|\bvapes?\b/i, keywords: ["tobacco", "cigarette", "vape"] },
  { re: /\bflights?\b|\bairfares?\b|\bplane\s+tickets?\b|\bair\s+travel\b/i, keywords: ["flight", "airfare", "airline", "plane ticket"] },
  { re: /\binsurance\b|\bprotection\s+plans?\b|\bwarrant(y|ies)\b/i, keywords: ["insurance", "protection plan", "warranty"] },
  { re: /\bpremium\b|\bupgrades?\b/i, keywords: ["premium", "upgrade"] },
  { re: /\bannual\b|\byearly\b|\bprepayments?\b/i, keywords: ["annual", "yearly", "prepayment", "12-month"] },
  { re: /\bgambling\b|\bbetting\b|\bcasinos?\b|\blotter(y|ies)\b/i, keywords: ["gambling", "betting", "casino", "lottery"] },
  { re: /\bcash(\s+withdrawals?)?\b|\batm\b/i, categories: ["cash_withdrawal"], keywords: [] },
];

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// ---------- travel: destination, nights, dates ----------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
const RANGE = String.raw`\s*(?:-|–|to|until|till|through)\s*`;
const monthIndex = (m: string | undefined) => MONTHS.indexOf((m ?? "").toLowerCase().slice(0, 3));
const mmdd = (m: number, d: number) => `${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const CAPITALISED = String.raw`([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+)*)`;
const NOT_A_PLACE = new RegExp(String.raw`^${MONTH}$|^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|chf|eur|usd|gbp)$`, "i");

function stayFrom(instruction: string): {
  city: string | null;
  nights: number | null;
  dates: { from: string; to: string } | null;
  conflict: string | null;
  citySpan: [number, number] | null;
  nightsSpan: [number, number] | null;
} {
  let city: string | null = null;
  let citySpan: [number, number] | null = null;
  for (const re of [
    // No "i" flag: the city is recognised by its capital letter, so the keywords list both cases.
    new RegExp(String.raw`\b(?:[Hh]otels?|[Hh]ostels?|[Rr]ooms?|[Ss]tays?|[Aa]ccommodation|[Aa]partments?|[Gg]uesthouses?|[Bb]&[Bb]s?|[Ll]odging)\s+(?:[Ii]n|[Aa]t)\s+${CAPITALISED}`, "u"),
    new RegExp(String.raw`\b(?:[Tt]rip|[Tt]ravel|[Jj]ourney|[Hh]oliday|[Vv]acation|[Gg]etaway)\s+[Tt]o\s+${CAPITALISED}`, "u"),
  ]) {
    const m = instruction.match(re);
    if (m?.[1] && !NOT_A_PLACE.test(m[1]) && m.index !== undefined) {
      city = m[1];
      citySpan = [m.index, m.index + m[0].length];
      break;
    }
  }

  let dates: { from: string; to: string } | null = null;
  let dateNights: number | null = null;
  const both = instruction.match(new RegExp(String.raw`${DAY}\s+${MONTH}${RANGE}${DAY}\s+${MONTH}`, "i")); // 10 September to 13 September
  const oneMonth = instruction.match(new RegExp(String.raw`${DAY}${RANGE}${DAY}\s+${MONTH}`, "i")); // 10 to 13 September
  const monthFirst = instruction.match(new RegExp(String.raw`${MONTH}\s+${DAY}${RANGE}(?:${MONTH}\s+)?${DAY}`, "i")); // September 10 to 13
  let span: [number, number, number, number] | null = null; // month1, day1, month2, day2
  if (both) span = [monthIndex(both[2]), Number(both[1]), monthIndex(both[4]), Number(both[3])];
  else if (oneMonth) span = [monthIndex(oneMonth[3]), Number(oneMonth[1]), monthIndex(oneMonth[3]), Number(oneMonth[2])];
  else if (monthFirst) span = [monthIndex(monthFirst[1]), Number(monthFirst[2]), monthIndex(monthFirst[3] ?? monthFirst[1]), Number(monthFirst[4])];
  const dateMatch = both ?? oneMonth ?? monthFirst;
  if (span && span[0] >= 0 && span[2] >= 0) {
    const [m1, d1, m2, d2] = span;
    let diff = (Date.UTC(2001, m2, d2) - Date.UTC(2001, m1, d1)) / 86_400_000;
    if (diff < 0) diff += 365; // across new year
    if (diff > 0) {
      dates = { from: mmdd(m1, d1), to: mmdd(m2, d2) };
      dateNights = diff;
    }
  }

  const n = instruction.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fourteen)[-\s]nights?\b/i);
  const statedNights = n ? toNumber(n[1]) : null;
  const conflict = statedNights !== null && dateNights !== null && statedNights !== dateNights ? `You wrote ${statedNights} nights, but the dates give ${dateNights}. Which is right?` : null;
  const nightsMatch = n ?? (dateNights !== null ? dateMatch : null);
  const nightsSpan: [number, number] | null = nightsMatch?.index !== undefined ? [nightsMatch.index, nightsMatch.index + nightsMatch[0].length] : null;
  return { city, nights: statedNights ?? dateNights, dates, conflict, citySpan, nightsSpan };
}

const STOPWORDS = new Set(["the", "a", "an", "my", "one", "new", "worn", "old", "i", "me", "for", "of"]);

/** Lowercase word stems, used to compare a requested item with a cart line. */
export function itemTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

// ---------- amounts ----------

const CURRENCY: Record<string, string> = { chf: "CHF", fr: "CHF", "fr.": "CHF", sfr: "CHF", "sfr.": "CHF", franc: "CHF", francs: "CHF", eur: "EUR", "€": "EUR", euro: "EUR", euros: "EUR", usd: "USD", $: "USD", dollar: "USD", dollars: "USD", gbp: "GBP", "£": "GBP", pound: "GBP", pounds: "GBP" };
const NUM = String.raw`\d{1,3}(?:['’]\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const AMOUNT_RE = new RegExp(
  String.raw`(?:(CHF|EUR|USD|GBP|S?Fr\.?|€|\$|£)\s?(${NUM}))|(?:\b(${NUM})\s?(CHF|EUR|USD|GBP|francs?|euros?|dollars?|pounds?)\b)`,
  "gi",
);
const parseNumber = (s: string) => Number(s.replace(/['’]/g, "").replace(",", "."));
// Clause boundaries: punctuation (not a decimal point) and the words that join two limits.
// "at or below", "or less", "or more" stay inside one clause.
const BOUNDARY = /[,;:!?]|\.(?!\d)|\s(?:and|but)\s|(?<!\bat)\sor\s(?!less\b|more\b|below\b|above\b|under\b|over\b|fewer\b)/gi;

function clauseAround(text: string, start: number, end: number): { before: string; after: string } {
  let from = 0;
  let to = text.length;
  for (const b of text.matchAll(BOUNDARY)) {
    const i = b.index ?? 0;
    if (i + b[0].length <= start) from = i + b[0].length;
    else if (i >= end) {
      to = i;
      break;
    }
  }
  return { before: text.slice(from, start), after: text.slice(end, to) };
}

function periodDays(text: string): number | null {
  for (const [re, days] of PERIOD_WORDS) {
    const m = text.match(re);
    if (m) return days ?? toNumber(m[1]);
  }
  return null;
}

const UNIT_RE = /\b(?:per|a|an|each|every)\s+(night|item|unit|piece|ticket|person|seat|room)s?\b/i;
const ORDER_NOUN_RE = /\b(purchases?|orders?|payments?|transactions?|bookings?|deliveries|delivery)\b/i;

/** Negated fragments ("no alcohol", "never at the weekend") are cut out before looking for what IS allowed. */
const NEGATION_RE = /\b(?:no|not|never|without|excluding)\s+[^,.;:]*/gi;

// ---------- the compiler ----------

/** Stable ids of the open questions (the app answers them by id). */
export const QUESTION_IDS = {
  splitOrders: "q_split_orders",
  otherCard: "q_other_card",
  closeAfterFirst: "q_close_after_first",
  amount: "q_amount",
  nights: "q_nights",
} as const;

type Span = { text: string; start: number; end: number };

/** The trimmed text between start and end, with offsets that still point into the instruction. */
function span(text: string, start: number, end: number): Span {
  while (start < end && /\s/.test(text[start] ?? "")) start++;
  while (end > start && /\s/.test(text[end - 1] ?? "")) end--;
  return { text: text.slice(start, end), start, end };
}

// The words of an amount limit: "each order at or below CHF 120 including delivery", "up to CHF 250 per order".
const LIMIT_NOUN_BEFORE = /\b(?:each|every|per|a)\s+(?:order|purchase|booking|payment)\b/gi;
const LIMIT_WORDS_BEFORE = /(?:(?:pay|spend)\s+)?(?:no\s+more\s+than|not\s+more\s+than|at\s+or\s+below|up\s+to|max(?:imum)?(?:\s+of)?|at\s+most|under|below|less\s+than|for)\s*$/i;
const LIMIT_AFTER = /^(?:\s+(?:or\s+(?:less|below|under)|each|in\s+total|including\s+(?:the\s+)?delivery(?:\s+fee)?|per\s+[\w-]+|an?\s+(?:day|week|month|year|night|order)|(?:in|over)\s+any\s+[\w-]+(?:\s+(?:days?|window|period|stretch))?|max(?:imum)?))+/i;

export function compilePolicy(instruction: string): Policy {
  const assumptions: string[] = [];
  const questions: { id: string; text: string }[] = [];
  const ask = (id: string, text: string) => questions.push({ id, text });
  const sources: Policy["sources"] = {};
  const mark = (field: keyof Policy["sources"], start: number, end: number) => {
    sources[field] ??= span(instruction, start, end);
  };
  const markMatch = (field: keyof Policy["sources"], m: RegExpMatchArray | null | undefined) => {
    if (m && m.index !== undefined) mark(field, m.index, m.index + m[0].length);
  };
  let perOrderLimitChf: number | null = null;
  let periodLimit: Policy["periodLimit"] = null;
  let perUnitLimit: Policy["perUnitLimit"] = null;

  // --- Amounts, in any currency. Words right after or before the amount decide what it limits.
  for (const m of instruction.matchAll(AMOUNT_RE)) {
    const code = CURRENCY[(m[1] ?? m[4] ?? "").toLowerCase()] ?? "CHF";
    const value = parseNumber(m[2] ?? m[3] ?? "");
    const chf = Math.round(value * fxRate(code) * 100) / 100;
    const shown = code === "CHF" ? `CHF ${value}` : `${code} ${value} (CHF ${chf.toFixed(2)} at the fixed rate ${fxRate(code)})`;
    const start = m.index ?? 0;
    const { before, after } = clauseAround(instruction, start, start + m[0].length);

    const unit = after.match(UNIT_RE) ?? before.match(UNIT_RE);
    const each = /^\s*each\b/i.test(after);
    // Where the limit's words start and end, for the customer to see.
    const beforeStart = start - before.length;
    const nouns = [...before.matchAll(LIMIT_NOUN_BEFORE)];
    const lastNoun = nouns[nouns.length - 1];
    const words = before.match(LIMIT_WORDS_BEFORE);
    const wordsStart = lastNoun?.index !== undefined ? beforeStart + lastNoun.index : words?.index !== undefined ? beforeStart + words.index : beforeStart;
    const wordsEnd = start + m[0].length + (after.match(LIMIT_AFTER)?.[0].length ?? 0);
    const perOrderWords = /\bper\s+(order|purchase|booking|transaction|payment)\b|\beach\s+(order|purchase)\b/i;
    const period = perOrderWords.test(after) ? null : (periodDays(after) ?? (perOrderWords.test(before) ? null : periodDays(before)));

    if (unit || (each && !ORDER_NOUN_RE.test(before))) {
      const u = unit?.[1] ? unit[1].toLowerCase() : "item";
      perUnitLimit = perUnitLimit && perUnitLimit.amountChf <= chf ? perUnitLimit : { amountChf: chf, unit: u };
      mark("perUnitLimit", wordsStart, wordsEnd);
      assumptions.push(`${shown} is the limit per ${u}, compared with each line's unit price.`);
    } else if (period !== null) {
      periodLimit = { amountChf: chf, days: period };
      mark("periodLimit", beforeStart, wordsEnd);
      assumptions.push(`${shown} is a rolling ${period}-day budget. Only approved purchases count.`);
    } else if (perOrderLimitChf === null || chf < perOrderLimitChf) {
      perOrderLimitChf = chf;
      delete sources.perOrderLimitChf; // a stricter amount replaces an earlier one
      mark("perOrderLimitChf", wordsStart, wordsEnd);
      assumptions.push(`${shown} is the limit per order, delivery included.`);
    }
  }

  // --- How often, and on which days.
  let maxOrdersPerPeriod: Policy["maxOrdersPerPeriod"] = null;
  const freq = instruction.match(
    /(?<!(?:CHF|EUR|USD|GBP|Fr\.?|€|\$|£)\s?)\b(one|once|two|twice|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:delivery|deliveries|order|orders|purchase|purchases|booking|bookings|payment|payments|time|times)\s+)?(?:a|per|each|every)\s+(day|week|month)\b/i,
  );
  if (freq) {
    markMatch("maxOrdersPerPeriod", freq);
    const per = (freq[2] ?? "day").toLowerCase() as "day" | "week" | "month";
    maxOrdersPerPeriod = { count: toNumber(freq[1]), days: { day: 1, week: 7, month: 30 }[per] };
    assumptions.push(
      `At most ${maxOrdersPerPeriod.count} approved order(s) per ${per}` +
        (maxOrdersPerPeriod.days === 1 ? " (a calendar day, Swiss time)." : ` (any ${maxOrdersPerPeriod.days} days).`),
    );
  }

  let allowedWeekdays: number[] | null = null;
  const weekdaysOnly = instruction.match(/\b(?:never|not|no\s+orders?)\s+(?:on|at|during|over)\s+(?:the\s+)?weekends?\b|\bno\s+weekends?\b|\bweekdays?\s+only\b|\bonly\s+on\s+weekdays\b|\bweeknights?\b|\bmonday\s+(?:to|through)\s+friday\b/i);
  if (weekdaysOnly) {
    allowedWeekdays = [1, 2, 3, 4, 5];
    markMatch("allowedWeekdays", weekdaysOnly);
  }
  for (const d of instruction.matchAll(/\b(?:never|not)\s+on\s+(sun|mon|tues|wednes|thurs|fri|satur)days?\b/gi)) {
    markMatch("allowedWeekdays", d);
    const day = WEEKDAYS.indexOf((d[1] ?? "").toLowerCase().slice(0, 3));
    allowedWeekdays = (allowedWeekdays ?? [0, 1, 2, 3, 4, 5, 6]).filter((x) => x !== day);
  }
  if (allowedWeekdays) assumptions.push(`Purchases only on ${allowedWeekdays.map((d) => WEEKDAYS[d]).join(", ")} (Swiss time).`);

  // --- What may NOT be bought. Negated fragments only.
  const negated = [...instruction.matchAll(NEGATION_RE)];
  const blockedCats = new Set<string>();
  const blockedKw = new Set<string>();
  for (const n of negated) {
    const frag = n[0];
    for (const ex of EXCLUSIONS) {
      if (!ex.re.test(frag)) continue;
      ex.categories?.forEach((c) => blockedCats.add(c));
      ex.keywords.forEach((k) => blockedKw.add(k));
      if (ex.categories?.length) markMatch("blockedCategories", n);
      if (ex.keywords.length) markMatch("blockedKeywords", n);
    }
    for (const [re, cats] of CATEGORY_WORDS) {
      if (!re.test(frag)) continue;
      cats.forEach((c) => blockedCats.add(c));
      markMatch("blockedCategories", n);
    }
  }
  const blockedCategories = blockedCats.size ? [...blockedCats] : null;
  const blockedKeywords = blockedKw.size ? [...blockedKw] : null;
  if (blockedCategories) assumptions.push(`Never: ${blockedCategories.join(", ")}. Such a line is declined.`);
  if (blockedKeywords) assumptions.push(`A line whose name, category or shop text mentions ${blockedKeywords.join(", ")} is declined.`);

  // --- What may be bought: a category ("groceries") or one named item ("the 27-inch monitor").
  // Negated fragments blanked out with spaces of the same length, so offsets still point into the instruction.
  const positive = instruction.replace(NEGATION_RE, (f) => " ".repeat(f.length));
  const allowed = [...new Set(CATEGORY_WORDS.filter(([re]) => re.test(positive)).flatMap(([, c]) => c))].filter((c) => !blockedCats.has(c));
  const firstCategory = CATEGORY_WORDS.map(([re]) => positive.match(re)).filter((m) => m?.index !== undefined).sort((a, b) => (a!.index ?? 0) - (b!.index ?? 0))[0];
  if (allowed.length) markMatch("allowedCategories", firstCategory);
  const allowedCategories = allowed.length ? allowed : null;
  if (allowedCategories) assumptions.push(`Every basket line must be ${allowedCategories.join(" or ")}.`);

  let requestedItem: Policy["requestedItem"] = null;
  if (!allowedCategories) {
    // "one order a day", "per order": after a number or an article, "order" is a noun, not the verb.
    const m = instruction.match(
      /(?<!\b(?:a|an|one|two|three|per|each|every|the|any|most|no|first|next|\d+)\s+)\b(?:replace|buy|order|get|need|want|looking\s+for)\s+(?:me\s+)?(?:my\s+)?(?:new\s+|worn\s+|old\s+)?(?:the\s+|a\s+|an\s+|one\s+|some\s+)?(?:new\s+)?(.+?)(?=\s+(?:I\s+chose|in\s+size|size|for|from|up\s+to|at|with)\b|[.,;]|$)/i,
    );
    // "something nice", "anything": not an item the customer named.
    if (m?.[1] && !/^only\b/i.test(m[1]) && !/^(?:something|anything|everything|stuff|whatever)\b/i.test(m[1])) {
      markMatch("requestedItem", m);
      requestedItem = { phrase: m[1].trim(), tokens: itemTokens(m[1]) };
      assumptions.push(`The agent may buy only "${requestedItem.phrase}". A different item, even in the same category, is declined.`);
    }
  }

  const sizeMatch = instruction.match(/\bsize\s+([A-Za-z0-9.]+)/i);
  const size = sizeMatch?.[1] ? sizeMatch[1].replace(/\.$/, "") : null;
  if (size) mark("size", sizeMatch!.index!, sizeMatch!.index! + sizeMatch![0].replace(/\.$/, "").length);
  if (size) assumptions.push(`Size must be ${size}. A different size is declined; no size stated means I ask you.`);

  // --- Returns: a number of days, or just "must be returnable / refundable".
  const ret = instruction.match(
    /return(?:ed)?\s+(?:them\s+|it\s+)?within\s+(?:at\s+least\s+)?(\d+)\s+days|(\d+)[-\s]day\s+returns?|returnable\s+for\s+(?:at\s+least\s+)?(\d+)\s+days|at\s+least\s+(\d+)\s+days?\s+(?:to\s+return|for\s+returns?)/i,
  );
  const minReturnDays = ret ? Number(ret[1] ?? ret[2] ?? ret[3] ?? ret[4]) : null;
  markMatch("minReturnDays", ret);
  if (minReturnDays !== null) {
    assumptions.push(`The order must be returnable for at least ${minReturnDays} days. Final sale is declined; no return policy stated means I ask you.`);
  }
  const refundableMatch = minReturnDays === null ? instruction.match(/\bcan\s+be\s+(returned|refunded|cancell?ed)\b|\breturnable\b|(?<!non[-\s]?)\brefundable(?:\s+rate)?\b|\bfree\s+cancell?ation\b/i) : null;
  const refundableRequired = !!refundableMatch;
  markMatch("refundableRequired", refundableMatch);
  if (refundableRequired) assumptions.push("The order must be refundable or returnable. Non-refundable is declined; not stated means I ask you.");

  // --- Where: a type of shop, and/or only shops already used.
  const shopType = instruction.match(/(?:specialist\s+)?(\w+)\s+(?:retailer|shop|store)s?\b/i);
  const typeHit = shopType?.[1] ? SHOP_TYPE_WORDS.find(([re]) => re.test(shopType[1] ?? "")) : undefined;
  const requiredMerchantCategories = typeHit ? [typeHit[1]] : null;
  if (typeHit) markMatch("requiredMerchantCategories", shopType);
  if (requiredMerchantCategories) assumptions.push(`Only shops of type ${requiredMerchantCategories[0]}.`);

  const SHOP_NOUN = String.raw`(?:shops?|sellers?|stores?|merchants?|retailers?|supermarkets?|services?|restaurants?|vendors?|providers?|subscriptions?)`;
  const familiarMatch = [
    new RegExp(String.raw`\b(?:(?:from|at)\s+)?(?:(?:a|the)\s+)?${SHOP_NOUN}\s+(?:that\s+)?I\s+(?:have\s+)?(?:already\s+|regularly\s+|usually\s+|always\s+)?(?:used|use|know|bought\s+from|buy\s+from|shopped\s+at|shop\s+at|ordered\s+from|order\s+from)\b(?:\s+(?:before|regularly))?`, "i"),
    new RegExp(String.raw`\b(?:from\s+)?my\s+(?:usual|regular|normal|known|existing|current)\s+${SHOP_NOUN}`, "i"),
    new RegExp(String.raw`\bno\s+new\s+${SHOP_NOUN}`, "i"),
  ]
    .map((re) => instruction.match(re))
    .find(Boolean);
  const familiarShopsOnly = !!familiarMatch;
  if (familiarShopsOnly) {
    markMatch("familiarShopsOnly", familiarMatch);
    assumptions.push("A known shop is one where THIS card has at least one approved purchase. If the card has little history, all your cards count.");
    ask(QUESTION_IDS.otherCard, "A shop you used only with your other card: count it as known?");
  }

  const noExtrasMatch = instruction.match(/(?:do\s+not|don't|never)\s+add\s+anything(?:\s+I\s+did(?:\s+not|n't)\s+ask\s+for)?|nothing\s+extra|no\s+extras|nothing\s+else\s+in\s+the\s+(?:basket|cart|order)|only\s+(?:that|this|the\s+one)\s+item/i);
  const noExtras = !!noExtrasMatch;
  markMatch("noExtras", noExtrasMatch);

  // Shown to the customer as rules, but the engine's guards already cover them (no hard rule).
  const oneItemMatch = instruction.match(/\b(?:buy\s+)?one\s+(?:[\w-]+\s+){0,2}item\b/i);
  const oneItem = !!oneItemMatch;
  markMatch("oneItem", oneItemMatch);
  if (oneItem) ask(QUESTION_IDS.closeAfterFirst, "After the first item is bought, should the agent stop buying?");
  const deliveryMatch = instruction.match(/\bfor\s+delivery\b/i);
  const forDelivery = !!deliveryMatch;
  markMatch("forDelivery", deliveryMatch);
  if (noExtras) assumptions.push("Add-ons you did not ask for (protection plans, subscriptions) are declined.");

  // --- Travel: where, how many nights, which dates.
  const stay = stayFrom(instruction);
  const destinationCity = stay.city;
  const stayNights = stay.nights;
  const stayDates = stay.dates;
  if (stay.citySpan) mark("destinationCity", stay.citySpan[0], stay.citySpan[1]);
  if (stay.nightsSpan) mark("stayNights", stay.nightsSpan[0], stay.nightsSpan[1]);
  if (destinationCity) assumptions.push(`The stay must be in ${destinationCity}: a hotel elsewhere is declined.`);
  if (stayNights !== null) {
    assumptions.push(
      `${stayNights} night(s)${stayDates ? ` (${stayDates.from} → ${stayDates.to})` : ""}: a per-night limit is checked on the total divided by ${stayNights}.`,
    );
  }
  if (stay.conflict) ask(QUESTION_IDS.nights, stay.conflict);

  const sessionMatch = instruction.match(
    /(?:(?:pause|stop|hold)\s+anything\s+that\s+looks\s+like\s+)?someone\s+other\s+than\s+me(?:\s+is\s+driving\s+the\s+session)?|not\s+me\b|driving\s+the\s+session|someone\s+else|session\s+(?:looks?|seems?)\s+(?:unusual|odd|strange|off|suspicious)|(?:doesn't|does\s+not|don't)\s+look\s+like\s+me|unusual\s+(?:session|activity)/i,
  );
  const sessionIntegrity = !!sessionMatch;
  markMatch("sessionIntegrity", sessionMatch);
  const SESSION_PHRASE = /someone\s+other\s+than\s+me|not\s+me\b|driving\s+the\s+session|someone\s+else|session\s+(looks?|seems?)\s+(unusual|odd|strange|off|suspicious)|(doesn't|does\s+not|don't)\s+look\s+like\s+me|unusual\s+(session|activity)/i;
  // "stop and ask me" / "ask me" in the sentence that describes the session: a question, not a stop, however many signs.
  const sessionSentenceAsks = (text: string) =>
    text.split(/(?<=[.!?])\s+/).some((sentence) => SESSION_PHRASE.test(sentence) && /\bask\b/i.test(sentence) && !/\b(don't|do\s+not|never)\s+ask\b/i.test(sentence));
  const sessionAction: Policy["sessionAction"] = sessionIntegrity && sessionSentenceAsks(instruction) ? "ask" : "stop";
  if (sessionIntegrity) {
    assumptions.push(
      sessionAction === "ask"
        ? "I watch for a new device, an hour you never shop at, a burst of orders, a new country and an unknown shop. Any sign: I stop and ask you."
        : "I watch for a new device, an hour you never shop at, a burst of orders, a new country and an unknown shop. One sign: I ask. Three or more: I stop it.",
    );
  }

  // --- Uncertain cases: ask (default) or decline.
  const DOUBT = String.raw`(?:if|when|whenever)\s+(?:you\s+are\s+|you're\s+|I'm\s+|it's\s+|in\s+)?(?:unsure|uncertain|in\s+doubt|doubt|not\s+sure|unclear|anything\s+is\s+unclear|something\s+(?:doesn't|does\s+not)\s+fit)`;
  let uncertainty: Policy["uncertainty"] = "ask";
  const declineMatch =
    instruction.match(/decline\s+(?:it\s+)?(?:when|if)\s+(?:un(?:sure|certain)|in\s+doubt|not\s+sure)/i) ??
    instruction.match(new RegExp(String.raw`${DOUBT}[^.]*?\b(?:decline|reject|refuse|don't\s+buy|do\s+not\s+buy|block)\b(?:\s+it)?`, "i"));
  const askMatch =
    instruction.match(new RegExp(String.raw`${DOUBT}[^.]*?\bask(?:\s+me)?\b`, "i")) ??
    instruction.match(/\bask\s+me\b(?:\s+(?:first|when\s+uncertain|when\s+unsure|if\s+[^.]*))?|\bcheck\s+with\s+me\b/i);
  if (declineMatch) {
    uncertainty = "decline";
    markMatch("uncertainty", declineMatch);
  } else if (askMatch) {
    markMatch("uncertainty", askMatch);
  } else {
    assumptions.push("No rule for uncertain cases was given; I will ask you.");
  }

  if (perOrderLimitChf === null && periodLimit === null && perUnitLimit === null) {
    ask(QUESTION_IDS.amount, "I could not find an amount. What is the most the agent may spend per order?");
  }
  if (perOrderLimitChf !== null) ask(QUESTION_IDS.splitOrders, "Two orders at the same shop within 10 minutes: treat them as one order?");
  const openQuestions = questions.map((q) => q.text);

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
    sessionAction,
    shopTextAction: "ask",
    perUnitLimit,
    maxOrdersPerPeriod,
    allowedWeekdays,
    blockedCategories,
    blockedKeywords,
    refundableRequired,
    destinationCity,
    stayNights,
    stayDates,
    oneItem,
    forDelivery,
    sources,
    questions,
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
  if (p.sessionIntegrity) rules.push({ field: "session.integrity", operator: "=", value: p.sessionAction === "ask" ? "ask" : "required" });
  if (p.perUnitLimit) rules.push({ field: "items.unit_price_chf", operator: "<=", value: p.perUnitLimit.amountChf, currency: "CHF" });
  if (p.maxOrdersPerPeriod) {
    rules.push({ field: "orders.count", operator: "<=", value: p.maxOrdersPerPeriod.count, scope: "period", period_days: p.maxOrdersPerPeriod.days });
  }
  if (p.allowedWeekdays) rules.push({ field: "authorization.weekday", operator: "in", value: p.allowedWeekdays.map((d) => WEEKDAYS[d] ?? String(d)) });
  if (p.blockedCategories) rules.push({ field: "items.item_category", operator: "not_in", value: p.blockedCategories });
  if (p.blockedKeywords) rules.push({ field: "items.keywords", operator: "not_in", value: p.blockedKeywords });
  if (p.refundableRequired) rules.push({ field: "order.refundable", operator: "=", value: "true" });
  if (p.destinationCity) rules.push({ field: "order.destination_city", operator: "=", value: p.destinationCity });
  if (p.stayNights !== null) rules.push({ field: "order.nights", operator: "=", value: p.stayNights });
  return rules;
}

export { WEEKDAYS };
