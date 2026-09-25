import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvent, loadDataPack, type AuthorizationEvent, type EventMandate } from "@leash/shared";
import { LeashEngine } from "../src/engine/leashEngine.js";
import { compile, toMandateDraft } from "../src/compiler/compile.js";
import { MemoryStore } from "../src/memory/memoryStore.js";
import { OfflinePlatform } from "../src/offline/platform.js";
import { LeashService } from "../src/leash/service.js";
import { stubEngine } from "../src/engine/port.js";

// What the customer teaches us is learned for real: it changes the next decision and survives a restart.
// All names below are invented; the card has no history, like the live scenario cards.

const pack = loadDataPack(fileURLToPath(new URL("../../../data", import.meta.url)));
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "leash-memory-"));
  dirs.push(d);
  return join(d, "memory.json");
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const CUSTOMER = "CU_NEWCOMER";
const CARD = "CA_NEWCOMER";

function event(instruction: string, over: { merchant_id?: string; merchant_name?: string; device?: string; hour?: number; country?: string } = {}): AuthorizationEvent {
  const parsed = compile(instruction);
  const draft = toMandateDraft(parsed, parsed.rules);
  const mandate: EventMandate = { mandate_id: "TM-MEM", status: "active", customer_id: CUSTOMER, card_id: CARD, instruction: draft.instruction, hard_rules: draft.hard_rules, uncertainty_policy: draft.uncertainty_policy, profile_id: "P" };
  const e = buildEvent(pack, pack.attempts.get("AU0001")!, {
    liveAuthorizationId: `LIVE-${Math.random()}`,
    requestId: "r",
    mandate,
    relatedLiveId: null,
    context: { approved_spend_in_period_chf: 0, recent_authorizations: [] },
    receivedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 8000).toISOString(),
  });
  e.authorization.card_id = CARD;
  e.authorization.customer_device_id = over.device ?? "DV-OWN";
  e.authorization.recent_attempt_count_10m = 0;
  if (over.merchant_id) e.authorization.merchant.merchant_id = over.merchant_id;
  if (over.merchant_name) e.authorization.merchant.merchant_name = over.merchant_name;
  if (over.country) e.authorization.merchant.merchant_country = over.country;
  if (over.hour !== undefined) e.authorization.timestamp = `2026-07-15T${String((over.hour + 22) % 24).padStart(2, "0")}:10:00Z`; // Swiss summer time = UTC+2
  return e;
}

const purchase = (e: AuthorizationEvent) => ({
  id: e.authorization.authorization_id,
  customer_id: CUSTOMER,
  card_id: CARD,
  device_id: e.authorization.customer_device_id,
  merchant: { id: e.authorization.merchant.merchant_id, name: e.authorization.merchant.merchant_name, country: e.authorization.merchant.merchant_country },
  purchased_at: e.authorization.timestamp,
});

const decideWith = (memory: MemoryStore, e: AuthorizationEvent) => {
  const engine = new LeashEngine();
  engine.useMemory(memory.lookup);
  return engine.decide(e, { runId: `run-${Math.random()}`, currentMandate: null });
};

const KNOWN = "Groceries up to CHF 100 per order, only from shops I have used before. Ask me when unsure.";
const SESSION = "Groceries up to CHF 100 per order. Pause anything that doesn't look like me. Ask me when unsure.";

describe("memory store", () => {
  it("survives a restart: a new store on the same file knows the shop and the device", () => {
    const file = tmp();
    const e = event(KNOWN, { merchant_id: "ME-CORNER", merchant_name: "Corner Pantry" });
    new MemoryStore({ file }).learnFromApproval(purchase(e));
    const after = new MemoryStore({ file }).lookup(CUSTOMER, CARD)!;
    expect(after.shops.get("ME-CORNER")?.count).toBe(1);
    expect(after.devices.has("DV-OWN")).toBe(true);
  });

  it("a corrupt file is moved aside and never trusted", () => {
    const file = tmp();
    writeFileSync(file, "{ not json");
    const m = new MemoryStore({ file });
    expect(m.lookup(CUSTOMER, CARD)).toBeNull();
    expect(readdirSync(join(file, "..")).some((f) => f.startsWith("memory.json.corrupt-"))).toBe(true);
  });
});

