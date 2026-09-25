import type { PeerLookup, PeerPrior } from "../../../shared/src/memory.js";
import { readProfileByKeywords, type ProfileSignals } from "./profileSignals.js";

// Cold start: a customer with no history is compared with the customers who have one (nearest neighbours by
// profile). From the neighbours we predict what the new customer will probably buy (categories, ticket size,
// hours, countries, shops) and say so as evidence: "customers like you". Rules, enforced in the guards and here:
// - peers never make a shop "known" and never approve anything; only the customer's own answers (memory) can;
// - peers can make an ask more useful (what to expect) and power the suggestions on 1.3 for a new card.

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface PeerSources {
  customers: Row[];
  accounts: Row[];
  cards: Row[];
  /** Authorization history rows (only approved purchases are used). */
  history: Row[];
  /** Profile signals per customer (Apertus or keywords). Missing ones are read by keywords. */
  signals?: Map<string, ProfileSignals>;
}

interface Profile {
  customer_id: string;
  budget_style: string;
  region: string;
  account_purpose: string;
  account_type: string;
  per_tx: number | null;
  monthly: number | null;
  card_flags: string;
  signals: ProfileSignals;
}

interface Behaviour {
  purchases: number;
  tickets: number[];
  months: Map<string, number>;
  categories: Map<string, number>;
  hours: Set<number>;
  countries: Set<string>;
  shops: Map<string, string>;
}

export interface Neighbour {
  customer_id: string;
  score: number;
  why: string[];
}

export interface CategoryPrediction {
  category: string;
  /** 0–1: share of the neighbours' spend, lifted when the customer's own text names it. */
  confidence: number;
  from: ("your profile" | "customers like you")[];
}

export interface ColdStartInsight {
  customer_id: string;
  signals: ProfileSignals;
  neighbours: Neighbour[];
  predicted_categories: CategoryPrediction[];
  prior: PeerPrior | null;
}

const K = 5;
const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", hourCycle: "h23" });
const monthFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit" });
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] ?? 0;
};
const logClose = (a: number | null, b: number | null) => (a && b ? Math.max(0, 1 - Math.abs(Math.log(a) - Math.log(b)) / Math.log(10)) : 0);

export class PeerIndex {
  private profiles = new Map<string, Profile>();
  private behaviour = new Map<string, Behaviour>();
  private cardCustomer = new Map<string, string>();
  private cache = new Map<string, ColdStartInsight | null>();

  constructor(src: PeerSources) {
    const accountsById = new Map(src.accounts.map((a) => [str(a.account_id), a]));
    const cardsByCustomer = new Map<string, Row[]>();
    for (const c of src.cards) {
      const acc = accountsById.get(str(c.account_id));
      const cust = str(acc?.customer_id);
      if (!cust) continue;
      this.cardCustomer.set(str(c.card_id), cust);
      cardsByCustomer.set(cust, [...(cardsByCustomer.get(cust) ?? []), c]);
    }
    for (const c of src.customers) {
      const id = str(c.customer_id);
      const acc = src.accounts.find((a) => str(a.customer_id) === id);
      const card = cardsByCustomer.get(id)?.[0];
      const text = { background: str(c.background), shopping_preferences: str(c.shopping_preferences), typical_spending: str(c.typical_spending), travel_pattern: str(c.travel_pattern), budget_style: str(c.budget_style) };
      this.profiles.set(id, {
        customer_id: id,
        budget_style: str(c.budget_style),
        region: str(c.home_region),
        account_purpose: str(acc?.account_purpose),
        account_type: str(acc?.account_type),
        per_tx: num(acc?.per_transaction_limit_chf),
        monthly: num(acc?.monthly_limit_chf),
        card_flags: card ? [card.online_enabled, card.international_enabled, card.virtual_card].map(str).join("|") : "",
        signals: src.signals?.get(id) ?? readProfileByKeywords(text),
      });
    }
    for (const r of src.history) {
      if (str(r.transaction_type) !== "purchase" || str(r.status) !== "approved") continue;
      const id = str(r.customer_id);
      if (!id) continue;
      this.cardCustomer.set(str(r.card_id), id);
      let b = this.behaviour.get(id);
      if (!b) {
        b = { purchases: 0, tickets: [], months: new Map(), categories: new Map(), hours: new Set(), countries: new Set(), shops: new Map() };
        this.behaviour.set(id, b);
      }
      const chf = num(r.billing_amount_chf) ?? 0;
      const t = new Date(str(r.timestamp));
      b.purchases += 1;
      b.tickets.push(chf);
      const month = Number.isNaN(t.getTime()) ? "" : monthFmt.format(t);
      b.months.set(month, (b.months.get(month) ?? 0) + chf);
      const cat = str(r.merchant_category) || "other";
      b.categories.set(cat, (b.categories.get(cat) ?? 0) + chf);
      if (!Number.isNaN(t.getTime()) && str(r.recurring) !== "true") b.hours.add(Number(hourFmt.format(t)));
      if (str(r.merchant_country)) b.countries.add(str(r.merchant_country));
      b.shops.set(str(r.merchant_id), str(r.merchant_name));
    }
  }

