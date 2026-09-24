import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadDataPack, type MandateRule } from "@leash/shared";
import { compile, toMandateDraft } from "../src/compiler/compile.js";
import { OfflinePlatform } from "../src/offline/platform.js";
import { LeashService } from "../src/leash/service.js";
import { LeashEngine } from "../src/engine/leashEngine.js";

// Spec §4.3: the jury may word a leash differently, in English or German. The pattern compiler must read the same
// rules from every wording in tests/policy_paraphrases.json, and the reworded leash must drive the engine to the
// same reference decisions as the original wording.

interface Case {
  id: string;
  scenario: string | null;
  e2e: boolean;
  instruction: string;
  expect: {
    keys: string[];
    order_limit?: number;
    period?: { amount: number; days: number };
    categories?: string[];
    requested_item?: string;
    size?: string;
    merchant_category?: string[];
    return_days?: number;
    uncertainty: string;
    not_understood?: string[];
    warnings?: number;
    assumption_contains?: string;
  };
}

const root = fileURLToPath(new URL("../../../", import.meta.url));
const { cases } = JSON.parse(readFileSync(`${root}tests/policy_paraphrases.json`, "utf8")) as { cases: Case[] };
const pack = loadDataPack(`${root}data`);
const expected = new Map(
  readFileSync(`${root}data/reference_decisions.csv`, "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(","))
    .map((c) => [c[0] as string, c[2] as string]),
);

const rule = (rules: MandateRule[], field: string, scope?: string) => rules.find((r) => r.field === field && (scope === undefined || r.scope === scope));

describe("policy paraphrases: the compiler reads rules, not sentences", () => {
  it("has the catalogue wording plus at least 10 rewordings in English and German", () => {
    const rewordings = cases.filter((c) => !c.id.endsWith("-catalogue"));
    expect(cases.filter((c) => c.id.endsWith("-catalogue")).length).toBe(5);
    expect(rewordings.length).toBeGreaterThanOrEqual(10);
    expect(rewordings.filter((c) => c.id.includes("-de")).length).toBeGreaterThanOrEqual(5);
    expect(rewordings.filter((c) => c.id.includes("-en")).length).toBeGreaterThanOrEqual(5);
  });

  for (const c of cases) {
    it(`${c.id}: ${c.instruction.slice(0, 60)}…`, () => {
      const r = compile(c.instruction);
      const hard = toMandateDraft(r, r.rules).hard_rules;
      const e = c.expect;

      expect([...r.rules.map((x) => x.key)].sort()).toEqual([...e.keys].sort());
      expect(r.uncertainty_policy).toBe(e.uncertainty);
      expect(r.not_understood).toEqual(e.not_understood ?? []);
      if (e.warnings !== undefined) expect(r.warnings.length).toBe(e.warnings);
      else expect(r.warnings).toEqual(e.uncertainty === "approve" ? r.warnings : []);

      if (e.order_limit !== undefined) expect(rule(hard, "authorization.billing_amount_chf", "purchase")?.value).toBe(e.order_limit);
      if (e.period) {
        const p = rule(hard, "authorization.billing_amount_chf", "period");
        expect([p?.value, p?.period_days]).toEqual([e.period.amount, e.period.days]);
      }
      if (e.categories) expect(rule(hard, "items.item_category")?.value).toEqual(e.categories);
      if (e.requested_item) expect(rule(hard, "items.requested_item")?.value).toBe(e.requested_item);
      if (e.size) expect(rule(hard, "items.size")?.value).toBe(e.size);
      if (e.merchant_category) expect(rule(hard, "merchant.merchant_category")?.value).toEqual(e.merchant_category);
      if (e.return_days !== undefined) expect(rule(hard, "order.return_window_days")?.value).toBe(e.return_days);
      if (e.assumption_contains) expect(r.assumptions.join(" ")).toContain(e.assumption_contains);

      // The customer's own words point at the right place in the instruction.
      for (const x of r.rules) expect(r.instruction.slice(x.your_words!.start, x.your_words!.end)).toBe(x.your_words!.text);
    });
  }
});

describe("policy paraphrases end to end: a reworded leash gives the same decisions", () => {
  for (const c of cases.filter((x) => x.e2e && x.scenario)) {
    it(`${c.id} on ${c.scenario}`, async () => {
      const engine = new LeashEngine();
      const service = new LeashService({ api: new OfflinePlatform(pack), pack, engine, mode: "offline", worker: { pollWaitSeconds: 0 } });
      engine.follow(service.bus);
      await service.createLeash({ instruction: c.instruction, confirmed: true });
      const run = await service.startRun(c.scenario!, true);
      await service.waitForRun(run.run_id);
      service.worker.stop();

      const rows = service.feed(run.run_id);
      const mismatches = rows
        .filter((d) => expected.get(d.source_authorization_id) !== d.decision)
        .map((d) => `${d.source_authorization_id}: ${d.decision} ≠ ${expected.get(d.source_authorization_id)} (${d.reason_codes.join("+")})`);
      expect(rows.length).toBe(pack.scenarios.get(c.scenario!)!.event_count);
      expect(mismatches).toEqual([]);
      for (const d of rows) expect(d.reason_codes, d.source_authorization_id).not.toContain("rule_not_applied");
    });
  }
});
