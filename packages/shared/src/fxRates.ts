// Fixed synthetic FX rates from data/fx_rates.csv.
// Use the ROW's currency, never the shop's country.
// billing_amount_chf already includes delivery: never add delivery again.
import { readCsv } from "./loaders";

let rates: Map<string, number> | null = null;

export function fxRate(currency: string): number {
  if (!rates) {
    rates = new Map(readCsv("fx_rates.csv").map((r) => [r.from_currency, Number(r.rate)]));
  }
  const rate = rates.get(currency);
  if (rate === undefined) throw new Error(`Unknown currency: ${currency}`);
  return rate;
}

/** Converts to CHF, rounded to 2 decimals. */
export function toChf(amount: number, currency: string): number {
  return Math.round(amount * fxRate(currency) * 100) / 100;
}
