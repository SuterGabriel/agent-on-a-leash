// Guard 12: lookalike seller. A shop nobody at the issuer has bought from, whose name is almost
// the name of a shop this customer trusts, is an imitation.
// Also compared with every ESTABLISHED shop at the issuer (approved purchases in the history, same category),
// so a customer with little or no history is protected too.
// An IDENTICAL normalised name ("Night Owl Kitchen" / "NightOwl Kitchen") is the same brand, not an imitation:
// only 0.85 <= similarity < 1.0 counts. Whether the customer knows that shop is the familiarity guard's job.
import type { Guard } from "../types";

const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^a-z0-9]/g, "");

/** 1 - edit distance / length. Swapped neighbours ("Hrabor") count as ONE edit (Damerau). */
export function similarity(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x.length || !y.length) return 0;
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) =>
    Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return 1 - d[x.length][y.length] / Math.max(x.length, y.length);
}

const THRESHOLD = 0.85;

type Match = { id: string; name: string; score: number };

/** The most similar shop below an identical name; null when the name is identical to one of them (same brand). */
function closest(name: string, category: string, selfId: string, ids: Iterable<string>, names: Map<string, { name: string; category: string }>): Match | null {
  let best: Match | null = null;
  for (const id of ids) {
    const other = names.get(id);
    if (!other || id === selfId || other.category !== category) continue;
    if (norm(name) === norm(other.name)) return null;
    const score = similarity(name, other.name);
    if (!best || score > best.score) best = { id, name: other.name, score };
  }
  return best;
}

export const lookalikeMerchant: Guard = ({ auth, base, customerId }) => {
  const m = auth.merchant;
  const known = customerId ? base.customerMerchants.get(customerId) : undefined;
  if (known?.has(m.merchant_id)) return { guard: "lookalike", verdict: "PASS", evidence: [] };
  const issuerCount = base.issuerMerchants.get(m.merchant_id) ?? 0;

  // 1. Against the shops this customer bought from.
  const mine = known ? closest(m.merchant_name, m.merchant_category, m.merchant_id, known.keys(), base.merchantNames) : null;
  if (mine && mine.score >= THRESHOLD) {
    const evidence = [
      { fact: "name_similarity", value: Math.round(mine.score * 100) / 100, comparator: ">=", threshold: THRESHOLD, source: `${m.merchant_name} vs ${mine.name}` },
      { fact: "issuer_approved_purchases_at_shop", value: issuerCount, comparator: "=", threshold: 0, source: "authorization_history (all customers)" },
    ];
    return {
      guard: "lookalike",
      verdict: issuerCount === 0 ? "DECLINE" : "STEP_UP",
      reason_code: "lookalike_shop",
      evidence,
      message: `"${m.merchant_name}" is not "${mine.name}", where you bought before.${issuerCount === 0 ? " No customer of ours has ever bought there." : ""}`,
    };
  }

  // 2. Against every established shop at the issuer. Only a shop with no purchases at all can be an imitation here:
  //    two established shops with similar names are simply two shops.
  if (issuerCount > 0) return { guard: "lookalike", verdict: "PASS", evidence: [] };
  const established = closest(m.merchant_name, m.merchant_category, m.merchant_id, base.issuerMerchants.keys(), base.merchantNames);
  if (!established || established.score < THRESHOLD) return { guard: "lookalike", verdict: "PASS", evidence: [] };
  return {
    guard: "lookalike",
    verdict: "DECLINE",
    reason_code: "lookalike_shop",
    evidence: [
      { fact: "name_similarity", value: Math.round(established.score * 100) / 100, comparator: ">=", threshold: THRESHOLD, source: `${m.merchant_name} vs ${established.name} (established shop)` },
      { fact: "issuer_approved_purchases_at_shop", value: 0, comparator: "=", threshold: 0, source: "authorization_history (all customers)" },
      { fact: "issuer_approved_purchases_at_original", value: base.issuerMerchants.get(established.id) ?? 0, comparator: ">", threshold: 0, source: "authorization_history (all customers)" },
    ],
    message: `"${m.merchant_name}" looks like "${established.name}", an established shop, but no customer of ours has ever bought there.`,
  };
};
