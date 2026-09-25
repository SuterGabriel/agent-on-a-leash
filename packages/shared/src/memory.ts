// What the engine may read about a customer beyond the issuer's history: what the customer taught us (memory) and
// what customers like them do (peers). The backend owns both (a JSON file, the reference data); the engine only reads.
// Rule of thumb, enforced in the guards: memory can turn an ask into a pass (the customer said so), peers never can.

/** What the customer confirmed or refused, across runs. Only the customer's own answers write it. */
export interface LearnedMemory {
  /** Shops the customer approved or confirmed: merchant_id → name, times, last time. */
  shops: Map<string, { name: string; count: number; last_at: string }>;
  /** Devices the customer vouched for ("Yes, it was me" or an approved ask from that device). */
  devices: Map<string, { count: number; last_at: string }>;
  /** Devices the customer said were not them. Never trusted again until the customer forgets it. */
  untrustedDevices: Set<string>;
  /** Countries and Swiss local hours of purchases the customer vouched for. */
  countries: Map<string, number>;
  hours: Map<number, number>;
  /** Shops the customer blocked: merchant_id → name. Enforced by the engine even if the mandate is re-created. */
  blockedShops: Map<string, string>;
}

/** Customers like this one (nearest neighbours by profile), for a customer with little or no history. */
export interface PeerPrior {
  /** The neighbours and why they are neighbours ("same budget style, similar limits"). */
  neighbours: { customer_id: string; score: number; why: string[] }[];
  /** Typical ticket and month of the neighbours, in CHF. */
  ticket_p50: number;
  ticket_p90: number;
  month_p50: number;
  /** Merchant categories by share of the neighbours' spend (0–1). */
  categories: { category: string; share: number }[];
  /** Swiss local hours and countries where the neighbours shop (at least two neighbours). */
  hours: Set<number>;
  countries: Set<string>;
  /** Shops several neighbours use: merchant_id → name and how many of the neighbours. */
  shops: Map<string, { name: string; neighbours: number }>;
}

export type LearnedLookup = (customerId: string | null, cardId: string) => LearnedMemory | null;
export type PeerLookup = (customerId: string | null, cardId: string) => PeerPrior | null;

export const emptyMemory = (): LearnedMemory => ({
  shops: new Map(),
  devices: new Map(),
  untrustedDevices: new Set(),
  countries: new Map(),
  hours: new Map(),
  blockedShops: new Map(),
});
