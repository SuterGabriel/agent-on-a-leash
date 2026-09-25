import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import type { LiveReference } from "../live/referenceData.js";
import type { PeerSources } from "./peers.js";

// Where the cold start finds customers, accounts, cards and history:
// 1. live mode: the live reference data just downloaded (the new customers are there);
// 2. offline, if a copy of the live reference data was saved (data/live/, by npm run api -- --live or api-atlas):
//    that copy, so the offline demo can show real new customers too;
// 3. otherwise the local data pack's CSVs (every customer there has history, so no cold start is needed).

type Row = Record<string, unknown>;
const csv = (file: string): Row[] => parse(readFileSync(file, "utf8"), { columns: true, skip_empty_lines: true }) as Row[];
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export interface LoadedPeerSources {
  sources: PeerSources;
  /** The customer the live pack presents (bootstrap profile), if known. */
  profileCustomerId?: string;
  from: "live" | "live-cache" | "data-pack";
}

const profileOf = (bootstrap: unknown): string | undefined => {
  const id = obj(obj(obj(bootstrap).profile).profile_context).customer_id;
  return typeof id === "string" ? id : undefined;
};

export function loadPeerSources(dataDir: string, liveRef: LiveReference | null): LoadedPeerSources {
  if (liveRef) {
    const t = obj(obj(liveRef.referenceData).tables);
    return {
      sources: { customers: (t.customers as Row[]) ?? [], accounts: liveRef.accounts, cards: liveRef.cards, history: liveRef.history },
      profileCustomerId: profileOf(liveRef.bootstrap),
      from: "live",
    };
  }
  const cache = join(dataDir, "live");
  const refFile = join(cache, "reference-data.json");
  const histFile = join(cache, "authorization-history.csv");
  if (existsSync(refFile) && existsSync(histFile)) {
    const t = obj(obj(JSON.parse(readFileSync(refFile, "utf8"))).tables);
    const bootFile = join(cache, "bootstrap.json");
    return {
      sources: { customers: (t.customers as Row[]) ?? [], accounts: (t.accounts as Row[]) ?? [], cards: (t.cards as Row[]) ?? [], history: csv(histFile) },
      profileCustomerId: existsSync(bootFile) ? profileOf(JSON.parse(readFileSync(bootFile, "utf8"))) : undefined,
      from: "live-cache",
    };
  }
  return {
    sources: {
      customers: csv(join(dataDir, "customers.csv")),
      accounts: csv(join(dataDir, "accounts.csv")),
      cards: csv(join(dataDir, "cards.csv")),
      history: csv(join(dataDir, "authorization_history.csv")),
    },
    from: "data-pack",
  };
}
