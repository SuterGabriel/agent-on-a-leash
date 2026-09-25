import { readProfileByKeywords, type ProfileSignals, type ProfileText } from "../coldstart/profileSignals.js";
import type { Apertus, LlmCall } from "./apertus.js";

// Apertus, use 1: read a NEW customer's own profile text (no purchases yet) into signals for the cold start.
// The answer is validated against a closed list of categories and ISO country codes; anything off-list is dropped.
// If the model is off, slow or wrong, the keyword reader answers instead. Signals are priors and evidence only.

export const KNOWN_CATEGORIES = [
  "groceries", "food_delivery", "dining", "electronics", "photography", "sporting_goods", "hotel", "travel", "transport",
  "subscriptions", "membership", "health", "household", "home_improvement", "clothing", "fuel", "books", "pet_care",
  "kids_family", "entertainment", "software", "sustainable_goods", "cosmetics",
] as const;

const SYSTEM = [
  "You read a Swiss bank customer's short profile and say how they shop. Use only facts stated in the text; never guess beyond it.",
  "Reply with one JSON object and nothing else:",
  '{"categories": [up to 5 values from the allowed list, most likely first],',
  ' "night_owl": true if the text says they shop in the evening or at night,',
  ' "travel_countries": [ISO 3166 alpha-2 codes of countries they travel to or buy from],',
  ' "prefers_refundable": true if they want refundable rates, return windows or free cancellation,',
  ' "prefers_known_shops": true if they stick to familiar, usual or the same shops/services}',
  `Allowed categories: ${KNOWN_CATEGORIES.join(", ")}.`,
].join("\n");

function validate(v: unknown): Omit<ProfileSignals, "budget_hint" | "source"> {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o) throw new Error("not an object");
  const cats = Array.isArray(o.categories) ? o.categories.map(String).filter((c) => (KNOWN_CATEGORIES as readonly string[]).includes(c)) : [];
  const countries = Array.isArray(o.travel_countries) ? o.travel_countries.map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c) && c !== "CH") : [];
  const bool = (k: string) => {
    if (typeof o[k] !== "boolean") throw new Error(`${k} must be true or false`);
    return o[k] as boolean;
  };
  return { categories: [...new Set(cats)].slice(0, 5), night_owl: bool("night_owl"), travel_countries: [...new Set(countries)], prefers_refundable: bool("prefers_refundable"), prefers_known_shops: bool("prefers_known_shops") };
}

export async function readProfile(llm: Apertus, text: ProfileText): Promise<{ signals: ProfileSignals; call: LlmCall }> {
  const fallback = readProfileByKeywords(text);
  const user = [
    text.background && `Background: ${text.background}`,
    text.shopping_preferences && `Shopping preferences: ${text.shopping_preferences}`,
    text.typical_spending && `Typical spending: ${text.typical_spending}`,
    text.travel_pattern && `Travel: ${text.travel_pattern}`,
  ]
    .filter(Boolean)
    .join("\n");
  if (!user) return { signals: fallback, call: { used: false, cached: false, fallback: true, latency_ms: 0, model: llm.modelName, error: "no profile text" } };
  const { value, call } = await llm.json(SYSTEM, user, validate, 250);
  if (!value || value.categories.length === 0) return { signals: fallback, call: { ...call, fallback: true } };
  return { signals: { ...value, budget_hint: text.budget_style ?? null, source: "apertus" }, call };
}
