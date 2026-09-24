import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadDataPack, type EngineVerdict } from "@leash/shared";
import { OfflinePlatform } from "../src/offline/platform.js";
import { LeashService, ServiceError } from "../src/leash/service.js";
import type { Engine } from "../src/engine/port.js";
import { compile } from "../src/compiler/compile.js";

// The leash ends on a date: read from the instruction, judged in simulated time, tightened but never loosened in place.

const pack = loadDataPack(fileURLToPath(new URL("../../../data", import.meta.url)));
const NOW = Date.UTC(2026, 8, 24, 10); // Thu 24 Sep 2026, midday in Zurich

const approveAll: Engine = {
  version: "test-approve-all",
  decide: (): EngineVerdict => ({
    decision: "approve",
    reason_codes: [],
    headline: "Fine",
    because: "Test engine approves everything.",
    checks: [],
    uncertainty: [],
    shop_text_quarantine: null,
    engine_version: "test-approve-all",
  }),
};

const newService = () => new LeashService({ api: new OfflinePlatform(pack), pack, engine: approveAll, mode: "offline", worker: { pollWaitSeconds: 0 } });

async function replay(service: LeashService, scenario = "SCEN0001") {
  const run = await service.startRun(scenario, true);
  await service.waitForRun(run.run_id);
  return service.feed(run.run_id);
}

describe("the end of a leash", () => {
  it("is read from the instruction as a rule with the customer's words, and no sentence is lost", () => {
    const r = compile("Max CHF 200 per order. Buy running shoes only. Valid until 1 August 2026.", NOW);
    const rule = r.rules.find((x) => x.key === "valid_until");
    expect(rule?.label).toBe("Valid until Sat 1 Aug 2026");
    expect(rule?.your_words?.text).toBe("Valid until 1 August 2026");
    expect(rule?.hard_rule).toBeNull();
    expect(r.valid_until).toBe("2026-08-01T21:59:59.000Z");
    expect(r.not_understood).toEqual([]);
  });

  it("declines every purchase after the end, in simulated time, and nothing before it", async () => {
    const ended = newService();
    await ended.createLeash({ instruction: "Max CHF 300 per week. Valid until 2026-01-01.", confirmed: true });
    expect(ended.getLeash().valid_until).toBe("2026-01-01T22:59:59.000Z");
    const rows = await replay(ended);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((d) => d.decision === "decline" && d.reason_codes.includes("leash_ended"))).toBe(true);
    expect(rows[0]!.because).toMatch(/^Your leash was valid until Thu 1 Jan 2026\./);
    ended.worker.stop();

    const open = newService();
    await open.createLeash({ instruction: "Max CHF 300 per week. Valid until 2030-01-01.", confirmed: true });
    const later = await replay(open);
    expect(later.some((d) => d.reason_codes.includes("leash_ended"))).toBe(false);
    open.worker.stop();
  });

  it("the app's date wins over the instruction, and null means no end", async () => {
    const service = newService();
    await service.createLeash({ instruction: "Max CHF 300 per week. Valid until 2026-01-01.", confirmed: true, valid_until: null });
    expect(service.getLeash().valid_until).toBeNull();
    await service.createLeash({ instruction: "Max CHF 300 per week.", confirmed: true, valid_until: "2027-06-30T21:59:59.000Z" });
    expect(service.getLeash().valid_until).toBe("2027-06-30T21:59:59.000Z");
    await expect(service.createLeash({ instruction: "Max CHF 300 per week.", confirmed: true, valid_until: "next Tuesday" })).rejects.toMatchObject({ code: "invalid_date" });
    service.worker.stop();
  });

  it("can be moved earlier in place; later is a loosening and is refused", async () => {
    const service = newService();
    await service.createLeash({ instruction: "Max CHF 300 per week. Valid until 2027-06-30.", confirmed: true });
    const view = await service.tighten({ type: "end_earlier", valid_until: "2027-03-31T21:59:59.000Z" });
    expect(view.valid_until).toBe("2027-03-31T21:59:59.000Z");
    expect(view.rules.filter((r) => r.key === "valid_until").map((r) => r.label)).toEqual(["Valid until Wed 31 Mar 2027"]);
    await expect(service.tighten({ type: "end_earlier", valid_until: "2027-12-31T22:59:59.000Z" })).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.code === "not_tighter",
    );
    // No end yet: any end is tighter.
    await service.createLeash({ instruction: "Max CHF 300 per week.", confirmed: true });
    expect((await service.tighten({ type: "end_earlier", valid_until: "2027-01-01T22:59:59.000Z" })).valid_until).toBe("2027-01-01T22:59:59.000Z");
    service.worker.stop();
  });
});
