// Guard: per-unit limit ("CHF 200 per night", "CHF 30 per item"). Each line's unit price, in CHF,
// against the limit, with the same small-overshoot band as the per-order limit.
// Per NIGHT: the order total divided by the number of nights (from the instruction, else the shop's clean text).
// Nights unknown: UNCERTAIN, never a pass.
import { toChf } from "../../../shared/src/fxRates";
import type { Evidence } from "../../../shared/src/types";
import type { Facts, Guard, GuardResult } from "../types";
import { chf, limitBand } from "./limitBand";

const NIGHTS_IN_TEXT = /\b(\d{1,2})[-\s]nights?\b/i;

function perNight(auth: Facts["auth"], policy: Facts["policy"], shop: Facts["shop"], limit: { amountChf: number; unit: string }): GuardResult {
  let nights = policy.stayNights;
  let source = "instruction";
  if (nights === null) {
    for (const i of auth.items) {
      const texts = [i.item_name, ...(shop.lines.find((l) => l.line_no === i.line_no)?.clean ?? [])];
      const hit = texts.map((t) => t.match(NIGHTS_IN_TEXT)).find(Boolean);
      if (hit) {
        nights = Number(hit[1]);
        source = `items[${i.line_no}]`;
        break;
      }
    }
  }
  if (!nights) {
    return {
      guard: "per_unit_limit",
      verdict: "UNCERTAIN",
      reason_code: "missing_info",
      evidence: [{ fact: "nights", value: null, comparator: ">", threshold: 0, source: "instruction, items[].item_details" }],
      message: `We cannot tell how many nights this booking of ${chf(auth.billing_amount_chf)} covers, so we cannot check your limit of ${chf(limit.amountChf)} per night.`,
    };
  }
  const perNightChf = Math.round((auth.billing_amount_chf / nights) * 100) / 100;
  const verdict = limitBand(perNightChf, limit.amountChf, policy.overshootTolerance);
  const evidence: Evidence[] = [
    { fact: "total_per_night_chf", value: perNightChf, comparator: "<=", threshold: limit.amountChf, source: `authorization.billing_amount_chf / ${nights} nights (${source})` },
  ];
  if (verdict === "PASS") return { guard: "per_unit_limit", verdict, evidence };
  return {
    guard: "per_unit_limit",
    verdict,
    reason_code: "over_unit_limit",
    evidence,
    message:
      verdict === "STEP_UP"
        ? `${chf(auth.billing_amount_chf)} for ${nights} nights is ${chf(perNightChf)} per night, a little above your limit of ${chf(limit.amountChf)}. Approve anyway?`
        : `${chf(auth.billing_amount_chf)} for ${nights} nights is ${chf(perNightChf)} per night. Your limit is ${chf(limit.amountChf)} per night.`,
  };
}

export const perUnitLimit: Guard = ({ auth, policy, shop }) => {
  const limit = policy.perUnitLimit;
  if (!limit) return { guard: "per_unit_limit", verdict: "SKIP", evidence: [] };
  if (limit.unit === "night") return perNight(auth, policy, shop, limit);

  const lines = auth.items.map((i) => ({ i, unitChf: toChf(i.unit_price, i.currency) }));
  const evidence: Evidence[] = lines.map(({ i, unitChf }) => ({
    fact: `unit_price_chf_per_${limit.unit}`,
    value: unitChf,
    comparator: "<=",
    threshold: limit.amountChf,
    source: `items[${i.line_no}].unit_price`,
  }));
  const rank = { PASS: 0, STEP_UP: 1, DECLINE: 2 } as const;
  let worst: { i: (typeof lines)[number]["i"]; unitChf: number; verdict: "PASS" | "STEP_UP" | "DECLINE" } | null = null;
  for (const l of lines) {
    const verdict = limitBand(l.unitChf, limit.amountChf, policy.overshootTolerance) as "PASS" | "STEP_UP" | "DECLINE";
    if (!worst || rank[verdict] > rank[worst.verdict]) worst = { ...l, verdict };
  }
  if (!worst || worst.verdict === "PASS") return { guard: "per_unit_limit", verdict: "PASS", evidence };
  return {
    guard: "per_unit_limit",
    verdict: worst.verdict,
    reason_code: "over_unit_limit",
    evidence,
    message:
      worst.verdict === "STEP_UP"
        ? `"${worst.i.item_name}" costs ${chf(worst.unitChf)} per ${limit.unit}, a little above your limit of ${chf(limit.amountChf)}. Approve anyway?`
        : `"${worst.i.item_name}" costs ${chf(worst.unitChf)} per ${limit.unit}. Your limit is ${chf(limit.amountChf)} per ${limit.unit}.`,
  };
};
