import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";

// The live pack's reference data: downloaded at startup in live mode, cached in data/live/.
// If a download fails, the last cached copy is used, so a run can still start.

export type Row = Record<string, string>;

export interface LiveScenario {
  scenario_id: string;
  scenario_name: string;
  cardholder_instruction: string;
  event_count: number;
}

export interface LiveReference {
  bootstrap: unknown;
  referenceData: unknown;
  /** Rows of authorization-history.csv, as strings (same columns as data/authorization_history.csv). */
  history: Row[];
  /** merchant_id → row, from reference-data tables.merchants. */
  merchants: Map<string, Row>;
  scenarios: LiveScenario[];
  /** "downloaded" or "cache" (a download failed and the cached copy was used). */
  source: "downloaded" | "cache";
}

export interface LiveReferenceSource {
  bootstrap(): Promise<unknown>;
  referenceData(): Promise<unknown>;
  authorizationHistoryCsv(): Promise<string>;
}

const FILES = { bootstrap: "bootstrap.json", referenceData: "reference-data.json", history: "authorization-history.csv" };

const asStrings = (o: Record<string, unknown>): Row =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]));

function tables(referenceData: unknown): Record<string, Record<string, unknown>[]> {
  const t = (referenceData as { tables?: unknown } | null)?.tables;
  return t && typeof t === "object" ? (t as Record<string, Record<string, unknown>[]>) : {};
}

export async function loadLiveReference(api: LiveReferenceSource, cacheDir: string, log: (line: string) => void = () => {}): Promise<LiveReference> {
  const paths = {
    bootstrap: join(cacheDir, FILES.bootstrap),
    referenceData: join(cacheDir, FILES.referenceData),
    history: join(cacheDir, FILES.history),
  };
  let source: LiveReference["source"] = "downloaded";
  try {
    const [bootstrap, referenceData, historyCsv] = await Promise.all([api.bootstrap(), api.referenceData(), api.authorizationHistoryCsv()]);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(paths.bootstrap, JSON.stringify(bootstrap, null, 2));
    writeFileSync(paths.referenceData, JSON.stringify(referenceData, null, 2));
    writeFileSync(paths.history, historyCsv);
  } catch (err) {
    if (!Object.values(paths).every((p) => existsSync(p))) throw err;
    log(`live reference data: download failed (${(err as Error).message}), using the cache in ${cacheDir}`);
    source = "cache";
  }

  const bootstrap = JSON.parse(readFileSync(paths.bootstrap, "utf8")) as unknown;
  const referenceData = JSON.parse(readFileSync(paths.referenceData, "utf8")) as unknown;
  const history = parse(readFileSync(paths.history, "utf8"), { columns: true, skip_empty_lines: true }) as Row[];
  const t = tables(referenceData);
  const merchants = new Map((t.merchants ?? []).map((m) => { const r = asStrings(m); return [r.merchant_id ?? "", r] as const; }));
  const scenarios = (t.scenario_catalogue ?? []).map((s) => {
    const r = asStrings(s);
    return { scenario_id: r.scenario_id ?? "", scenario_name: r.scenario_name ?? "", cardholder_instruction: r.cardholder_instruction ?? "", event_count: Number(r.event_count ?? 0) };
  });
  return { bootstrap, referenceData, history, merchants, scenarios, source };
}
