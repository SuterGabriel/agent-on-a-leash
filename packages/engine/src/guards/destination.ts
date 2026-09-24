// Guard: the destination of a stay ("a hotel in Lyon"). A lodging shop must be in that city.
// A shop that is not a hotel but sells a hotel line (a booking site) cannot show where the stay is: UNCERTAIN.
// City names are compared without accents and case, with common local/English names treated as one city.
import type { Guard } from "../types";

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

// Local and English names of the same city.
const SAME_CITY: string[][] = [
  ["munich", "munchen", "muenchen"], ["geneva", "geneve", "genf", "ginevra"], ["zurich", "zuerich"], ["lucerne", "luzern"],
  ["basel", "bale", "basle"], ["bern", "berne"], ["vienna", "wien"], ["cologne", "koln", "koeln"], ["nuremberg", "nurnberg", "nuernberg"],
  ["milan", "milano"], ["rome", "roma"], ["florence", "firenze"], ["venice", "venezia"], ["turin", "torino"], ["naples", "napoli"],
  ["prague", "praha"], ["lisbon", "lisboa"], ["brussels", "bruxelles", "brussel"], ["copenhagen", "kobenhavn"], ["warsaw", "warszawa"],
  ["athens", "athina"], ["the hague", "den haag"].map(norm), ["neuchatel", "neuenburg"], ["fribourg", "freiburg im uechtland"].map(norm),
];
const canonical = (city: string) => {
  const n = norm(city);
  return SAME_CITY.find((g) => g.includes(n))?.[0] ?? n;
};

export const destination: Guard = ({ auth, policy, addonLines }) => {
  const want = policy.destinationCity;
  if (!want) return { guard: "destination", verdict: "SKIP", evidence: [] };
  const m = auth.merchant;
  const lodgingShop = m.merchant_category === "hotel";
  const stayLines = auth.items.filter((i) => !addonLines.has(i.line_no) && i.item_category === "hotel");
  const evidence = [{ fact: "merchant_city", value: m.merchant_city, comparator: "=", threshold: want, source: "authorization.merchant.merchant_city" }];

  if (!lodgingShop) {
    if (!stayLines.length) return { guard: "destination", verdict: "SKIP", evidence: [] };
    return {
      guard: "destination",
      verdict: "UNCERTAIN",
      reason_code: "missing_info",
      evidence,
      message: `${m.merchant_name} is not a hotel, so we cannot tell whether "${stayLines[0]?.item_name}" is in ${want}.`,
    };
  }
  if (canonical(m.merchant_city) === canonical(want)) return { guard: "destination", verdict: "PASS", evidence };
  return {
    guard: "destination",
    verdict: "DECLINE",
    reason_code: "wrong_destination",
    evidence,
    message: `${m.merchant_name} is in ${m.merchant_city}. You asked for a stay in ${want}.`,
  };
};