describe("the engine learns from the customer", () => {
  it("a shop the customer approved passes next time, even after a restart", () => {
    const file = tmp();
    const e1 = event(KNOWN, { merchant_id: "ME-CORNER", merchant_name: "Corner Pantry" });
    const first = decideWith(new MemoryStore({ file }), e1);
    expect(first.decision).toBe("step_up");
    expect(first.reason_codes).toContain("no_shop_history");

    new MemoryStore({ file }).learnFromApproval(purchase(e1)); // the customer said yes
    const second = decideWith(new MemoryStore({ file }), event(KNOWN, { merchant_id: "ME-CORNER", merchant_name: "Corner Pantry" }));
    expect(second.decision).toBe("approve");
    expect(second.checks.find((c) => c.key === "familiarity")?.fact).toContain("confirmed_by_you");

    const other = decideWith(new MemoryStore({ file }), event(KNOWN, { merchant_id: "ME-OTHER", merchant_name: "Other Pantry" }));
    expect(other.decision).toBe("step_up"); // one yes does not vouch for other shops
  });

  it("a device the customer vouched for is not 'unknown' anymore; another device still asks", () => {
    const memory = new MemoryStore();
    memory.confirmWasMe(purchase(event(SESSION)));
    expect(decideWith(memory, event(SESSION)).reason_codes).not.toContain("no_session_history");
    expect(decideWith(memory, event(SESSION, { device: "DV-STRANGER" })).reason_codes).toContain("no_session_history");
  });

  it("'Not me': that device is stopped, even without a session rule", () => {
    const memory = new MemoryStore();
    memory.denyWasMe(purchase(event(KNOWN, { device: "DV-THIEF" })));
    const r = decideWith(memory, event("Groceries up to CHF 100 per order. Ask me when unsure.", { device: "DV-THIEF" }));
    expect(r.decision).toBe("decline");
    expect(r.reason_codes).toContain("session_not_you");
  });

  it("a blocked shop is declined from memory alone (it survives a new mandate)", () => {
    const memory = new MemoryStore();
    memory.block(CUSTOMER, CARD, { id: "ME-SHADY", name: "Shady Deals" });
    const r = decideWith(memory, event("Groceries up to CHF 100 per order. Ask me when unsure.", { merchant_id: "ME-SHADY", merchant_name: "Shady Deals" }));
    expect(r.decision).toBe("decline");
    expect(r.reason_codes).toContain("blocked_shop");
  });
});

describe("night, 23:00 to 06:00 Swiss time", () => {
  it("the compiler reads it and the guard enforces it", () => {
    const memory = new MemoryStore();
    const declined = decideWith(memory, event("Groceries up to CHF 100 per order. No purchases at night. Ask me when unsure.", { hour: 2 }));
    expect(declined.decision).toBe("decline");
    expect(declined.reason_codes).toContain("night_purchase");
    const asked = decideWith(memory, event("Groceries up to CHF 100 per order. Ask me before any purchase at night.", { hour: 2 }));
    expect(asked.decision).toBe("step_up");
    const day = decideWith(memory, event("Groceries up to CHF 100 per order. No purchases at night. Ask me when unsure.", { hour: 14 }));
    expect(day.reason_codes).not.toContain("night_purchase");
  });

  it("a night hour the customer vouched for on this device passes", () => {
    const memory = new MemoryStore();
    memory.confirmWasMe(purchase(event(KNOWN, { hour: 2 })));
    const r = decideWith(memory, event("Groceries up to CHF 100 per order. Ask me before any purchase at night.", { hour: 2 }));
    expect(r.reason_codes).not.toContain("night_purchase");
  });
});

describe("the service: was-me, learn off", () => {
  const service = () => new LeashService({ api: new OfflinePlatform(pack), pack, engine: stubEngine, mode: "offline", worker: { pollWaitSeconds: 0 } });

  it("'Not me' pauses the card and marks the device; 'learn off' learns nothing from 'yes'", async () => {
    const s = service();
    const run = await s.startRun("SCEN0000");
    await s.waitForRun(run.run_id);
    const d = s.feed(run.run_id)[0]!;
    expect(d.device_id).toBeTruthy();

    s.setLearning(false);
    expect(s.wasMe(d.id, "yes").learned).toBe(false);
    expect(s.memoryView().shops).toEqual([]);

    s.setLearning(true);
    expect(s.wasMe(d.id, "yes").learned).toBe(true);
    expect(s.memoryView().shops.map((x) => x.merchant_id)).toContain(d.merchant.id);

    const no = s.wasMe(d.id, "no");
    expect(no.paused).toBe(true);
    expect(s.getLeash().status).toBe("paused");
    expect(s.memoryView().devices.find((x) => x.device_id === d.device_id)?.trusted).toBe(false);
    s.worker.stop();
  });
});
