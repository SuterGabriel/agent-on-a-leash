import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLiveReference, type LiveReferenceSource } from "../src/live/referenceData.js";
import { buildBaselines } from "../../shared/src/baselines.js";

const HISTORY = [
  "authorization_id,customer_id,card_id,timestamp,transaction_type,status,merchant_id,merchant_name,merchant_category,merchant_country,recurring,customer_device_id",
  "H1,CU9,CA9,2026-05-01T10:00:00Z,purchase,approved,ME1,Table Name,groceries,CH,false,DV1",
  "H2,CU9,CA9,2026-05-02T10:00:00Z,purchase,approved,ME2,Only In History,electronics,CH,false,DV1",
].join("\n");

const source = (): LiveReferenceSource => ({
  bootstrap: async () => ({ pack_version: "test-pack" }),
  referenceData: async () => ({
    tables: {
      merchants: [{ merchant_id: "ME1", merchant_name: "Table Name", merchant_category: "groceries" }],
      scenario_catalogue: [{ scenario_id: "SCEN0999", scenario_name: "Test", cardholder_instruction: "Up to CHF 50 per order.", event_count: 2 }],
    },
  }),
  authorizationHistoryCsv: async () => HISTORY,
});

describe("live reference data", () => {
  it("downloads, caches in the folder, and parses scenarios, merchants and history", async () => {
    const dir = mkdtempSync(join(tmpdir(), "leash-live-"));
    try {
      const ref = await loadLiveReference(source(), dir);
      expect(ref.source).toBe("downloaded");
      expect(ref.scenarios).toEqual([{ scenario_id: "SCEN0999", scenario_name: "Test", cardholder_instruction: "Up to CHF 50 per order.", event_count: 2 }]);
      expect(ref.history).toHaveLength(2);
      expect(ref.merchants.get("ME1")?.merchant_name).toBe("Table Name");
      expect(readFileSync(join(dir, "authorization-history.csv"), "utf8")).toBe(HISTORY);
      expect(JSON.parse(readFileSync(join(dir, "bootstrap.json"), "utf8"))).toEqual({ pack_version: "test-pack" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the cache when a download fails, and fails when there is no cache", async () => {
    const dir = mkdtempSync(join(tmpdir(), "leash-live-"));
    try {
      const broken: LiveReferenceSource = { ...source(), authorizationHistoryCsv: async () => { throw new Error("offline"); } };
      await expect(loadLiveReference(broken, dir)).rejects.toThrow("offline");
      await loadLiveReference(source(), dir);
      const ref = await loadLiveReference(broken, dir);
      expect(ref.source).toBe("cache");
      expect(ref.history).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("baselines take shop names from history rows; the merchant table wins where both exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "leash-live-"));
    try {
      const ref = await loadLiveReference(source(), dir);
      ref.merchants.set("ME1", { ...ref.merchants.get("ME1")!, merchant_name: "Name From Table" });
      const base = buildBaselines(ref.history, ref.merchants);
      expect(base.merchantNames.get("ME1")).toEqual({ name: "Name From Table", category: "groceries" });
      expect(base.merchantNames.get("ME2")).toEqual({ name: "Only In History", category: "electronics" });
      expect(base.cards.get("CA9")?.merchants.get("ME2")).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
