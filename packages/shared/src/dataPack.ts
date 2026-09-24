import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import type { Currency } from "./event.js";
import type { FxTable } from "./fx.js";

// Raw CSV rows: every value is a string, empty string = no value.
export type Row = Record<string, string>;

export interface Scenario {
  scenario_id: string;
  scenario_name: string;
  cardholder_instruction: string;
  event_count: number;
}

export interface Authority {
  authority_id: string;
  customer_id: string;
  card_id: string;
}

export interface DataPack {
  dir: string;
  scenarios: Map<string, Scenario>;
  authorities: Map<string, Authority>;
  merchants: Map<string, Row>;
  cards: Map<string, Row>;
  /** purchase_attempts.csv rows keyed by AU id. */
  attempts: Map<string, Row>;
  /** cart lines keyed by AU id, sorted by line_no. */
  attemptItems: Map<string, Row[]>;
  fx: FxTable;
}

function readCsv(dir: string, file: string): Row[] {
  return parse(readFileSync(join(dir, file), "utf8"), { columns: true, skip_empty_lines: true }) as Row[];
}

function byKey(rows: Row[], key: string): Map<string, Row> {
  return new Map(rows.map((r) => [r[key] as string, r]));
}

/** Loads the small catalogues once. The 4,701-row history is loaded separately by whoever needs baselines. */
export function loadDataPack(dir: string): DataPack {
  const scenarios = new Map<string, Scenario>(
    readCsv(dir, "scenario_catalogue.csv").map((r) => [
      r.scenario_id as string,
      {
        scenario_id: r.scenario_id as string,
        scenario_name: r.scenario_name as string,
        cardholder_instruction: r.cardholder_instruction as string,
        event_count: Number(r.event_count),
      },
    ]),
  );
  const authorities = new Map<string, Authority>(
    readCsv(dir, "scenario_authorities.csv").map((r) => [
      r.authority_id as string,
      { authority_id: r.authority_id as string, customer_id: r.customer_id as string, card_id: r.card_id as string },
    ]),
  );
  const attemptItems = new Map<string, Row[]>();
  for (const line of readCsv(dir, "purchase_attempt_items.csv")) {
    const id = line.authorization_id as string;
    attemptItems.set(id, [...(attemptItems.get(id) ?? []), line]);
  }
  for (const lines of attemptItems.values()) lines.sort((a, b) => Number(a.line_no) - Number(b.line_no));

  const fx = {} as FxTable;
  for (const r of readCsv(dir, "fx_rates.csv")) fx[r.from_currency as Currency] = Number(r.rate);

  return {
    dir,
    scenarios,
    authorities,
    merchants: byKey(readCsv(dir, "merchants.csv"), "merchant_id"),
    cards: byKey(readCsv(dir, "cards.csv"), "card_id"),
    attempts: byKey(readCsv(dir, "purchase_attempts.csv"), "authorization_id"),
    attemptItems,
    fx,
  };
}

/** Approved purchases per merchant on one card, from authorization_history.csv (4,701 rows, read once per call). */
export function approvedPurchasesByMerchant(dir: string, cardId: string): Map<string, { name: string; count: number }> {
  const out = new Map<string, { name: string; count: number }>();
  for (const r of readCsv(dir, "authorization_history.csv")) {
    if (r.card_id !== cardId || r.status !== "approved" || r.transaction_type !== "purchase") continue;
    const id = r.merchant_id as string;
    const prev = out.get(id);
    out.set(id, { name: r.merchant_name as string, count: (prev?.count ?? 0) + 1 });
  }
  return out;
}

/** Attempts of one scenario in delivery order. */
export function scenarioAttempts(pack: DataPack, scenarioId: string): Row[] {
  return [...pack.attempts.values()]
    .filter((r) => r.scenario_id === scenarioId)
    .sort((a, b) => Number(a.replay_order) - Number(b.replay_order));
}
