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
// Deterministic patterns in English and German, always runs. An optional model may add to it later, never replace it.
// It reads patterns, not our five sentences: the jury may word the same leash differently (spec §4.3).
// Test set of reworded instructions: tests/policy_paraphrases.json.
// Every rule keeps the exact words it came from (your_words, with offsets) so the app can underline them.

export const QUESTION_IDS = {
  splitOrders: "q_split_orders",
  otherCard: "q_other_card",
  closeAfterFirst: "q_close_after_first",
} as const;

// ── Numbers and amounts ────────────────────────────────────────────────────────────────────────────
// "CHF 120", "Fr. 120", "120 CHF", "120 Franken", "CHF 120.-", "CHF 1'000". A bare number only where a unit follows.

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fourteen: 14, thirty: 30,
  ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, "fünf": 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
  vierzehn: 14, dreissig: 30, "dreißig": 30,
};
const toNumber = (s: string) => NUMBER_WORDS[s.toLowerCase()] ?? Number(s.replace(/['’]/g, "").replace(",", "."));
const chf = (n: number) => `CHF ${Number.isInteger(n) ? n : n.toFixed(2)}`;

const NUM = String.raw`\d[\d'’]*(?:[.,]\d{1,2})?`;
const AMT = String.raw`(?:(?:CHF|SFr\.?|Fr\.)\s*(?<a>${NUM})|(?<b>${NUM})\s*(?:CHF|Franken|Fr\.|francs?))(?:\.[-–]+)?`;
const BARE = String.raw`(?<c>${NUM})`;
const LIMIT = String.raw`(?:at or below|pay no more than|no more than|not more than|up to|at most|max(?:imum)?\.?(?:\s+of)?|under|below|less than|höchstens|maximal|bis zu|bis|nicht mehr als|nicht über|unter)`;
const TOTAL = String.raw`(?:(?:in total|a total of|combined|insgesamt|zusammen|total)\s+)`;
const ORDER = String.raw`(?:order|purchase|Bestellung|Einkauf|Kauf)`;
const PER = String.raw`(?:per|an?|each|every|pro|je|für jede)`;
const INC = String.raw`(?<inc>,?\s+(?:including|incl\.?|inkl\.?|inklusive)\s+(?:the\s+)?(?:delivery|shipping|Lieferung|Versand|Lieferkosten|Liefergebühr|Versandkosten)(?:\s+(?:fee|costs?))?)?`;
const DAYS = String.raw`(?<d>\d+|[a-zäöüß]+)`;
const INCL_DELIVERY_ANYWHERE = /including delivery|incl\.? delivery|delivery included|inkl\.?\s+(?:Lieferung|Versand)|inklusive\s+(?:Lieferung|Versand)|Lieferung\s+(?:inbegriffen|inklusive)/i;

const re = (src: string) => new RegExp(src, "i");
const amountOf = (m: RegExpExecArray) => toNumber((m.groups?.a ?? m.groups?.b ?? m.groups?.c) as string);
const isBare = (m: RegExpExecArray) => m.groups?.c !== undefined;
const unitDays = (u: string) => (/^(?:week|woche|weekly|wöchentlich|wochen)/i.test(u) ? 7 : 30);

// ── Pattern tables (first match in list order wins) ────────────────────────────────────────────────

const PERIOD_WITH_DAYS = [
  re(String.raw`(?:keep\s+)?the total across any ${DAYS} days (?:at or below|under|no more than|up to) ${AMT}`),
  re(String.raw`(?:innerhalb von|innert|within|over|across|during|in|über)\s+(?:any\s+|every\s+|a\s+|jeweils\s+|beliebigen\s+|allen\s+)?${DAYS}\s+(?:days?|Tagen?)\s+${TOTAL}?(?:(?:spend|ausgeben)\s+)?(?:${LIMIT}\s*)?${AMT}`),
  re(String.raw`(?:${LIMIT}\s*)?${AMT}\s+${TOTAL}?(?:in|within|over|across|for|pro|innerhalb von|innert|über)\s+(?:any\s+|a\s+|every\s+|jeweils\s+|beliebigen\s+|allen\s+)?${DAYS}[- ](?:days?|Tagen?|Tage)\b`),
];
const PERIOD_WITH_UNIT = [
  re(String.raw`(?:${LIMIT}\s*)?${AMT}\s*${TOTAL}?(?:per|a|each|every|pro|je|in der|im)\s*(?<u>week|Woche|month|Monat)\b`),
  re(String.raw`(?:per|a|each|every|pro|je|in der|im)\s+(?<u>week|Woche|month|Monat)\s*,?\s*${TOTAL}?(?:${LIMIT}\s*)?${AMT}`),
  re(String.raw`(?<u>weekly|wöchentlich|monthly|monatlich)\s+(?:budget\s+|limit\s+)?(?:of\s+|von\s+)?(?:${LIMIT}\s*)?${AMT}`),
  re(String.raw`(?<u>Wochen|Monats)(?:budget|limite|limit)\s+(?:von\s+)?(?:${LIMIT}\s*)?${AMT}`),
  re(String.raw`${LIMIT}\s*${BARE}\s*(?:per|a|pro|je)\s*(?<u>week|Woche|month|Monat)\b`),
];
const ORDER_LIMIT = [
  re(String.raw`(?:each|every|per|jede|pro|je)\s+${ORDER}\s*(?:at or below|of|up to|under|no more than|max(?:imum)?(?: of)?|${LIMIT})?\s*:?\s*${AMT}${INC}`),
  re(String.raw`(?:${LIMIT}\s*)?${AMT}\s*${PER}\s*${ORDER}${INC}`),
  re(String.raw`${LIMIT}\s*${AMT}${INC}`),
  re(String.raw`(?:for\s+|für\s+)?${AMT}\s*(?:or less|oder weniger|and under|or under)${INC}`),
  re(String.raw`${LIMIT}\s*${BARE}\s*${PER}\s*${ORDER}${INC}`),
  re(String.raw`\b(?:no|kein[e]?)\s+(?:single\s+|einzige\s+)?${ORDER}\s+(?:above|over|more than|exceeding|über|mehr als)\s*${AMT}${INC}`),
];

const GROCERIES = [
  re(String.raw`\b(?:household\s+)?grocer(?:y|ies)\b`),
  re(String.raw`\bfood shopping\b|\bLebensmittel\w*|\bWocheneinkauf\w*|\bHaushaltseinkäufe\b|\bEinkäufe für den Haushalt\b`),
];
const CLOTHING = [re(String.raw`\bcloth(?:ing|es)\b|\bapparel\b|\bKleidung\w*|\bKleider\w*|\bMode\b`)];

// German and reworded item names map to the catalogue's English name, which the engine matches cart lines against.
const ITEMS: { res: RegExp[]; item: string }[] = [
  {
    item: "road-running shoes",
    res: [re(String.raw`\broad[- ]?running (?:shoes|trainers|sneakers)\b|\b(?:Strassen|Straßen)[- ]?(?:lauf)?schuhe\w*|\bLaufschuhe für (?:die )?(?:Strasse|Straße)\b|\bRoad[- ]?Running[- ]?Schuhe\b`)],
  },
  { item: "trail-running shoes", res: [re(String.raw`\btrail[- ]?running (?:shoes|trainers|sneakers)\b|\bTrail[- ]?(?:running[- ]?|lauf)?schuhe\w*`)] },
  { item: "running shoes", res: [re(String.raw`\brunning (?:shoes|trainers|sneakers)\b|\b(?:Lauf|Jogging|Running)[- ]?schuhe\w*`)] },
];
const CHOSE = String.raw`(?<chose>\s+(?:I chose|I picked|I selected|I've chosen|I have chosen)|,?\s+(?:den|das|die) ich (?:ausgesucht|ausgewählt|gewählt) habe)?`;
const MONITOR = [
  re(String.raw`\b(?<n>\d{2})[- ]?(?:inch|in\.|"|″|Zoll)[- ]?(?:computer[- ]?)?(?:monitor|screen|display|Bildschirm)\b${CHOSE}`),
  re(String.raw`\b(?:monitor|Bildschirm)\s+(?:mit|with)\s+(?<n>\d{2})\s*(?:Zoll|inch(?:es)?)\b${CHOSE}`),
  re(String.raw`\b(?:computer[- ]?)?(?:monitor|Bildschirm)\b${CHOSE}`),
];
const SIZE = re(String.raw`\b(?:in\s+)?(?:(?:shoe\s+)?size|Schuhgrösse|Schuhgröße|Grösse|Größe|Gr\.)\s*(?<s>\d{1,2}(?:[.,]5)?|X{0,2}[SML])\b`);
const ONE_ITEM = [
  re(String.raw`\b(?:buy\s+)?one (?:ordinary\s+|single\s+)?(?:grocery\s+)?item\b|\ba single (?:ordinary\s+)?(?:grocery\s+)?item\b`),
  re(String.raw`\b(?:einen|ein|eine|einzigen)\s+(?:einzelnen\s+)?(?:gewöhnlichen\s+|normalen\s+|üblichen\s+)?(?:Lebensmittel-?)?(?:artikel|produkt)\b`),
];
const DELIVERY = re(String.raw`\bfor delivery\b|\bto be delivered\b|\bhome delivery\b|\bdelivered to\b|\bzur Lieferung\b|\bliefern lassen\b|\bnach Hause liefern\b|\bgeliefert\b`);

const KNOWN_SHOP = [
  re(
    String.raw`\b(?:from\s+|at\s+)?(?:a |the |one of the )?(?:shops?|sellers?|stores?|retailers?|merchants?)\s+(?:that\s+|where\s+|which\s+)?I(?:'ve|\s+have)?\s+(?:already\s+)?(?:use regularly|regularly use|used before|used|use|bought from before|bought from|buy from|shopped at before|shopped at|know|trust)(?:\s+before)?\b`,
  ),
  re(String.raw`\b(?:familiar|known)\s+(?:shops?|sellers?|stores?|retailers?)\b`),
  re(
    String.raw`\b(?:bei\s+|in\s+|von\s+)?(?:einem\s+|einer\s+)?(?:Shops?|Händlern?|Verkäufern?|Geschäften?|Läden|Laden|Onlineshops?)\s*,?\s*(?:die|den|bei denen|bei dem|in dem|wo)\s+ich\s+(?:schon\s+|bereits\s+|früher\s+)?(?:regelm(?:ä|ae)ssig\s+|regelmäßig\s+|oft\s+)?(?:kenne|nutze|genutzt habe|benutze|eingekauft habe|einkaufe|gekauft habe|bestellt habe)\b`,
  ),
  re(String.raw`\b(?:bekannten|vertrauten)\s+(?:Shops|Händlern|Geschäften|Läden)\b`),
];
const SPECIALIST = [
  re(String.raw`\bspecialist (?:sports?|running|outdoor|electronics|book) (?:retailer|shop|store)s?\b`),
  re(String.raw`\b(?:sports?|sporting goods|running|outdoor|electronics|book)\s+(?:retailer|shop|store|specialist)s?\b`),
  re(String.raw`\bSport(?:fach)?(?:geschäft|händler|handel|laden|shop)\w*|\bFachhändler für (?:Sport|Elektronik)\b|\bElektronik(?:fach)?(?:händler|geschäft|markt|shop)\w*|\bBuch(?:handlung|händler)\w*`),
];
const specialistType = (text: string) =>
  /sport|running|outdoor/i.test(text)
    ? { category: "sporting_goods", label: "sports" }
    : /electronic|elektronik/i.test(text)
      ? { category: "electronics", label: "electronics" }
      : { category: "books", label: "book" };

const RDAYS = String.raw`(?<n>\d+|seven|fourteen|thirty|sieben|vierzehn|dreissig|dreißig)`;
const RETURNS = [
  re(String.raw`\b(?:can be )?returned within ${RDAYS} days(?: or more)?`),
  re(String.raw`\breturn(?:s|able)? (?:within|for at least|of at least|for) ${RDAYS} days`),
  re(String.raw`\b${RDAYS}[- ]day returns?\b`),
  re(String.raw`\breturns?\s+(?:period|window|policy)\s+of\s+(?:at least\s+)?${RDAYS} days`),
  re(String.raw`\bat least ${RDAYS} days? to return\b`),
  re(String.raw`\b(?:innerhalb von|innert|mindestens|binnen)\s+(?:mindestens\s+)?${RDAYS}\s+Tagen?\s+(?:zurückgegeben|retourniert|zurückgeschickt|zurückgesendet|zurückgeben|zurücksenden|retournieren|Rückgabe)\w*`),
  re(String.raw`\bRückgabe(?:recht|frist)?\s+(?:von\s+)?(?:mindestens\s+|min\.\s+)?${RDAYS}\s+Tage\w*`),
  re(String.raw`\b${RDAYS}\s+Tage\s+(?:Rückgaberecht|Rückgabe(?:frist)?)\b`),
  re(String.raw`\b${RDAYS}[- ]?tägige[mnrs]?\s+Rückgabe\w*`),
];
const EXTRAS = re(
  String.raw`\b(?:do not|don't) add anything I did(?: not|n't) ask for\b|\bnothing extra\b|\bno extras\b|\bonly what I (?:asked for|chose)\b|\b(?:no|without)\s+(?:add-?ons|extras|additions|additional items)\b|\bnothing (?:else|additional)\b|\bdon't add (?:any)?thing\b` +
    String.raw`|\bnichts(?:\s+dazu|\s+hinzu|\s+zusätzlich)?,?\s+was ich nicht\s+(?:bestellt|verlangt|gewünscht|ausgewählt|ausgesucht)(?:\s+habe)?\b|\bkeine\s+(?:Extras|Zusätze|Zusatzleistungen|Zusatzprodukte|Zusatzartikel|Add-?ons)\b|\bnichts Zusätzliches\b|\b(?:füge|füg)\s+nichts\s+hinzu\b|\bnichts hinzufügen\b`,
);
const SESSION = [
  re(String.raw`\b(?:pause|stop|hold) anything that looks like someone other than me is driving the session\b`),
  re(String.raw`\b(?:stoppe|pausiere|halte|blockiere)\s+alles\b[^.!?]{0,80}?\b(?:jemand anderes|jemand anders|nicht ich)\b[^.!?,]{0,40}`),
  re(String.raw`\bsomeone other than me\b|\bsomeone else\b|\b(?:isn't|is not|doesn't look like) me\b|\bjemand anderes\b|\bjemand anders\b|\beine fremde Person\b`),
];
const UNSURE = String.raw`(?:uncertain|unsure|in doubt|not sure)`;
const DECLINE_UNSURE = re(
  String.raw`\bdecline (?:when|if) ${UNSURE}\b|\bif (?:in doubt|unsure|uncertain),?\s+(?:decline|don't buy|do not buy|skip it|say no)\b|\b(?:don't|do not)\s+buy(?: it)?\s+(?:when|if)\s+${UNSURE}\b` +
    String.raw`|\bim Zweifel(?:sfall)?,?\s+(?:ablehnen|lehne ab|nicht kaufen|kauf nicht|lieber nicht)\b|\bbei Unsicherheit(?:en)?,?\s+(?:ablehnen|lehne ab|nicht kaufen)\b|\b(?:lehne|lehn)\s+(?:im Zweifel|bei Unsicherheit)\s+ab\b|\bwenn du unsicher bist,?\s+(?:lehne ab|ablehnen|kauf nicht|nicht kaufen)\b`,
);
const APPROVE_UNSURE = re(
  String.raw`\b(?:approve|buy it|go ahead) (?:when|if) ${UNSURE}\b|\bif (?:in doubt|unsure|uncertain),?\s+(?:buy|approve|go ahead)\b|\bim Zweifel(?:sfall)?,?\s+(?:kaufen|kauf es|genehmigen)\b`,
);
const ASK_UNSURE = re(
  String.raw`\bask me (?:when|if|whenever) ${UNSURE}\b|\b(?:if|when|whenever) (?:in doubt|unsure|uncertain|not sure),?\s+ask(?: me)?\b|\bcheck with me\b` +
    String.raw`|\bim Zweifel(?:sfall)?,?\s+(?:frag|frage)\s+mich\b|\bbei Unsicherheit(?:en)?,?\s+(?:frag|frage)\s+mich\b|\b(?:frag|frage)\s+mich\b(?:,?\s+wenn du (?:dir )?unsicher bist|\s+im Zweifel(?:sfall)?|\s+bei Unsicherheit(?:en)?)?`,
);

// ── Builder ────────────────────────────────────────────────────────────────────────────────────────

type Span = { start: number; end: number };

class Builder {
  rules: LeashRule[] = [];
  spans: Span[] = [];
  questions: OpenQuestion[] = [];
  assumptions: string[] = [];
  warnings: string[] = [];
  constructor(readonly text: string) {}

  find(pattern: RegExp, notInside: Span[] = [], ok: (m: RegExpExecArray) => boolean = () => true): RegExpExecArray | null {
    const g = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(this.text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (!notInside.some((s) => start < s.end && end > s.start) && ok(m)) return m;
      if (m[0].length === 0) g.lastIndex++;
    }
    return null;
  }

  /** The first pattern of a list that matches, in list order. */
  first(patterns: RegExp[], notInside: Span[] = [], ok?: (m: RegExpExecArray) => boolean): RegExpExecArray | null {
    for (const p of patterns) {
      const m = this.find(p, notInside, ok);
      if (m) return m;
    }
    return null;
  }

  /** The customer's own words for a rule, without leading or trailing commas and spaces. */
  words(m: RegExpExecArray): YourWords {
    const text = m[0].replace(/^[\s,]+|[\s,]+$/g, "");
    const start = m.index + m[0].indexOf(text);
    this.spans.push({ start, end: start + text.length });
    return { text, start, end: start + text.length };
  }

  add(key: string, label: string, group: RuleGroup, words: YourWords | null, hard_rule: MandateRule | null) {
    const n = this.rules.filter((r) => r.key === key).length;
    this.rules.push({ id: n ? `r_${key}_${n + 1}` : `r_${key}`, key, label, group, source: "you", your_words: words, hard_rule });
  }

  has(key: string) {
    return this.rules.some((r) => r.key === key);
  }
}

/** Sentences with offsets. A full stop after an abbreviation (max., inkl., Fr.) or before a digit or dash does not end one. */
function sentences(text: string): { s: string; start: number; end: number }[] {
  const raw: Span[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== "." && c !== "!" && c !== "?") continue;
    if (c === "." && (/\b(?:max|inkl|incl|Fr|SFr|ca|Gr|Nr|bzw|min)$/i.test(text.slice(Math.max(0, i - 6), i)) || /[\d\-–]/.test(text[i + 1] ?? ""))) continue;
    raw.push({ start, end: i + 1 });
    start = i + 1;
  }
  if (start < text.length) raw.push({ start, end: text.length });
  return raw.flatMap(({ start: s0, end: e0 }) => {
    const chunk = text.slice(s0, e0);
    const s = chunk.trim();
    if (!s) return [];
    const lead = chunk.length - chunk.trimStart().length;
    return [{ s, start: s0 + lead, end: s0 + lead + s.length }];
  });
}

export function compile(instruction: string): ParseResult {
  const text = instruction.trim();
  const b = new Builder(text);
  const validDays = (m: RegExpExecArray) => {
    const d = m.groups?.d;
    return d === undefined || (Number.isInteger(toNumber(d)) && toNumber(d) > 0);
  };
  let bareAmount = false;

  // Rolling period budget first, so its amount is not read as a per-order limit.
  const period = b.first(PERIOD_WITH_DAYS, [], validDays) ?? b.first(PERIOD_WITH_UNIT);
  const periodSpans: Span[] = [];
  if (period) {
    const days = period.groups?.d !== undefined ? toNumber(period.groups.d) : period.groups?.u !== undefined ? unitDays(period.groups.u) : 7;
    const limit = amountOf(period);
    bareAmount ||= isBare(period);
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
  const order = b.first(ORDER_LIMIT, periodSpans);
  if (order) {
    const limit = amountOf(order);
    bareAmount ||= isBare(order);
    const inclDelivery = !!order.groups?.inc || INCL_DELIVERY_ANYWHERE.test(text);
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
  if (bareAmount) b.assumptions.push("You gave an amount without a currency, so I read it as Swiss francs (CHF).");

  // What may be bought.
  const groceries = b.first(GROCERIES);
  if (groceries) {
    b.add(RULE_KEYS.purpose, "Groceries only", "purpose", b.words(groceries), { field: RULE_FIELDS.itemCategory, operator: "in", value: ["groceries"] });
    b.assumptions.push(`"Groceries" means every item in the basket is a grocery item; the delivery fee is fine.`);
  }
  const clothing = b.first(CLOTHING);
  if (clothing) b.add(RULE_KEYS.purpose, "Clothing only", "purpose", b.words(clothing), { field: RULE_FIELDS.itemCategory, operator: "in", value: ["clothing"] });

  for (const { res, item } of ITEMS) {
    const m = b.first(res);
    if (!m) continue;
    b.add(RULE_KEYS.requested_item, `Only ${item}`, "purpose", b.words(m), { field: RULE_FIELDS.requestedItem, operator: "=", value: item });
    b.assumptions.push(`Anything in the basket that isn't ${item} counts as an extra.`);
    break;
  }
  if (!b.has(RULE_KEYS.requested_item)) {
    const monitor = b.first(MONITOR);
    if (monitor) {
      const item = monitor.groups?.n ? `${monitor.groups.n}-inch monitor` : "monitor";
      b.add(RULE_KEYS.requested_item, `Only the ${item}${monitor.groups?.chose ? " you chose" : ""}`, "purpose", b.words(monitor), {
        field: RULE_FIELDS.requestedItem,
        operator: "=",
        value: item,
      });
      b.assumptions.push(`Anything in the basket that isn't the ${item} counts as an extra.`);
    }
  }

  const size = b.find(SIZE);
  if (size) {
    const s = String(size.groups?.s).replace(",", ".");
    b.add(RULE_KEYS.item_size, `Size ${s}`, "purpose", b.words(size), { field: RULE_FIELDS.size, operator: "=", value: s });
    b.assumptions.push("If the shop doesn't state the size, I'm not sure, so I'll ask you.");
  }

  const one = b.first(ONE_ITEM);
  if (one) {
    b.add(RULE_KEYS.one_item, "One item per order", "purpose", b.words(one), null);
    b.questions.push({ id: QUESTION_IDS.closeAfterFirst, text: "After the first item is bought, should the agent stop buying?", options: ["Yes", "No"] });
  }

  const delivery = b.find(DELIVERY);
  if (delivery) b.add(RULE_KEYS.delivery, "Delivered orders", "purpose", b.words(delivery), null);

  // Where it may be bought.
  const known = b.first(KNOWN_SHOP);
  if (known) {
    b.add(RULE_KEYS.known_shop, "Only shops you've bought from", "restrictions", b.words(known), { field: RULE_FIELDS.familiarOnCard, operator: "=", value: "true" });
    const phrase = /regularly|regelm/i.test(known[0]) ? "use regularly" : "before";
    b.assumptions.push(`I read "${phrase}" as: at least one approved purchase at that shop with this card.`);
    b.questions.push({ id: QUESTION_IDS.otherCard, text: "Does a shop you used with your other card count as known?", options: ["Yes", "No"] });
  }
  const specialist = b.first(SPECIALIST);
  if (specialist) {
    const t = specialistType(specialist[0]);
    b.add(RULE_KEYS.merchant_type, `Only specialist ${t.label} shops`, "restrictions", b.words(specialist), { field: RULE_FIELDS.merchantCategory, operator: "in", value: [t.category] });
    b.assumptions.push(`"Specialist ${t.label} retailer" means a shop whose category is ${t.category.replace("_", " ")}.`);
  }
  const returns = b.first(RETURNS);
  if (returns) {
    const days = toNumber(returns.groups?.n as string);
    b.add(RULE_KEYS.return_window, `Returnable for at least ${days} days`, "restrictions", b.words(returns), { field: RULE_FIELDS.returnWindow, operator: ">=", value: days });
    b.assumptions.push("If the return terms are missing, I'm not sure, so I'll ask you.");
  }
  const extras = b.find(EXTRAS);
  if (extras) b.add(RULE_KEYS.no_extras, "Nothing you didn't ask for", "restrictions", b.words(extras), { field: RULE_FIELDS.addonsAllowed, operator: "=", value: "false" });
  const session = b.first(SESSION);
  if (session) {
    // "... stop and ask me": the customer wants a question, not a stop, however many signs there are.
    const sentence = instruction.split(/(?<=[.!?])\s+/).find((s) => SESSION.some((r) => r.test(s))) ?? "";
    const asks = /\bask\b/i.test(sentence) && !/\b(don't|do\s+not|never)\s+ask\b/i.test(sentence);
    b.add(RULE_KEYS.session, asks ? "Ask if it doesn't look like you" : "Pause if it doesn't look like you", "restrictions", b.words(session), { field: RULE_FIELDS.sessionIntegrity, operator: "=", value: asks ? "ask" : "required" });
    b.assumptions.push("A new phone, unusual hours, a burst of orders or a new country makes it look like someone else; then I ask you.");
  }

  // When unsure.
  let uncertainty: UncertaintyPolicy = "ask";
  const decline = b.find(DECLINE_UNSURE);
  const approve = b.find(APPROVE_UNSURE);
  const ask = b.find(ASK_UNSURE);
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
  const not_understood = sentences(text)
    .filter((x) => !b.spans.some((sp) => sp.start < x.end && sp.end > x.start))
    .map((x) => x.s);

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
      hard_rule: null,
    });
  }
  if (yes(QUESTION_IDS.otherCard)) {
    const known = rules.find((r) => r.key === RULE_KEYS.known_shop);
    if (known) known.label = "Only shops you've bought from, with either card";
  }
  return rules;
}
