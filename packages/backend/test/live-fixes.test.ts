import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadDataPack } from "@leash/shared";
import { OfflinePlatform } from "../src/offline/platform.js";
import { LeashService } from "../src/leash/service.js";
import { stubEngine } from "../src/engine/port.js";

// Two things the first live run (SCEN0101, 24 Sep 2026) showed.

const pack = loadDataPack(fileURLToPath(new URL("../../../data", import.meta.url)));

describe("live findings", () => {
  it("a card missing from the local card table (live cards like CA1331) still shows in the leash", async () => {
    const withoutCards = { ...pack, cards: new Map() };
    const service = new LeashService({ api: new OfflinePlatform(pack), pack: withoutCards, engine: stubEngine, mode: "offline", worker: { pollWaitSeconds: 0 } });
    const run = await service.startRun("SCEN0000");
    await service.waitForRun(run.run_id);
    expect(service.getLeash().card).toEqual({ id: "CA0001", label: "Card •• 0001" });
    service.worker.stop();
  });

  it("an unanswered ask ends as declined with reason step_up_expired, as on the live API", async () => {
    const platform = new OfflinePlatform(pack, { humanWindowMs: 20 });
    const service = new LeashService({ api: platform, pack, engine: stubEngine, mode: "offline", worker: { pollWaitSeconds: 0 } });
    const run = await service.startRun("SCEN0000");
    await service.waitForRun(run.run_id);
    await new Promise((r) => setTimeout(r, 60));
    const [auth] = (await platform.listAuthorizations()) as { status: string; final_reason_codes: string[] | null }[];
    expect(auth).toMatchObject({ status: "declined", final_reason_codes: ["step_up_expired"] });
    expect((await platform.getRun(run.run_id)).status).toBe("completed");
    service.worker.stop();
  });
});
