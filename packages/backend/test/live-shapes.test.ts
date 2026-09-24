import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertAuthorizationEvent, loadDataPack, type Check } from "@leash/shared";
import { toRunInfo, VisecaError } from "../src/viseca/api.js";
import { isRunDone, toDecisionBody } from "../src/worker.js";
import { OfflinePlatform } from "../src/offline/platform.js";

// Real responses recorded on the first live SCEN0000 run (24 Sep 2026).
const fixture = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/live/${name}`, import.meta.url)), "utf8")).result;

describe("live API response shapes", () => {
  it("the live event passes our event check", () => {
    const envelope = fixture("004-nextDecisionRequest.json");
    expect(typeof envelope.event_id).toBe("number");
    expect(() => assertAuthorizationEvent(envelope.data)).not.toThrow();
  });

  it("reads the flat run counters and knows when the worker is done", () => {
    const started = toRunInfo(fixture("003-startRun.json").raw);
    expect(started.status).toBe("running");
    expect(started.counters).toMatchObject({ generated: 1, delivered: 0, queued: 1 });
    expect(isRunDone(started.status, started.counters, 1)).toBe(false);

    const finished = toRunInfo(fixture("008-getRun.json").raw);
    expect(finished.status).toBe("completed");
    expect(isRunDone(finished.status, finished.counters, 1)).toBe(true);
  });

  it("all delivered and nothing queued counts as done even while an ask is pending", () => {
    expect(isRunDone("running", { generated: 10, delivered: 10, queued: 0, pending: 1 }, 10)).toBe(true);
    expect(isRunDone("running", { generated: 4, delivered: 4, queued: 0 }, 10)).toBe(false);
  });

  it("step_up responses carry Viseca's own answer deadline", () => {
    expect(fixture("006-postDecision.json").step_up_expires_at).toMatch(/Z$/);
  });
});

describe("evidence format", () => {
  const check: Check = { key: "order_limit", label: "Each order CHF 20 or less", your_words: "for CHF 20 or less", source: "you", result: "pass", fact: "CHF 20.00" };

  it("sends one object per check", () => {
    const body = toDecisionBody("X", { decision: "approve", reason_codes: [], because: "ok", checks: [check], engine_version: "t" });
    expect(body.evidence).toEqual([{ key: "order_limit", label: "Each order CHF 20 or less", source: "you", result: "pass", fact: "CHF 20.00" }]);
  });

  it("the offline platform rejects string evidence like the live API", async () => {
    const pack = loadDataPack(fileURLToPath(new URL("../../../data", import.meta.url)));
    const p = new OfflinePlatform(pack);
    const { draft_id } = await p.createMandate({ instruction: "x", hard_rules: [], uncertainty_policy: "ask", guidance: [], open_questions: [] });
    const { mandate_id } = await p.confirmMandate(draft_id);
    await p.startRun({ scenario_id: "SCEN0000", mandate_id });
    const env = (await p.nextDecisionRequest(0))!;
    const id = env.data.authorization.authorization_id;
    await expect(p.postDecision(id, { authorization_id: id, decision: "approve", evidence: ["a string" as never] })).rejects.toBeInstanceOf(VisecaError);
  });
});
