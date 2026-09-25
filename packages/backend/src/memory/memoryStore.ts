import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { emptyMemory, type LearnedLookup, type LearnedMemory } from "../../../shared/src/memory.js";

// What each customer taught us, across runs and restarts. One JSON file, written atomically (tmp + rename).
// Only the customer's own answers write it: an approved ask, "Yes, it was me", "Not me", a block. A decline never
// teaches that a shop is known. The engine reads it through LearnedLookup; the app shows it on 6.3 and can forget.

export interface MemoryPurchase {
  id: string;
  customer_id?: string | null;
  card_id?: string | null;
  device_id?: string | null;
  merchant: { id: string; name: string; country: string };
  purchased_at: string;
}

interface ShopRec {
  name: string;
  count: number;
  first_at: string;
  last_at: string;
  source: "approved" | "was_me";
  decisions: string[];
}
interface DeviceRec {
  count: number;
  first_at: string;
  last_at: string;
  trusted: boolean;
  decisions: string[];
}
interface CustomerRec {
  customer_id: string | null;
  cards: string[];
  shops: Record<string, ShopRec>;
  devices: Record<string, DeviceRec>;
  countries: Record<string, number>;
  hours: Record<string, number>;
  blocked: Record<string, { name: string; at: string }>;
  updated_at: string;
}
interface MemoryFile {
  version: 1;
  customers: Record<string, CustomerRec>;
}

/** The customer's memory as the app shows it (GET /v4/app/memory). */
export interface MemoryView {
  key: string;
  shops: { merchant_id: string; name: string; times: number; last_at: string; source: "approved" | "was_me" }[];
  devices: { device_id: string; times: number; last_at: string; trusted: boolean }[];
  countries: { country: string; times: number }[];
  hours: { hour: number; times: number }[];
  blocked_shops: { merchant_id: string; name: string; at: string }[];
}

const MAX_DECISIONS_KEPT = 20;

const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", hourCycle: "h23" });
const swissHour = (iso: string) => Number(hourFmt.format(new Date(iso)));

export class MemoryStore {
  private data: MemoryFile = { version: 1, customers: {} };
  private cache = new Map<string, LearnedMemory>();
  private readonly file: string | null;
  private readonly log: (line: string) => void;

