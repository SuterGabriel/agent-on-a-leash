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
  customers: Map<string, CardBaseline>; // the same habits, over ALL cards of a customer (for cards with little history)
  issuerMerchants: Map<string, number>; // merchant -> approved purchases across ALL customers
  issuerRefunds: Map<string, number>; // merchant -> refunds across ALL customers (shop track record, display only)
  cardLimits: Map<string, CardLimits>; // card -> limits of the account behind it
  merchantNames: Map<string, { name: string; category: string }>;
}

export interface CardLimits {
  accountId: string;
  perTransactionChf: number;
  monthlyChf: number | null;
}

const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", hourCycle: "h23" });

/** Hour of day in Swiss local time (handles summer/winter time). */
export function swissHour(iso: string): number {
  return Number(hourFmt.format(new Date(iso)));
}

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", weekday: "short" });
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Calendar date in Swiss local time, "2026-09-24". */
export function swissDate(ms: number): string {
  return dateFmt.format(new Date(ms));
}

/** Weekday in Swiss local time, 0 = Sunday … 6 = Saturday. */
export function swissWeekday(ms: number): number {
  return WEEKDAY_INDEX[weekdayFmt.format(new Date(ms))] ?? -1;
}

const emptyBaseline = (): CardBaseline => ({ purchases: 0, merchants: new Map(), devices: new Map(), hours: new Map(), countries: new Map() });

const inc = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

/** `catalog`: the card and account tables (data pack or live reference data); they win over the history rows. */
export function buildBaselines(history: Row[], merchants: Map<string, Row>, catalog?: { cards: Iterable<Row>; accounts: Iterable<Row> }): Baselines {
  const cards = new Map<string, CardBaseline>();
  const customerMerchants = new Map<string, Map<string, number>>();
  const cardCustomer = new Map<string, string>();
  const issuerMerchants = new Map<string, number>();
  const issuerRefunds = new Map<string, number>();
  const customers = new Map<string, CardBaseline>();

  for (const r of history) {
    cardCustomer.set(r.card_id, r.customer_id);
    if (r.transaction_type === "refund" && r.status === "approved") inc(issuerRefunds, r.merchant_id);
    if (r.transaction_type !== "purchase" || r.status !== "approved") continue;

    let c = cards.get(r.card_id);
    if (!c) {
      c = emptyBaseline();
      cards.set(r.card_id, c);
    }
    let cu = customers.get(r.customer_id);
    if (!cu) {
      cu = emptyBaseline();
      customers.set(r.customer_id, cu);
    }
    for (const b of [c, cu]) {
      b.purchases++;
      inc(b.merchants, r.merchant_id);
      if (r.customer_device_id) inc(b.devices, r.customer_device_id);
      // Scheduled recurring payments run by themselves at any hour: they say nothing about when the customer shops.
      if (r.recurring !== "true") inc(b.hours, swissHour(r.timestamp));
      inc(b.countries, r.merchant_country);
    }

    const cm = customerMerchants.get(r.customer_id) ?? new Map<string, number>();
    inc(cm, r.merchant_id);
    customerMerchants.set(r.customer_id, cm);

    inc(issuerMerchants, r.merchant_id);
  }

  const merchantNames = new Map(
    [...merchants.values()].map((m) => [m.merchant_id, { name: m.merchant_name, category: m.merchant_category }]),
  );
  // History rows name their shop too. They fill in shops missing from the merchant table; the table wins.
  for (const r of history) {
    if (r.merchant_id && r.merchant_name && !merchantNames.has(r.merchant_id)) {
      merchantNames.set(r.merchant_id, { name: r.merchant_name, category: r.merchant_category ?? "" });
    }
  }
  const cardLimits = new Map<string, CardLimits>();
  const limitsFrom = (accountId: string, per: string | undefined, monthly: string | undefined): CardLimits | null =>
    per && Number.isFinite(Number(per)) ? { accountId, perTransactionChf: Number(per), monthlyChf: monthly ? Number(monthly) : null } : null;
  for (const r of history) {
    const l = limitsFrom(r.account_id, r.per_transaction_limit_chf, r.monthly_limit_chf);
    if (r.card_id && l) cardLimits.set(r.card_id, l);
  }
  if (catalog) {
    const accounts = new Map([...catalog.accounts].map((a) => [a.account_id, a]));
    for (const c of catalog.cards) {
      const a = accounts.get(c.account_id);
      const l = a ? limitsFrom(a.account_id, a.per_transaction_limit_chf, a.monthly_limit_chf) : null;
      if (l) cardLimits.set(c.card_id, l);
    }
  }
  return { cards, customerMerchants, cardCustomer, customers, issuerMerchants, issuerRefunds, merchantNames, cardLimits };
}

export const EMPTY_CARD: CardBaseline = {
  purchases: 0,
  merchants: new Map(),
  devices: new Map(),
  hours: new Map(),
  countries: new Map(),
};
