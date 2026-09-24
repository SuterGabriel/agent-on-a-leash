import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDataPack, type EngineVerdict } from "@leash/shared";
import { OfflinePlatform } from "../src/offline/platform.js";
import { LeashService, type ServiceSnapshot } from "../src/leash/service.js";
import { attachSnapshotFile } from "../src/persist.js";
import type { Engine } from "../src/engine/port.js";

// A restart must not lose the leash, the feed, open asks or tokens. The snapshot is a JSON file; the store's rows
// travel as they are, a token whose history chain was tampered with is dropped, and an ask whose window passed is expired.

const pack = loadDataPack(fileURLToPath(new URL("../../../data", import.meta.url)));
const SCEN0001 = pack.scenarios.get("SCEN0001")!.cardholder_instruction;

/** Approves the first purchase of a run, asks about the rest. */
const approveFirst: Engine = {
  version: "test-approve-first",
  decide: (event): EngineVerdict => {
    const first = event.authorization.replay_order === 1;
    return {
      decision: first ? "approve" : "step_up",
      reason_codes: [first ? "within_rules" : "test_ask"],
      headline: first ? "Fits" : "Asking you",
      because: "Test engine.",
      checks: [],
      uncertainty: [],
      shop_text_quarantine: null,
      engine_version: "test-approve-first",
    };
  },
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempFile = () => {
  const d = mkdtempSync(join(tmpdir(), "leash-state-"));
  dirs.push(d);
  return join(d, "state.json");
};

async function runOne(platform = new OfflinePlatform(pack)) {
  const service = new LeashService({ api: platform, pack, engine: approveFirst, mode: "offline", worker: { pollWaitSeconds: 0 } });
  await service.createLeash({ instruction: SCEN0001, confirmed: true });
  const run = await service.startRun("SCEN0001", true);
  await service.waitForRun(run.run_id);
  return { service, platform, run };
}

describe("snapshot and restore", () => {
  it("a fresh service restored from a snapshot shows the same leash, feed, asks and tokens", async () => {
    const { service, platform } = await runOne();
    const before = service.snapshot();
    expect(before.decisions.length).toBeGreaterThan(1);
    expect(before.tokens).toHaveLength(1);
    service.worker.stop();

    const again = new LeashService({ api: platform, pack, engine: approveFirst, mode: "offline", worker: { pollWaitSeconds: 0 } });
    const report = again.restore(JSON.parse(JSON.stringify(before)) as ServiceSnapshot);
    expect(report.decisions).toBe(before.decisions.length);
    expect(report.open_asks).toBe(service.asks().length);
    expect(report.tokens).toBe(1);
    expect(report.tokens_rejected).toEqual([]);
    expect(again.getLeash()).toEqual(service.getLeash());
    expect(again.feed().map((d) => d.id)).toEqual(service.feed().map((d) => d.id));
    expect(again.listTokens()).toEqual(service.listTokens());

    // An open ask can still be answered after the restart, and the budget still counts it.
    const ask = again.asks()[0]!;
    const answered = await again.resolve(ask.id, "approve");
    expect(answered.status).toBe("approved_by_you");
    expect(again.getLeash().budget!.spent_chf).toBeGreaterThan(service.getLeash().budget!.spent_chf);
    again.worker.stop();
  });

  it("a snapshot from the other mode is refused", async () => {
    const { service } = await runOne();
    const snap = service.snapshot();
    service.worker.stop();
    const live = new LeashService({ api: new OfflinePlatform(pack), pack, engine: approveFirst, mode: "live", worker: { pollWaitSeconds: 0 } });
    expect(() => live.restore(snap)).toThrow(/offline mode/);
    live.worker.stop();
  });

  it("a token whose history was edited in the file is dropped; the others are kept", async () => {
    const { service } = await runOne();
    const snap = JSON.parse(JSON.stringify(service.snapshot())) as ServiceSnapshot;
    service.worker.stop();
    snap.tokens[0]!.history[0]!.detail = snap.tokens[0]!.history[0]!.detail.replace(/up to CHF [\d.]+/, "up to CHF 9999.00");
    const again = new LeashService({ api: new OfflinePlatform(pack), pack, engine: approveFirst, mode: "offline", worker: { pollWaitSeconds: 0 } });
    const report = again.restore(snap);
    expect(report.tokens).toBe(0);
    expect(report.tokens_rejected).toEqual([snap.tokens[0]!.id]);
    expect(again.listTokens()).toEqual([]);
    again.worker.stop();
  });

  it("an ask whose answer window passed while the backend was down comes back expired", async () => {
    const { service } = await runOne();
    const snap = JSON.parse(JSON.stringify(service.snapshot())) as ServiceSnapshot;
    service.worker.stop();
    for (const d of snap.decisions) if (d.status === "waiting_for_you") d.human_deadline_at = new Date(Date.now() - 1_000).toISOString();
    const again = new LeashService({ api: new OfflinePlatform(pack), pack, engine: approveFirst, mode: "offline", worker: { pollWaitSeconds: 0 } });
    const report = again.restore(snap);
    expect(report.open_asks).toBe(0);
    expect(report.expired_asks).toBeGreaterThan(0);
    expect(again.asks()).toEqual([]);
    await expect(again.resolve(snap.decisions.find((d) => d.status === "waiting_for_you")!.id, "approve")).rejects.toMatchObject({ code: "expired" });
    again.worker.stop();
  });
});

describe("the snapshot file", () => {
  it("is written after a run and read back by a new service", async () => {
    const file = tempFile();
    const platform = new OfflinePlatform(pack);
    const service = new LeashService({ api: platform, pack, engine: approveFirst, mode: "offline", worker: { pollWaitSeconds: 0 } });
    const attached = attachSnapshotFile(service, file, { debounceMs: 10, intervalMs: 60_000 });
    expect(attached.restored).toBeNull();
    await service.createLeash({ instruction: SCEN0001, confirmed: true });
    const run = await service.startRun("SCEN0001", true);
    await service.waitForRun(run.run_id);
    attached.flush();
    attached.stop();
    service.worker.stop();
    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.tmp`)).toBe(false);

    const again = new LeashService({ api: platform, pack, engine: approveFirst, mode: "offline", worker: { pollWaitSeconds: 0 } });
    const attachedAgain = attachSnapshotFile(again, file, { debounceMs: 10, intervalMs: 60_000 });
    expect(attachedAgain.restored?.decisions).toBe(service.feed().length);
    expect(again.feed().map((d) => d.id)).toEqual(service.feed().map((d) => d.id));
    expect(again.getLeash().status).toBe("active");
    attachedAgain.stop();
    again.worker.stop();
  });

  it("a corrupt file is moved aside and the service starts empty", () => {
    const file = tempFile();
    writeFileSync(file, "{ not json");
    const service = new LeashService({ api: new OfflinePlatform(pack), pack, engine: approveFirst, mode: "offline", worker: { pollWaitSeconds: 0 } });
    const attached = attachSnapshotFile(service, file, { debounceMs: 10, intervalMs: 60_000 });
    expect(attached.restored).toBeNull();
    expect(existsSync(file)).toBe(false);
    expect(service.getLeash().status).toBe("none");
    attached.stop();
    service.worker.stop();
  });

  it("nothing changed, nothing written: flush reports false the second time", async () => {
    const file = tempFile();
    const service = new LeashService({ api: new OfflinePlatform(pack), pack, engine: approveFirst, mode: "offline", worker: { pollWaitSeconds: 0 } });
    const attached = attachSnapshotFile(service, file, { debounceMs: 10, intervalMs: 60_000 });
    expect(attached.flush()).toBe(true);
    const first = readFileSync(file, "utf8");
    expect(attached.flush()).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(first);
    attached.stop();
    service.worker.stop();
  });
});
