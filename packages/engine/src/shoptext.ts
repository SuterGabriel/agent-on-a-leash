// Shop text quarantine. Merchant-supplied text (item_details) is DATA, never instruction.
// 1. normalise (Unicode NFKC, strip zero-width/format chars)
// 2. split into sentences
// 3. flag sentences aimed at the agent (they never change the decision in the shop's favour)
// 4. extract product facts (size, return days, final sale) ONLY from clean sentences
import type { CartLine } from "../../shared/src/types";

export interface FlaggedSentence {
  line_no: number;
  text: string; // quoted to the customer, max 160 chars
  patterns: string[];
}

export interface LineFacts {
  line_no: number;
  size: string | null;
  returnDays: number | null;
  finalSale: boolean;
  returnNotStated: boolean;
  billedRecurring: boolean;
  refundable: boolean; // a clean sentence says refundable / free cancellation
  clean: string[]; // sentences that passed the injection scan (searchable as data, never obeyed)
}

export interface ShopTextReport {
  flagged: FlaggedSentence[];
  lines: LineFacts[];
}

// Each group covers one manipulation tactic. EN plus cheap DE/FR variants.
const INJECTION_PATTERNS: Array<[string, RegExp]> = [
  ["addresses_the_agent", /\b(automated|ai|shopping|purchasing)\s+(purchasing\s+)?(agent|assistant|bot)s?\b|\b(note|message)\s+(for|to)\s+(the\s+)?(agent|assistant)|\bKI[-\s]?Agent|\bagent\s+d'achat/i],
  ["role_marker", /(^|[\s.;:])(system|assistant|instruction|developer)\s*:/i],
  ["ignore_instructions", /\b(ignore|disregard|override|bypass)\b.{0,40}\b(instruction|limit|rule|check|polic)|\bignorier|\bignore[rz]\s+les/i],
  ["claims_authorisation", /\bpre[-\s]?authori[sz]ed\b|\bcardholder\s+(has\s+)?(approved|authori[sz]ed|agreed)|\bbereits\s+(genehmigt|freigegeben)|\bdéjà\s+autoris/i],
  ["limits_do_not_apply", /\blimits?\s+(do|does)\s+not\s+apply|\bno\s+limit\s+applies|\bLimit\w*\s+gilt\s+nicht|\blimites?\s+ne\s+s'appliqu/i],
  ["orders_approval", /\bapprove\s+(this|the)\s+(payment|purchase|order)|\bmay\s+be\s+approved\s+without|\bwithout\s+further\s+checks|\bgenehmige\s+(diese|die)|\bapprouve[rz]?\s+(ce|le)\s+paiement/i],
  ["urgency_or_absence", /\b(immediately|right\s+now|urgent(ly)?)\b.{0,60}\b(approve|confirm|pay)|\bcardholder\s+is\s+(unavailable|away|not\s+available)|\bsofort\s+(genehmig|bezahl)/i],
];

const ZERO_WIDTH = /[​-‏‪-‮⁠-⁤﻿­]/g;

export function normalise(text: string): string {
  return text.normalize("NFKC").replace(ZERO_WIDTH, "").replace(/\s+/g, " ").trim();
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function scanSentence(sentence: string): string[] {
  return INJECTION_PATTERNS.filter(([, re]) => re.test(sentence)).map(([name]) => name);
}

export function quarantine(items: CartLine[]): ShopTextReport {
  const flagged: FlaggedSentence[] = [];
  const lines: LineFacts[] = [];

  for (const item of items) {
    const facts: LineFacts = {
      line_no: item.line_no,
      size: null,
      returnDays: null,
      finalSale: false,
      returnNotStated: false,
      billedRecurring: false,
      refundable: false,
      clean: [],
    };
    const text = normalise(item.item_details ?? "");

    for (const sentence of splitSentences(text)) {
      const patterns = scanSentence(sentence);
      if (patterns.length) {
        flagged.push({ line_no: item.line_no, text: sentence.slice(0, 160), patterns });
        continue; // never extract facts from a manipulative sentence
      }
      facts.clean.push(sentence);
      for (const part of sentence.split(/;\s*/)) {
        const size = part.match(/\b(?:size|gr(?:ö|oe)sse|gr\.|taille)\s*([A-Z0-9]{1,4}(?:[.,]5)?)\b/i);
        if (size && facts.size === null) facts.size = size[1].toUpperCase();
        const days = part.match(/\breturns?\s+accepted\s+within\s+(\d+)\s+days?|\b(\d+)[-\s]day\s+returns?|\b(\d+)\s+Tage\s+Rückgabe/i);
        if (days && facts.returnDays === null) facts.returnDays = Number(days[1] ?? days[2] ?? days[3]);
        if (/\bfinal\s+sale\b|\bno\s+returns\b|\bnon[-\s]?returnable\b|\bnon[-\s]?refundable\b|\bvom\s+Umtausch\s+ausgeschlossen/i.test(part)) facts.finalSale = true;
        else if (/(?<!non[-\s]?)\brefundable\b|\bfree\s+cancell?ation\b|\bfully\s+refund/i.test(part)) facts.refundable = true;
        if (/\breturn\s+policy\s+not\s+stated\b|\bno\s+return\s+policy\b/i.test(part)) facts.returnNotStated = true;
        if (/\bbilled\s+(monthly|yearly|annually)\b|\bsubscription\b|\brenews\s+automatically\b/i.test(part)) facts.billedRecurring = true;
      }
    }
    lines.push(facts);
  }
  return { flagged, lines };
}
