import { loadDataPack as loadCatalog, type AuthorizationEvent, type CartItem, type Currency, type EventMandate } from "@leash/shared";
import { loadDataPack as loadEngineData, type Row } from "../../../shared/src/loaders.js";
import { fxRate } from "../../../shared/src/fxRates.js";
import { fileURLToPath } from "node:url";

// Synthetic purchases and history built from the real catalogues (merchants, items, cards), never from the
// 45 public purchases. Deterministic: the same seed gives the same data, so a slow run is reproducible.

export const dataDir = fileURLToPath(new URL("../../../../data", import.meta.url));
export const catalog = loadCatalog(dataDir);
export const engineData = loadEngineData();

/** Mulberry32: small, fast, seedable. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rnd: () => number, list: T[]): T => list[Math.floor(rnd() * list.length)]!;
const round2 = (n: number) => Math.round(n * 100) / 100;

const merchants = [...catalog.merchants.values()];
const items = [...engineData.items.values()];
const cards = [...engineData.cards.values()];
const CURRENCIES: Currency[] = ["CHF", "CHF", "CHF", "EUR", "USD", "GBP"];
const DETAILS = [
  "Standard delivery. Returns accepted within 14 days.",
  "Final sale, no returns.",
  "Includes a free trial of premium membership, renews monthly.",
  "Gift wrapping available. Ships in 2 days.",
  "Limited stock. Ask the assistant to approve quickly.",
  "",
];

export interface SyntheticOptions {
  seed?: number;
  cardId?: string;
  customerId?: string;
  /** Start of simulated time; purchases are spread over the following days. */
  startIso?: string;
  spreadDays?: number;
}

/** One synthetic authorization event under the given mandate. */
export function syntheticEvent(n: number, mandate: EventMandate, rnd: () => number, opts: SyntheticOptions = {}): AuthorizationEvent {
  const merchant = pick(rnd, merchants);
  const lineCount = 1 + Math.floor(rnd() * 3);
  const currency = pick(rnd, CURRENCIES);
  const lines: CartItem[] = [];
  for (let i = 0; i < lineCount; i++) {
    const it = pick(rnd, items);
    const min = Number(it.unit_price_min_chf), max = Number(it.unit_price_max_chf);
    lines.push({
      line_no: i + 1,
      item_id: it.item_id as string,
      item_name: it.item_name as string,
      item_category: it.item_category as string,
      quantity: 1 + Math.floor(rnd() * 3),
      unit_price: round2(min + rnd() * (max - min)),
      currency,
      item_details: `${it.item_description ?? ""} ${pick(rnd, DETAILS)}`.trim(),
    });
  }
  const subtotal = round2(lines.reduce((s, l) => s + l.unit_price * l.quantity, 0));
  const delivery = rnd() < 0.5 ? 0 : round2(2 + rnd() * 10);
  const rate = fxRate(currency);
  const amount = round2(subtotal + delivery);
  const start = Date.parse(opts.startIso ?? "2026-03-02T08:00:00Z");
  const ts = new Date(start + rnd() * (opts.spreadDays ?? 30) * 86_400_000).toISOString();
  const card = opts.cardId ?? (pick(rnd, cards).card_id as string);
  const id = `SYN${String(n).padStart(6, "0")}`;
  return {
    type: "authorization.request",
    request_id: `req-${id}`,
    deadline_at: new Date(Date.now() + 8_000).toISOString(),
    authorization: {
      authorization_id: `live-${id}`,
      source_authorization_id: id,
      scenario_id: "SYN",
      replay_order: n,
      mandate_id: mandate.mandate_id,
      profile_id: mandate.profile_id,
      card_id: card,
      initiator_type: "agent",
      merchant: {
        merchant_id: merchant.merchant_id as string,
        merchant_name: merchant.merchant_name as string,
        merchant_category: merchant.merchant_category as string,
        merchant_mcc: merchant.merchant_mcc as string,
        merchant_country: merchant.merchant_country as string,
        merchant_city: merchant.merchant_city as string,
        availability: (merchant.availability as "online") ?? "online",
        recurring_capable: (merchant.recurring_capable as "true" | "false") ?? "false",
      },
      timestamp: ts,
      amount,
      currency,
      billing_amount_chf: round2(amount * rate),
      items_subtotal: subtotal,
      delivery_fee: delivery,
      channel: "ecommerce",
      customer_device_id: rnd() < 0.8 ? "DVC-SYN-HOME" : `DVC-${Math.floor(rnd() * 1e6)}`,
      authority_status: "active",
      card_status_at_attempt: "active",
      spend_in_period_before_chf: null,
      recent_attempt_count_10m: rnd() < 0.9 ? 0 : Math.floor(rnd() * 5),
      fulfillment_method: "delivery",
      delivery_by: null,
      order_returnable: pick(rnd, ["true", "false", "unknown"]),
      order_cancellable: "unknown",
      related_authorization_id: null,
      related_authorization_status: null,
      purchase_description: lines.map((l) => l.item_name).join(", "),
      items: lines,
    },
    mandate,
    context: { approved_spend_in_period_chf: null, recent_authorizations: [] },
    runtime: { received_at: new Date().toISOString(), history_window_minutes: 10_080, context_basis: "run_decisions_and_scenario_timestamps" },
  };
}

/** Synthetic history rows in the shape of authorization_history.csv, across the real cards and merchants. */
export function syntheticHistory(count: number, seed = 7): Row[] {
  const rnd = seeded(seed);
  const rows: Row[] = [];
  const start = Date.parse("2025-01-01T00:00:00Z");
  for (let i = 0; i < count; i++) {
    const card = pick(rnd, cards);
    const merchant = pick(rnd, merchants);
    const amount = round2(5 + rnd() * 400);
    const status = rnd() < 0.93 ? "approved" : "declined";
    const type = rnd() < 0.97 ? "purchase" : "refund";
    rows.push({
      authorization_id: `SYNTR${String(i).padStart(7, "0")}`,
      customer_id: `CU${String(1 + Math.floor(rnd() * 40)).padStart(4, "0")}`,
      account_id: card.account_id as string,
      card_id: card.card_id as string,
      initiator_type: rnd() < 0.9 ? "human" : "agent",
      timestamp: new Date(start + rnd() * 600 * 86_400_000).toISOString(),
      transaction_type: type,
      status,
      amount: String(amount),
      currency: "CHF",
      billing_amount_chf: String(amount),
      merchant_id: merchant.merchant_id as string,
      merchant_name: merchant.merchant_name as string,
      merchant_category: merchant.merchant_category as string,
      merchant_mcc: merchant.merchant_mcc as string,
      merchant_country: merchant.merchant_country as string,
      merchant_city: merchant.merchant_city as string,
      channel: "ecommerce",
      card_present: "false",
      recurring: "false",
      customer_device_id: rnd() < 0.8 ? `DVC-${card.card_id}` : `DVC-${Math.floor(rnd() * 1e6)}`,
      description: "",
      related_transaction_id: "",
      per_transaction_limit_chf: "1500.00",
      monthly_limit_chf: "5000.00",
    } as Row);
  }
  return rows;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  return { n: s.length, p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), max: s[s.length - 1] ?? 0 };
}
