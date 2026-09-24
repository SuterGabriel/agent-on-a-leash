// Guard: things the customer excluded ("no alcohol, no gift cards"). A line is blocked when its category is
// excluded, or when its name, its category or a CLEAN sentence of the shop text mentions an excluded keyword.
// A keyword right after "no" / "without" / "not" ("no insurance included") is not a mention.
import type { Evidence } from "../../../shared/src/types";
import type { Guard } from "../types";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function mentions(text: string, keyword: string): boolean {
  const words = keyword.split(/[\s-]+/).map(escape).join("[\\s-]*");
  const re = new RegExp(String.raw`(^|[^a-z0-9])(no|not|without|excluding|excl\.?)?\s*${words}(s|es)?(?![a-z0-9])`, "gi");
  for (const m of text.normalize("NFKC").toLowerCase().matchAll(re)) if (!m[2]) return true;
  return false;
}

export const blockedItems: Guard = ({ auth, policy, shop }) => {
  const cats = policy.blockedCategories ?? [];
  const kws = policy.blockedKeywords ?? [];
  if (!cats.length && !kws.length) return { guard: "blocked", verdict: "SKIP", evidence: [] };

  const evidence: Evidence[] = [];
  for (const i of auth.items) {
    if (cats.includes(i.item_category)) {
      evidence.push({ fact: "blocked_category", value: i.item_category, comparator: "not_in", threshold: cats.join(","), source: `items[${i.line_no}].item_category` });
      continue;
    }
    const clean = shop.lines.find((l) => l.line_no === i.line_no)?.clean ?? [];
    const places: Array<[string, string]> = [
      [i.item_name, `items[${i.line_no}].item_name`],
      [i.item_category.replace(/_/g, " "), `items[${i.line_no}].item_category`],
      ...clean.map((t): [string, string] => [t, `items[${i.line_no}].item_details`]),
    ];
    const hit = kws.flatMap((k) => places.filter(([t]) => mentions(t, k)).map(([, source]) => ({ k, source })))[0];
    if (hit) evidence.push({ fact: "blocked_keyword", value: hit.k, comparator: "not_in", threshold: i.item_name, source: hit.source });
  }
  if (!evidence.length) return { guard: "blocked", verdict: "PASS", evidence: [{ fact: "blocked_lines", value: 0, comparator: "=", threshold: 0, source: "items[]" }] };

  const first = evidence[0];
  return {
    guard: "blocked",
    verdict: "DECLINE",
    reason_code: "blocked_item",
    evidence,
    message: `The basket has something you excluded (${first.value}, in ${first.source}).`,
  };
};