  /** Customers with at least this many approved purchases are neighbours; a customer below it gets a cold start. */
  static readonly MIN_HISTORY = 10;

  hasHistory(customerId: string): boolean {
    return (this.behaviour.get(customerId)?.purchases ?? 0) >= PeerIndex.MIN_HISTORY;
  }

  customerOfCard(cardId: string): string | undefined {
    return this.cardCustomer.get(cardId);
  }

  /** Replace a customer's signals (the Apertus reader, when it answers). Clears cached insights. */
  setSignals(customerId: string, signals: ProfileSignals) {
    const p = this.profiles.get(customerId);
    if (!p) return;
    p.signals = signals;
    this.cache.clear();
  }

  private similarity(a: Profile, b: Profile, bb: Behaviour): { score: number; why: string[] } {
    const why: string[] = [];
    let score = 0;
    if (a.budget_style && a.budget_style === b.budget_style) {
      score += 0.2;
      why.push(`same budget style (${a.budget_style})`);
    }
    if (a.region && a.region === b.region) {
      score += 0.1;
      why.push(`same region (${a.region})`);
    }
    const limits = (logClose(a.per_tx, b.per_tx) + logClose(a.monthly, b.monthly)) / 2;
    score += 0.2 * limits;
    if (limits > 0.8) why.push("similar card limits");
    if (a.account_purpose && a.account_purpose === b.account_purpose) score += 0.05;
    if (a.card_flags && a.card_flags === b.card_flags) score += 0.05;
    // The new customer's own words against how the neighbour really shops: the strongest single part.
    const total = [...bb.categories.values()].reduce((s, n) => s + n, 0) || 1;
    const named = a.signals.categories.slice(0, 5);
    const overlap = named.reduce((s, c) => s + (bb.categories.get(c) ?? 0) / total, 0);
    score += 0.35 * Math.min(1, overlap * 1.5);
    const shared = named.filter((c) => (bb.categories.get(c) ?? 0) / total >= 0.1);
    if (shared.length) why.push(`also buys ${shared.map((c) => c.replace(/_/g, " ")).join(", ")}`);
    if (a.signals.night_owl && [...bb.hours].some((h) => h >= 21 || h < 6)) {
      score += 0.05;
      why.push("also shops late");
    }
    return { score: Math.round(score * 1000) / 1000, why };
  }

