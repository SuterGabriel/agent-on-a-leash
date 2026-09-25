// What a customer's own profile text says about how they shop, as signals the cold start can use.
// The text is the issuer's synthetic persona (background, shopping preferences, typical spending, travel pattern).
// Deterministic keyword reading; the Apertus reader (llm/profileReader.ts) returns the same shape and falls back here.
// Signals are evidence and priors only: they never approve or decline anything.

export interface ProfileSignals {
  /** Merchant categories (items.csv / merchants.csv names) the text suggests, strongest first. */
  categories: string[];
  night_owl: boolean;
  /** ISO country codes the customer travels to or buys from. */
  travel_countries: string[];
  prefers_refundable: boolean;
  prefers_known_shops: boolean;
  /** "careful" / "planned_high_value" … as the text or the budget style says. */
  budget_hint: string | null;
  /** Where the signals came from, for the evidence: "keywords" or "apertus". */
  source: "keywords" | "apertus";
}

export interface ProfileText {
  background?: string;
  shopping_preferences?: string;
  typical_spending?: string;
  travel_pattern?: string;
  budget_style?: string;
}

// Words → merchant categories. General vocabulary, not tied to any scenario.
const CATEGORY_WORDS: [RegExp, string][] = [
  [/\bgrocer(y|ies)|supermarkets?|pantry|fresh produce|bakery|dairy/i, "groceries"],
  [/\bmeal[- ]?delivery|food delivery|delivery (?:apps?|service)|orders? dinner|takeaway|meal kit/i, "food_delivery"],
  [/\brestaurants?|dining|dinners? out|brunch|casual dining/i, "dining"],
  [/\belectronics?|gadgets?|computers?|monitors?|headphones|chargers?|tech\b/i, "electronics"],
  [/\bcamera|lens(es)?|photograph/i, "photography"],
  [/\bsports?|running|ski(-|\s)?tour|hiking|trail|cycling|gym|technical gear|outdoor/i, "sporting_goods"],
  [/\bhotels?|accommodation|bookings? (?:with|directly)|stays?\b|refundable (?:hotel )?rates?/i, "hotel"],
  [/\btravel\b|flights?|trips? abroad|rail (?:tickets?|operators?)|weekend trips?/i, "travel"],
  [/\brail|train|transit|transport|tickets?\b/i, "transport"],
  [/\bsubscriptions?|streaming|memberships?|monthly plans?|pausable plans?/i, "subscriptions"],
  [/\bpharmac(y|ies)|health|medicine/i, "health"],
  [/\bhousehold|furniture|flat\b|home setup|cleaning/i, "household"],
  [/\bclothes|clothing|fashion|jackets?|shoes\b/i, "clothing"],
  [/\bfuel|petrol|drives? to|car\b/i, "fuel"],
  [/\bbooks?\b|\breading\b/i, "books"],
  [/\bpets?\b|dog|cat food/i, "pet_care"],
  [/\bgames?|gaming|streams? games/i, "entertainment"],
];

const COUNTRY_WORDS: [RegExp, string][] = [
  [/\bgerman(y)?\b|munich|berlin|konstanz/i, "DE"],
  [/\bfran(ce|ch)\b|paris|mulhouse|lyon/i, "FR"],
  [/\baustria(n)?\b|vienna|innsbruck/i, "AT"],
  [/\bital(y|ian)\b|milan|rome/i, "IT"],
  [/\bunited states|usa\b|\bus\b|america/i, "US"],
  [/\bunited kingdom|\buk\b|london|britain/i, "GB"],
  [/\bnetherlands|dutch|amsterdam/i, "NL"],
  [/\bspain|spanish|barcelona|madrid/i, "ES"],
];

export function readProfileByKeywords(p: ProfileText): ProfileSignals {
  const shop = [p.shopping_preferences, p.typical_spending, p.background].filter(Boolean).join(" ");
  const all = [shop, p.travel_pattern].filter(Boolean).join(" ");
  // Strongest first: a category named in the shopping preferences counts more than one in the background.
  const scored = new Map<string, number>();
  for (const [text, weight] of [[p.shopping_preferences ?? "", 3], [p.typical_spending ?? "", 2], [p.background ?? "", 1]] as const) {
    for (const [re, cat] of CATEGORY_WORDS) if (re.test(text)) scored.set(cat, (scored.get(cat) ?? 0) + weight);
  }
  const categories = [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return {
    categories,
    night_owl: /\bnight|evening|after (?:1[89]|2\d):00|late(?:-| )?shift|early-morning/i.test(shop),
    travel_countries: [...new Set(COUNTRY_WORDS.filter(([re]) => re.test(all)).map(([, c]) => c))],
    prefers_refundable: /refundable|return window|free cancell?ation/i.test(shop),
    prefers_known_shops: /familiar|usual|same (?:[\w-]+ )?(?:service|shop|supermarket)|regular merchants|directly with/i.test(shop) && !/not yet settled/i.test(shop),
    budget_hint: p.budget_style ?? null,
    source: "keywords",
  };
}
