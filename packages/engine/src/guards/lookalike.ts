// Guard 12: lookalike seller. A shop nobody at the issuer has bought from, whose name is almost
// the name of a shop this customer trusts, is an imitation.
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

export const lookalikeMerchant: Guard = ({ auth, base, customerId }) => {
  const m = auth.merchant;
  const known = customerId ? base.customerMerchants.get(customerId) : undefined;
  if (!known || known.has(m.merchant_id)) return { guard: "lookalike", verdict: "PASS", evidence: [] };

  let best: { id: string; name: string; score: number } | null = null;
  for (const id of known.keys()) {
    const other = base.merchantNames.get(id);
    if (!other || id === m.merchant_id || other.category !== m.merchant_category) continue;
    const score = similarity(m.merchant_name, other.name);
    if (!best || score > best.score) best = { id, name: other.name, score };
  }
  if (!best || best.score < THRESHOLD) return { guard: "lookalike", verdict: "PASS", evidence: [] };

  const issuerCount = base.issuerMerchants.get(m.merchant_id) ?? 0;
  const evidence = [
    { fact: "name_similarity", value: Math.round(best.score * 100) / 100, comparator: ">=", threshold: THRESHOLD, source: `${m.merchant_name} vs ${best.name}` },
    { fact: "issuer_approved_purchases_at_shop", value: issuerCount, comparator: "=", threshold: 0, source: "authorization_history (all customers)" },
  ];
  return {
    guard: "lookalike",
    verdict: issuerCount === 0 ? "DECLINE" : "STEP_UP",
    reason_code: "lookalike_shop",
    evidence,
    message: `"${m.merchant_name}" is not "${best.name}", where you bought before.${issuerCount === 0 ? " No customer of ours has ever bought there." : ""}`,
  };
};