  /** Nearest neighbours and what they predict, for a customer with little or no history. null = has history, or unknown. */
  insight(customerId: string): ColdStartInsight | null {
    if (this.cache.has(customerId)) return this.cache.get(customerId) ?? null;
    const me = this.profiles.get(customerId);
    if (!me || this.hasHistory(customerId)) {
      this.cache.set(customerId, null);
      return null;
    }
    const neighbours: Neighbour[] = [];
    for (const [id, b] of this.behaviour) {
      if (id === customerId || b.purchases < PeerIndex.MIN_HISTORY) continue;
      const p = this.profiles.get(id);
      if (!p) continue;
      const { score, why } = this.similarity(me, p, b);
      neighbours.push({ customer_id: id, score, why });
    }
    neighbours.sort((a, b) => b.score - a.score || a.customer_id.localeCompare(b.customer_id));
    const top = neighbours.slice(0, K);
    const prior = top.length ? this.prior(top) : null;
    const insight: ColdStartInsight = { customer_id: customerId, signals: me.signals, neighbours: top, predicted_categories: this.predict(me.signals, prior), prior };
    this.cache.set(customerId, insight);
    return insight;
  }

  private prior(top: Neighbour[]): PeerPrior {
    const bs = top.map((n) => this.behaviour.get(n.customer_id)!);
    const weight = top.map((n) => Math.max(0.05, n.score));
    const wsum = weight.reduce((s, w) => s + w, 0);
    const cats = new Map<string, number>();
    bs.forEach((b, i) => {
      const total = [...b.categories.values()].reduce((s, n) => s + n, 0) || 1;
      for (const [c, chf] of b.categories) cats.set(c, (cats.get(c) ?? 0) + ((weight[i] ?? 0) / wsum) * (chf / total));
    });
    const countAt = <T>(pick: (b: Behaviour) => Iterable<T>) => {
      const m = new Map<T, number>();
      for (const b of bs) for (const x of new Set(pick(b))) m.set(x, (m.get(x) ?? 0) + 1);
      return m;
    };
    const hours = countAt((b) => b.hours);
    const countries = countAt((b) => b.countries);
    const shops = new Map<string, { name: string; neighbours: number }>();
    for (const b of bs) for (const [id, name] of b.shops) shops.set(id, { name, neighbours: (shops.get(id)?.neighbours ?? 0) + 1 });
    const need = Math.min(2, bs.length);
    return {
      neighbours: top,
      ticket_p50: Math.round(quantile(bs.flatMap((b) => b.tickets), 0.5)),
      ticket_p90: Math.round(quantile(bs.flatMap((b) => b.tickets), 0.9)),
      month_p50: Math.round(quantile(bs.flatMap((b) => [...b.months.values()]), 0.5)),
      categories: [...cats.entries()].map(([category, share]) => ({ category, share: Math.round(share * 1000) / 1000 })).sort((a, b) => b.share - a.share),
      hours: new Set([...hours].filter(([, n]) => n >= need).map(([h]) => h)),
      countries: new Set([...countries].filter(([, n]) => n >= need).map(([c]) => c)),
      shops: new Map([...shops].filter(([, s]) => s.neighbours >= need)),
    };
  }

  /** What the new customer will probably buy: the neighbours' spend, lifted where the customer's own text agrees. */
  private predict(signals: ProfileSignals, prior: PeerPrior | null): CategoryPrediction[] {
    const out = new Map<string, CategoryPrediction>();
    for (const c of prior?.categories ?? []) out.set(c.category, { category: c.category, confidence: c.share, from: ["customers like you"] });
    signals.categories.forEach((c, i) => {
      const lift = 0.35 - i * 0.05;
      const prev = out.get(c);
      out.set(c, prev ? { ...prev, confidence: Math.min(1, prev.confidence + lift), from: ["your profile", "customers like you"] } : { category: c, confidence: Math.max(0.1, lift), from: ["your profile"] });
    });
    return [...out.values()]
      .map((p) => ({ ...p, confidence: Math.round(p.confidence * 100) / 100 }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 6);
  }

  /** What the engine reads (Baselines.peers). */
  readonly lookup: PeerLookup = (customerId, cardId) => {
    const id = customerId ?? this.cardCustomer.get(cardId);
    return id ? (this.insight(id)?.prior ?? null) : null;
  };
}
