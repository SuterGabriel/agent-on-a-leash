// Loads the Viseca CSV data pack once into typed maps keyed by ID.
// Rule: join on IDs, never on names.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(here, "../../../data");

export type Row = Record<string, string>;

export function readCsv(file: string): Row[] {
  const text = readFileSync(path.join(DATA_DIR, file), "utf8");
  return parse(text, { columns: true, skip_empty_lines: true }) as Row[];
}

function byId(rows: Row[], key: string): Map<string, Row> {
  return new Map(rows.map((r) => [r[key] ?? "", r]));
}

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r[key] ?? "";
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  }
  return m;
}

export interface DataPack {
  scenarios: Map<string, Row>;
  attempts: Row[];
  attemptItems: Map<string, Row[]>;
  merchants: Map<string, Row>;
  items: Map<string, Row>;
  cards: Map<string, Row>;
  accounts: Map<string, Row>;
  customers: Map<string, Row>;
  authorities: Map<string, Row>;
  history: Row[];
}

let cached: DataPack | null = null;

export function loadDataPack(): DataPack {
  if (cached) return cached;
  cached = {
    scenarios: byId(readCsv("scenario_catalogue.csv"), "scenario_id"),
    attempts: readCsv("purchase_attempts.csv"),
    attemptItems: groupBy(readCsv("purchase_attempt_items.csv"), "authorization_id"),
    merchants: byId(readCsv("merchants.csv"), "merchant_id"),
    items: byId(readCsv("items.csv"), "item_id"),
    cards: byId(readCsv("cards.csv"), "card_id"),
    accounts: byId(readCsv("accounts.csv"), "account_id"),
    customers: byId(readCsv("customers.csv"), "customer_id"),
    authorities: byId(readCsv("scenario_authorities.csv"), "authority_id"),
    history: readCsv("authorization_history.csv"),
  };
  return cached;
}

/** Attempts of one scenario, sorted by replay_order. */
export function scenarioAttempts(pack: DataPack, scenarioId: string): Row[] {
  return pack.attempts
    .filter((a) => a.scenario_id === scenarioId)
    .sort((a, b) => Number(a.replay_order) - Number(b.replay_order));
}
