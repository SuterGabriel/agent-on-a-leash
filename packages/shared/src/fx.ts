import type { Currency } from "./event.js";

/** Decimal half-even rounding to 2 places, as the data dictionary prescribes. */
export function roundHalfEven2(value: number): number {
  const scaled = value * 100;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const EPS = 1e-9;
  let rounded: number;
  if (Math.abs(diff - 0.5) < EPS) rounded = floor % 2 === 0 ? floor : floor + 1;
  else rounded = Math.round(scaled);
  return rounded / 100;
}

export type FxTable = Record<Currency, number>;

/** Convert using the row's currency, never the shop's country. */
export function toChf(amount: number, currency: Currency, fx: FxTable): number {
  const rate = fx[currency];
  if (rate === undefined) throw new Error(`fx: no rate for ${currency}`);
  return roundHalfEven2(amount * rate);
}
