import type { Apertus, LlmCall } from "./apertus.js";

// Apertus, use 2: a leash written in German, French, Italian, Swiss German or Romansh. Apertus translates it into
// plain English; our own compiler then reads the English (the only reading of a leash). The model is never trusted
// with the numbers: every amount, size and currency of the ORIGINAL must come back unchanged in the translation,
// otherwise the leash is marked "please check" and the app shows both texts before anything is created.

export interface Understood {
  /** "en", "de", "gsw" (Swiss German), "fr", "it", "rm" or "other". */
  language: string;
  original: string;
  english: string;
  translated: boolean;
  /** Numbers or currencies of the original that the translation lost or changed. Empty = safe. */
  please_check: string[];
  call: LlmCall;
}

const LANGS = new Set(["en", "de", "gsw", "fr", "it", "rm", "other"]);

const SYSTEM = [
  "You translate a shopping instruction that a customer gives to their AI shopping agent into plain English.",
  "Detect its language: en, de, gsw (Swiss German dialect), fr, it, rm (Romansh) or other.",
  "Translate faithfully: keep every number, amount, currency, size, percentage and date exactly as written, in digits.",
  "Write amounts as 'CHF 180' / 'EUR 200'. Do not add, explain, soften or drop any rule. Keep 'ask me' / 'decline' wishes.",
  'Reply with one JSON object and nothing else: {"language": "...", "english": "..."}',
  "If the text is already English, return it unchanged with language en.",
].join("\n");

const CURRENCY: [RegExp, string][] = [
  [/\bCHF\b|\bFr\.|\bSFr\b|\bFranken\b|\bfrancs?\b|\bfranchi\b|\bstutz\b|\bchf\b/i, "CHF"],
  [/\bEUR\b|€|\beuros?\b/i, "EUR"],
  [/\bUSD\b|\$|\bdollars?\b/i, "USD"],
  [/\bGBP\b|£|\bpounds?\b/i, "GBP"],
];

/** Numbers as the customer wrote them, normalised: "1'000" → 1000, "12,50" → 12.5. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d{1,3}(?:['’]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(/['’]/g, "").replace(",", ".")));
}

export function currenciesIn(text: string): string[] {
  return CURRENCY.filter(([re]) => re.test(text)).map(([, c]) => c);
}

/** What the translation lost: numbers or currencies of the original that are missing from the English. */
export function lostInTranslation(original: string, english: string): string[] {
  const out: string[] = [];
  const have = numbersIn(english);
  for (const n of numbersIn(original)) {
    const i = have.indexOf(n);
    if (i < 0) out.push(String(n));
    else have.splice(i, 1);
  }
  const cur = currenciesIn(english);
  for (const c of currenciesIn(original)) if (!cur.includes(c)) out.push(c);
  return out;
}

function validate(v: unknown): { language: string; english: string } {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  const language = String(o?.language ?? "").toLowerCase();
  const english = String(o?.english ?? "").trim();
  if (!LANGS.has(language)) throw new Error(`unknown language ${language}`);
  if (!english || english.length > 4_000) throw new Error("empty or too long translation");
  return { language, english };
}

/** Cheap first look, so plain English never goes to the model. */
function looksEnglish(text: string): boolean {
  const words = text.toLowerCase().match(/[a-zäöüéèàç]+/g) ?? [];
  if (!words.length) return true;
  const en = new Set(["the", "and", "or", "per", "order", "buy", "me", "my", "only", "from", "shops", "when", "ask", "no", "more", "than", "each", "any", "days", "at", "up", "to", "for", "with", "i", "not", "in", "of", "a"]);
  // Common shopping words of the other national languages: any of them means "ask the model".
  const foreign =
    /[äöüéèàçò]|\b(und|oder|nicht|mir|mich|bitte|nur|jede|keine|kaufe|höchstens|bestellung|franken|nöd|chauf|frag|pour|avec|sans|pas|seulement|commande|achète|achete|maximum\s+de|par|demande|compra|acquista|massimo|ordine|ogni|più|solo|non|chiedimi|generi|alimentari|settimana)\b/i;
  return !foreign.test(text) && words.filter((w) => en.has(w)).length / words.length >= 0.3;
}

/** English thousands separators ("1,500") written without them, so the compiler and the number check read 1500. */
export function englishThousands(text: string): string {
  return text.replace(/\b\d{1,3}(?:,\d{3})+(?![\d.,])/g, (m) => m.replace(/,/g, ""));
}

export async function understandLeash(llm: Apertus, instruction: string): Promise<Understood> {
  const original = instruction.trim();
  const none: LlmCall = { used: false, cached: false, fallback: false, latency_ms: 0, model: llm.modelName };
  if (looksEnglish(original)) return { language: "en", original, english: original, translated: false, please_check: [], call: none };
  const { value, call } = await llm.json(SYSTEM, original, validate, Math.min(900, 120 + original.length));
  if (!value) {
    // No model: the compiler still reads German itself; other languages come back with a clear "please check".
    return { language: "other", original, english: original, translated: false, please_check: ["The translation service did not answer. Please check the rules we read, or write the leash in English or German."], call };
  }
  if (value.language === "en" || value.english === original) {
    // The model called a foreign text English (it happens with Italian): ask once more, saying it isn't.
    const again = await llm.json(`${SYSTEM}\nThe text is NOT in English. Detect its real language and translate it.`, original, validate, Math.min(900, 120 + original.length));
    if (again.value && again.value.language !== "en" && again.value.english !== original) {
      const english = englishThousands(again.value.english);
      return { language: again.value.language, original, english, translated: true, please_check: lostInTranslation(original, english), call: again.call };
    }
    return { language: "other", original, english: original, translated: false, please_check: ["We could not translate this leash. Please check the rules we read, or write it in English or German."], call };
  }
  const english = englishThousands(value.english);
  return { language: value.language, original, english, translated: true, please_check: lostInTranslation(original, english), call };
}

const LABELS_SYSTEM = [
  "Translate short UI labels of a banking app from English into the target language. Keep numbers, CHF amounts and times exactly.",
  'Reply with one JSON object and nothing else: {"labels": [the translated labels, same order, same count]}',
].join("\n");

/** The chips back in the customer's language, for display only. Fallback: the English labels. */
export async function localizeLabels(llm: Apertus, labels: string[], language: string): Promise<{ labels: string[]; call: LlmCall | null }> {
  if (!labels.length || language === "en" || language === "other") return { labels, call: null };
  const target = { de: "German", gsw: "Swiss German", fr: "French", it: "Italian", rm: "Romansh" }[language] ?? language;
  const { value, call } = await llm.json(LABELS_SYSTEM, `Target language: ${target}\nLabels:\n${JSON.stringify(labels)}`, (v) => {
    const arr = (v as { labels?: unknown })?.labels;
    if (!Array.isArray(arr) || arr.length !== labels.length) throw new Error("wrong number of labels");
    const out = arr.map(String);
    // A label whose numbers changed is not shown translated.
    return out.map((l, i) => (lostInTranslation(labels[i] ?? "", l).length ? (labels[i] ?? l) : l));
  }, Math.min(900, 80 + JSON.stringify(labels).length));
  return { labels: value ?? labels, call };
}
