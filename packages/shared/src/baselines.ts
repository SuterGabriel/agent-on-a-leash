// What "normal" looks like, computed once from authorization_history.csv.
// Only APPROVED PURCHASES count. Historical status is context, not an answer key.
import type { Row } from "./loaders";

export interface CardBaseline {
  purchases: number;
  merchants: Map<string, number>; // merchant_id -> approved purchases on this card
  devices: Map<string, number>;
  hours: Map<number, number>; // Swiss local hour -> approved purchases
  countries: Map<string, number>;
}

export interface Baselines {
  cards: Map<string, CardBaseline>;
  customerMerchants: Map<string, Map<string, number>>; // customer -> merchant -> count (all cards)
  cardCustomer: Map<string, string>;
  issuerMerchants: Map<string, number>; // merchant -> approved purchases across ALL customers
  merchantNames: Map<string, { name: string; category: string }>;
}

const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", hourCycle: "h23" });

/** Hour of day in Swiss local time (handles summer/winter time). */
export function swissHour(iso: string): number {
  return Number(hourFmt.format(new Date(iso)));
}

const inc = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

export function buildBaselines(history: Row[], merchants: Map<string, Row>): Baselines {
  const cards = new Map<string, CardBaseline>();
  const customerMerchants = new Map<string, Map<string, number>>();
  const cardCustomer = new Map<string, string>();
  const issuerMerchants = new Map<string, number>();

  for (const r of history) {
    cardCustomer.set(r.card_id, r.customer_id);
    if (r.transaction_type !== "purchase" || r.status !== "approved") continue;

    let c = cards.get(r.card_id);
    if (!c) {
      c = { purchases: 0, merchants: new Map(), devices: new Map(), hours: new Map(), countries: new Map() };
      cards.set(r.card_id, c);
    }
    c.purchases++;
    inc(c.merchants, r.merchant_id);
    if (r.customer_device_id) inc(c.devices, r.customer_device_id);
    // Scheduled recurring payments run by themselves at any hour: they say nothing about when the customer shops.
    if (r.recurring !== "true") inc(c.hours, swissHour(r.timestamp));
    inc(c.countries, r.merchant_country);

    const cm = customerMerchants.get(r.customer_id) ?? new Map<string, number>();
    inc(cm, r.merchant_id);
    customerMerchants.set(r.customer_id, cm);

    inc(issuerMerchants, r.merchant_id);
  }

  const merchantNames = new Map(
    [...merchants.values()].map((m) => [m.merchant_id, { name: m.merchant_name, category: m.merchant_category }]),
  );
  return { cards, customerMerchants, cardCustomer, issuerMerchants, merchantNames };
}

export const EMPTY_CARD: CardBaseline = {
  purchases: 0,
  merchants: new Map(),
  devices: new Map(),
  hours: new Map(),
  countries: new Map(),
};
