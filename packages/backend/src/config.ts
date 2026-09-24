import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: resolve(repoRoot, ".env") });

export type LeashMode = "offline" | "live";

export interface Config {
  mode: LeashMode;
  baseUrl: string;
  teamApiKey: string | null;
  dataDir: string;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const mode = (overrides.mode ?? process.env.LEASH_MODE ?? "offline") as LeashMode;
  if (mode !== "offline" && mode !== "live") throw new Error(`LEASH_MODE must be offline or live, got ${mode}`);
  return {
    mode,
    baseUrl: overrides.baseUrl ?? process.env.LEASH_BASE_URL ?? "https://saw26api.ashyground-364e1d07.switzerlandnorth.azurecontainerapps.io",
    // Keys are handed out as "team3:<token>", but the API only accepts the token (tested: prefix → 401).
    teamApiKey: overrides.teamApiKey ?? (process.env.TEAM_API_KEY?.trim().replace(/^team\d+:/i, "") || null),
    dataDir: overrides.dataDir ?? resolve(repoRoot, "data"),
  };
}