  /** `file` null = in memory only (tests, LEASH_MEMORY_FILE=off). A corrupt file is moved aside, never trusted. */
  constructor(opts: { file?: string | null; log?: (line: string) => void } = {}) {
    this.file = opts.file ?? null;
    this.log = opts.log ?? (() => {});
    if (this.file && existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, "utf8")) as MemoryFile;
        if (parsed.version !== 1 || typeof parsed.customers !== "object") throw new Error(`unknown memory version ${String(parsed.version)}`);
        this.data = parsed;
        this.log(`memory: ${Object.keys(parsed.customers).length} customer(s) loaded from ${this.file}`);
      } catch (err) {
        const aside = `${this.file}.corrupt-${Date.now()}`;
        renameSync(this.file, aside);
        this.log(`memory: could not read ${this.file} (${(err as Error).message}); moved to ${aside}, starting empty`);
      }
    }
  }

  /** One customer per customer id; a card without a known customer is its own key. */
  static key(customerId: string | null | undefined, cardId: string | null | undefined): string | null {
    if (customerId) return customerId;
    if (cardId) return `card:${cardId}`;
    return null;
  }

  private rec(key: string, customerId: string | null, cardId: string | null): CustomerRec {
    let r = this.data.customers[key];
    if (!r) {
      r = { customer_id: customerId, cards: [], shops: {}, devices: {}, countries: {}, hours: {}, blocked: {}, updated_at: new Date().toISOString() };
      this.data.customers[key] = r;
    }
    if (cardId && !r.cards.includes(cardId)) r.cards.push(cardId);
    return r;
  }

  private touched(key: string, r: CustomerRec) {
    r.updated_at = new Date().toISOString();
    this.cache.delete(key);
    this.save();
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  private keyOf(p: MemoryPurchase): string | null {
    return MemoryStore.key(p.customer_id, p.card_id);
  }

  private remember(r: CustomerRec, p: MemoryPurchase, source: ShopRec["source"]) {
    const at = p.purchased_at;
    const shop = r.shops[p.merchant.id];
    r.shops[p.merchant.id] = shop
      ? { ...shop, name: p.merchant.name, count: shop.count + 1, last_at: at, decisions: [...shop.decisions, p.id].slice(-MAX_DECISIONS_KEPT) }
      : { name: p.merchant.name, count: 1, first_at: at, last_at: at, source, decisions: [p.id] };
    if (p.device_id) {
      const dev = r.devices[p.device_id];
      r.devices[p.device_id] = dev
        ? { ...dev, count: dev.count + 1, last_at: at, trusted: true, decisions: [...dev.decisions, p.id].slice(-MAX_DECISIONS_KEPT) }
        : { count: 1, first_at: at, last_at: at, trusted: true, decisions: [p.id] };
    }
    if (p.merchant.country) r.countries[p.merchant.country] = (r.countries[p.merchant.country] ?? 0) + 1;
    const hour = swissHour(at);
    if (!Number.isNaN(hour)) r.hours[String(hour)] = (r.hours[String(hour)] ?? 0) + 1;
  }

  /** The customer approved an ask: the shop, the device, the country and the hour are theirs from now on. */
  learnFromApproval(p: MemoryPurchase): boolean {
    const key = this.keyOf(p);
    if (!key) return false;
    const r = this.rec(key, p.customer_id ?? null, p.card_id ?? null);
    this.remember(r, p, "approved");
    this.touched(key, r);
    return true;
  }

  /** "Yes, it was me": same as an approval, even for a purchase that was stopped. */
  confirmWasMe(p: MemoryPurchase): boolean {
    const key = this.keyOf(p);
    if (!key) return false;
    const r = this.rec(key, p.customer_id ?? null, p.card_id ?? null);
    this.remember(r, p, "was_me");
    this.touched(key, r);
    return true;
  }

  /** "Not me": the device is never trusted again (until the customer forgets it). Nothing else is learned. */
  denyWasMe(p: MemoryPurchase): boolean {
    const key = this.keyOf(p);
    if (!key || !p.device_id) return false;
    const r = this.rec(key, p.customer_id ?? null, p.card_id ?? null);
    const dev = r.devices[p.device_id];
    r.devices[p.device_id] = { count: dev?.count ?? 0, first_at: dev?.first_at ?? p.purchased_at, last_at: p.purchased_at, trusted: false, decisions: [...(dev?.decisions ?? []), p.id].slice(-MAX_DECISIONS_KEPT) };
    this.touched(key, r);
    return true;
  }

  block(customerId: string | null, cardId: string | null, merchant: { id: string; name: string }) {
    const key = MemoryStore.key(customerId, cardId);
    if (!key) return;
    const r = this.rec(key, customerId, cardId);
    r.blocked[merchant.id] = { name: merchant.name, at: new Date().toISOString() };
    this.touched(key, r);
  }

  unblock(customerId: string | null, cardId: string | null, merchantId: string): boolean {
    const key = MemoryStore.key(customerId, cardId);
    const r = key ? this.data.customers[key] : undefined;
    if (!key || !r || !r.blocked[merchantId]) return false;
    delete r.blocked[merchantId];
    this.touched(key, r);
    return true;
  }

  forgetShop(customerId: string | null, cardId: string | null, merchantId: string): boolean {
    const key = MemoryStore.key(customerId, cardId);
    const r = key ? this.data.customers[key] : undefined;
    if (!key || !r || !r.shops[merchantId]) return false;
    delete r.shops[merchantId];
    this.touched(key, r);
    return true;
  }

  forgetDevice(customerId: string | null, cardId: string | null, deviceId: string): boolean {
    const key = MemoryStore.key(customerId, cardId);
    const r = key ? this.data.customers[key] : undefined;
    if (!key || !r || !r.devices[deviceId]) return false;
    delete r.devices[deviceId];
    this.touched(key, r);
    return true;
  }

  /** What the engine reads. Customer memory, falling back to the card's own key. */
  readonly lookup: LearnedLookup = (customerId, cardId) => {
    const key = MemoryStore.key(customerId, cardId);
    if (!key) return null;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const r = this.data.customers[key] ?? (customerId ? this.data.customers[`card:${cardId}`] : undefined);
    if (!r) return null;
    const m = emptyMemory();
    for (const [id, s] of Object.entries(r.shops)) m.shops.set(id, { name: s.name, count: s.count, last_at: s.last_at });
    for (const [id, d] of Object.entries(r.devices)) {
      if (d.trusted) m.devices.set(id, { count: d.count, last_at: d.last_at });
      else m.untrustedDevices.add(id);
    }
    for (const [c, n] of Object.entries(r.countries)) m.countries.set(c, n);
    for (const [h, n] of Object.entries(r.hours)) m.hours.set(Number(h), n);
    for (const [id, b] of Object.entries(r.blocked)) m.blockedShops.set(id, b.name);
    this.cache.set(key, m);
    return m;
  };

  view(customerId: string | null, cardId: string | null): MemoryView {
    const key = MemoryStore.key(customerId, cardId) ?? "none";
    const r = this.data.customers[key];
    return {
      key,
      shops: Object.entries(r?.shops ?? {})
        .map(([merchant_id, s]) => ({ merchant_id, name: s.name, times: s.count, last_at: s.last_at, source: s.source }))
        .sort((a, b) => b.last_at.localeCompare(a.last_at)),
      devices: Object.entries(r?.devices ?? {})
        .map(([device_id, d]) => ({ device_id, times: d.count, last_at: d.last_at, trusted: d.trusted }))
        .sort((a, b) => b.last_at.localeCompare(a.last_at)),
      countries: Object.entries(r?.countries ?? {}).map(([country, times]) => ({ country, times })),
      hours: Object.entries(r?.hours ?? {}).map(([hour, times]) => ({ hour: Number(hour), times })).sort((a, b) => a.hour - b.hour),
      blocked_shops: Object.entries(r?.blocked ?? {}).map(([merchant_id, b]) => ({ merchant_id, name: b.name, at: b.at })),
    };
  }

  /** Every customer key with something learned (live-review and reports). */
  keys(): string[] {
    return Object.keys(this.data.customers);
  }
}
