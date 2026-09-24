import type { Verdict } from "../types";

/** <= limit: PASS. <= limit * (1 + tolerance): STEP_UP. Above: DECLINE. */
export function limitBand(value: number, limit: number, tolerance: number): Verdict {
  const v = Math.round(value * 100);
  const l = Math.round(limit * 100);
  if (v <= l) return "PASS";
  if (v <= Math.round(l * (1 + tolerance))) return "STEP_UP";
  return "DECLINE";
}

export const chf = (n: number) => `CHF ${n.toFixed(2)}`;
export const pct = (value: number, limit: number) => `${(((value - limit) / limit) * 100).toFixed(1)} %`;
