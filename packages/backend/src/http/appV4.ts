import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import {
  scenarioAttempts,
  type AppCreateLeashRequest,
  type AppDecision,
  type AppFeedResponse,
  type AppLeash,
  type AppResolveRequest,
  type AppRuleValues,
  type AppSmart,
  type AppSuggestResponse,
  type AppTightenRequest,
  type LeashView,
  type Row,
  type UncertaintyPolicy,
} from "@leash/shared";
import { ServiceError, type LeashService } from "../leash/service.js";
import { analyzeCard, cardPurchases, DEFAULT_SMART, DEFAULT_VALUES, instructionFromCard, MONTH_DAYS, valuesFromLeash } from "../leash/cardLeash.js";
import type { LeashEvents, StoredDecision } from "../store.js";

// The v4 app contract (app-web, Kim's handover of 24 Sep) on top of LeashService. Served under /v4/app/*.
// Nothing here talks to Viseca; every call goes through the service, which owns the mandate and the store.
// What the app knows that the leash does not (night, learn) lives here, in memory, next to the leash.

export interface AppV4Options {
  /** Card history rows (live reference data). Offline the data pack's authorization_history.csv is read on first use. */
  history?: Row[];
  /** Card whose history "Rules from your shopping" analyses when no leash names one. Offline default: CA0039. */
  suggestCardId?: string;
  /** Scenario whose first purchase ends the analysis window (simulated time). Offline default: SCEN0004. */
  suggestScenarioId?: string;
}

const ASK_WINDOW_MS = 120_000;
const DEMO_CARD = "CA0039";
const DEMO_SCENARIO = "SCEN0004";

const statusOf = (view: LeashView): AppLeash["status"] => (view.status === "active" ? "active" : view.status === "paused" ? "paused" : "off");

export class AppV4 {
  private smart: AppSmart = { ...DEFAULT_SMART };
  private values: AppRuleValues = { ...DEFAULT_VALUES };
  private cardInstruction: string | null = null;
  private validUntil: string | null = null;
  private historyCache: Row[] | null = null;
  /** Decisions already sent on the stream; the bus repeats `decision` (token issued, ask answered) and the app must not. */
  private forwarded = new Set<string>();

  constructor(
    private readonly service: LeashService,
    private readonly opts: AppV4Options = {},
  ) {}

  // ── 1.3 Rules from your shopping ───────────────────────────────────────────────────────────────

  private history(): Row[] {
    if (this.opts.history) return this.opts.history;
    if (!this.historyCache) {
      this.historyCache = parse(readFileSync(join(this.service.pack.dir, "authorization_history.csv"), "utf8"), { columns: true, skip_empty_lines: true }) as Row[];
    }
    return this.historyCache;
  }

  suggest(cardId?: string, scenarioId?: string): AppSuggestResponse {
    const rows = this.history();
    const leashCard = this.service.getLeash().card?.id;
    const card = cardId ?? this.opts.suggestCardId ?? leashCard ?? (cardPurchases(rows, DEMO_CARD).length ? DEMO_CARD : busiestCard(rows));
    const scenario = scenarioId ?? this.opts.suggestScenarioId ?? (this.service.pack.scenarios.has(DEMO_SCENARIO) ? DEMO_SCENARIO : undefined);
    const firstAttempt = scenario ? scenarioAttempts(this.service.pack, scenario)[0]?.timestamp : undefined;
    const until = firstAttempt ? Date.parse(firstAttempt) : undefined;
    return analyzeCard(rows, card, { until: Number.isNaN(until) ? undefined : until });
  }

  // ── 1.4 Create, 3.1 / 6.1 read ─────────────────────────────────────────────────────────────────

  async createLeash(body: AppCreateLeashRequest): Promise<AppLeash> {
    const values = readValues(body.rules, this.values);
    const smart = { ...DEFAULT_SMART, ...pickSmart(body.smart) };
    const given = typeof body.instruction === "string" ? body.instruction.trim() : "";
    // The app may send its own sentence; we keep it only if our compiler reads both limits out of it.
    const instruction = given && this.readsLimits(given) ? given : instructionFromCard(values, smart);
    await this.setCard(instruction, values, smart, body.task_instruction?.trim() || null, readUntil(body.valid_until));
    return this.leash();
  }

  private readsLimits(instruction: string): boolean {
    try {
      const keys = new Set(this.service.parse(instruction).rules.map((r) => r.key));
      return keys.has("order_limit") && keys.has("period_budget");
    } catch {
      return false;
    }
  }

  /**
   * Creates (or re-creates) the card leash. If the agent's task is active, the task instruction stays and the
   * card rules travel with it; Viseca can't loosen a mandate, so the service revokes the old one and confirms a new one.
   */
  private async setCard(instruction: string, values: AppRuleValues, smart: AppSmart, taskInstruction: string | null, validUntil: string | null) {
    const policy: UncertaintyPolicy = smart.unsure === "decline" ? "decline" : "ask";
    const view = this.service.getLeash();
    const task = taskInstruction ?? (view.status === "active" || view.status === "paused" ? view.task?.instruction ?? null : null);
    if (task) {
      const cardRules = this.service.parse(instruction).rules;
      await this.service.createLeash({ instruction: task, confirmed: true, uncertainty_policy: policy, valid_until: validUntil }, { rules: cardRules, learned: view.learned_rules, uncertainty_policy: policy });
    } else {
      await this.service.createLeash({ instruction, confirmed: true, uncertainty_policy: policy, valid_until: validUntil });
    }
    this.cardInstruction = instruction;
    this.values = values;
    this.smart = smart;
    this.validUntil = validUntil;
    this.service.setLearning(smart.learn === "on");
  }

  leash(): AppLeash {
    const view = this.service.getLeash();
    const enforced = valuesFromLeash(view, this.values);
    return {
      mandate_id: view.mandate_id ?? "",
      status: statusOf(view),
      card_last4: view.card?.id.slice(-4) ?? "",
      instruction: this.cardInstruction ?? view.instruction ?? "",
      rules: { orderLimit: enforced.orderLimit, monthBudget: enforced.monthBudget },
      smart: {
        ...this.smart,
        night: enforcedNight(view) ?? this.smart.night,
        unsure: view.uncertainty_policy === "decline" ? "decline" : "ask",
        newShops: enforced.knownShopsOnly ? "known" : this.smart.newShops === "known" ? "ask" : this.smart.newShops,
      },
      learned: view.learned_rules.map((r) => ({ id: r.id, text: r.label, added_at: r.added_at ?? "" })),
      task: view.task ? { instruction: view.task.instruction, rules: view.task.rules.map((r) => ({ key: r.key, label: r.label, your_words: r.your_words?.text ?? "" })) } : null,
      month_spent_chf: view.budget?.spent_chf ?? 0,
      frees_up_at: view.budget?.next_release?.at ?? null,
      valid_until: view.valid_until,
    };
  }

  // ── 6.2 Tighten or loosen, block a shop ────────────────────────────────────────────────────────

  async tighten(body: AppTightenRequest): Promise<AppLeash> {
    const view = this.service.getLeash();
    if (view.status !== "active" && view.status !== "paused") throw new ServiceError(404, "no_leash", "There is no Agent Card yet.");
    const current = this.leash();
    const nextValues = readValues({ ...current.rules, ...(body.rules ?? {}) }, current.rules);
    const nextSmart: AppSmart = { ...current.smart, ...pickSmart(body.smart) };
    const nextUntil = body.valid_until === undefined ? current.valid_until : readUntil(body.valid_until);
    // No end → an end is tighter. An end → a later end, or no end, is looser.
    const untilChanged = nextUntil !== current.valid_until;
    const untilLooser = untilChanged && (nextUntil === null || (current.valid_until !== null && Date.parse(nextUntil) > Date.parse(current.valid_until)));

    const looser =
      nextValues.orderLimit > current.rules.orderLimit ||
      nextValues.monthBudget > current.rules.monthBudget ||
      (nextSmart.unsure === "ask" && current.smart.unsure === "decline") ||
      (nextSmart.newShops === "ask" && current.smart.newShops === "known") ||
      (nextSmart.night === "ask" && current.smart.night === "decline") ||
      untilLooser;
    if (looser && body.face_id_confirmed !== true) throw new ServiceError(403, "face_id_required", "Loosening a rule needs Face ID.");

    if (looser || (nextSmart.newShops === "known" && current.smart.newShops !== "known")) {
      // A looser rule (or a new "only known shops" rule) is a new mandate; the service revokes the old one.
      await this.setCard(instructionFromCard(nextValues, nextSmart), nextValues, nextSmart, null, nextUntil);
    } else {
      if (nextValues.orderLimit < current.rules.orderLimit) await this.service.tighten({ type: "lower_order_limit", value: nextValues.orderLimit });
      if (nextValues.monthBudget < current.rules.monthBudget) await this.service.tighten({ type: "lower_period_budget", value: nextValues.monthBudget, period_days: MONTH_DAYS });
      if (nextSmart.unsure === "decline" && current.smart.unsure !== "decline") await this.service.tighten({ type: "unsure_decline" });
      if (nextSmart.night === "decline" && current.smart.night !== "decline") await this.service.tighten({ type: "night_decline" });
      if (untilChanged && nextUntil !== null) await this.service.tighten({ type: "end_earlier", valid_until: nextUntil });
      this.values = nextValues;
      this.smart = nextSmart;
      this.validUntil = nextUntil;
      this.service.setLearning(nextSmart.learn === "on");
    }

    if (typeof body.block_shop === "string" && body.block_shop.trim()) {
      const shop = this.service.findMerchant(body.block_shop);
      if (!shop) throw new ServiceError(404, "shop_not_found", `No shop called ${body.block_shop}.`);
      await this.service.tighten({ type: "block_shop", merchant_id: shop.merchant_id, name: shop.name });
    }
    return this.leash();
  }

  async pause(): Promise<void> {
    this.service.pause(24);
  }

  /** Unfreeze: a loosening, so it needs Face ID. */
  async resume(body: { face_id_confirmed?: boolean }): Promise<AppLeash> {
    if (body?.face_id_confirmed !== true) throw new ServiceError(403, "face_id_required", "Unfreezing needs Face ID.");
    this.service.resume();
    return this.leash();
  }

  // ── 6.3 What we learned, 7.2 / 7.3 Was this you ────────────────────────────────────────────────

  /** yes trusts the device from now on (a loosening: Face ID). no pauses the card and never trusts the device again. */
  wasMe(id: string, body: { answer?: string; face_id_confirmed?: boolean }) {
    const answer = body?.answer === "yes" || body?.answer === "no" ? body.answer : null;
    if (!answer) throw new ServiceError(400, "invalid_answer", "Answer yes or no.");
    if (answer === "yes" && body.face_id_confirmed !== true) throw new ServiceError(403, "face_id_required", "Trusting this device needs Face ID.");
    const r = this.service.wasMe(id, answer);
    return { learned: r.learned, paused: r.paused, leash: this.leash() };
  }

  memory() {
    return this.service.memoryView();
  }

  forgetShop(merchantId: string) {
    return this.service.forgetShop(merchantId);
  }

  forgetDevice(deviceId: string) {
    return this.service.forgetDevice(deviceId);
  }

  /**
   * Unblock a shop: a loosening (Face ID). Memory lets go at once; the mandate's own "never buy from" rule can only
   * disappear with a new mandate, so the card is re-created with the same values (Viseca can't remove a rule).
   */
  async unblockShop(body: { merchant_id?: string; face_id_confirmed?: boolean }): Promise<AppLeash> {
    if (!body?.merchant_id) throw new ServiceError(400, "merchant_required", "Which shop?");
    if (body.face_id_confirmed !== true) throw new ServiceError(403, "face_id_required", "Unblocking a shop needs Face ID.");
    const inMemory = this.service.unblockShopInMemory(body.merchant_id);
    const view = this.service.getLeash();
    const inMandate = [...view.rules, ...view.learned_rules].some((r) => r.hard_rule?.field === "merchant.merchant_id" && Array.isArray(r.hard_rule.value) && r.hard_rule.value.includes(body.merchant_id as string));
    if (!inMemory && !inMandate) throw new ServiceError(404, "not_blocked", `${body.merchant_id} is not blocked.`);
    if (inMandate) {
      const current = this.leash();
      await this.setCard(instructionFromCard(current.rules, current.smart), current.rules, current.smart, null, current.valid_until);
    }
    return this.leash();
  }

  async revoke(): Promise<void> {
    if (this.service.getLeash().status === "none") return;
    await this.service.revoke();
  }

  // ── 3.1 feed, 5.2 details, 4.1 asks ────────────────────────────────────────────────────────────

  feed(): AppFeedResponse {
    const rows = this.service.feed();
    return {
      decisions: rows.filter((d) => d.status !== "waiting_for_you").map((d) => this.toDecision(d)),
      asks: rows.filter((d) => d.status === "waiting_for_you").map((d) => this.toDecision(d)),
    };
  }

  decision(id: string): AppDecision {
    return this.toDecision(this.service.decision(id));
  }

  async resolve(id: string, body: AppResolveRequest): Promise<void> {
    if (body.decision === "approve" && body.face_id_confirmed !== true) throw new ServiceError(403, "face_id_required", "Approving a purchase needs Face ID.");
    await this.service.resolve(id, body.decision);
  }

  /** `id` is the decision the customer answered (the app's view); the suggestion id is also accepted. */
  async acceptSuggestion(id: string): Promise<void> {
    if (id.startsWith("sg_")) {
      await this.service.acceptSuggestion(id);
      return;
    }
    const d = this.service.decision(id);
    if (!d.suggestion) throw new ServiceError(404, "no_suggestion", `No learned rule was offered for ${id}.`);
    await this.service.acceptSuggestion(d.suggestion.id);
  }

  /** Demo control: the scenario becomes the agent's task on top of the card rules (stricter wins). */
  async startRun(scenarioId: string) {
    return this.service.startRun(scenarioId, false, true);
  }

  /**
   * The app's Decision: `created_at` is the (simulated) purchase time. An ask the customer already answered is shown
   * as the answer, not as a question, so reloading the feed never reopens it. Burst declines share a group id.
   */
  toDecision(d: StoredDecision): AppDecision {
    const scenario = this.service.scenarioOfRun(d.run_id);
    const attempt = this.service.pack.attempts.get(d.source_authorization_id);
    const decision: AppDecision["decision"] =
      d.status === "approved_by_you" ? "approve" : d.status === "declined_by_you" || d.status === "expired" ? "decline" : d.decision;
    const burst = d.decision === "decline" && d.reason_codes.includes("session_not_you");
    return {
      id: d.id,
      ...(scenario ? { scenario_id: scenario } : {}),
      ...(attempt?.replay_order ? { replay_order: Number(attempt.replay_order) } : {}),
      created_at: d.purchased_at,
      decision,
      status: d.status,
      reason_codes: d.reason_codes,
      headline: d.headline,
      because: d.because,
      checks: d.checks,
      uncertainty: d.uncertainty,
      shop_text_quarantine: d.shop_text_quarantine,
      amount: d.amount,
      merchant: d.merchant,
      items: d.items,
      ...(d.device_id ? { device_id: d.device_id } : {}),
      group_id: d.group_id ?? (burst ? `${d.run_id}:burst` : null),
      ...(d.deadline_at ? { deadline_at: d.deadline_at } : {}),
      ...(d.suggestion ? { suggestion: d.suggestion } : {}),
      actions: d.actions,
    };
  }

  // ── /v4/app/stream ─────────────────────────────────────────────────────────────────────────────

  /** One SSE frame in the app's envelopes, or null when the app must not hear this event. */
  streamFrame<K extends keyof LeashEvents>(event: K, payload: LeashEvents[K][0]): string | null {
    const frame = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    switch (event) {
      case "decision": {
        const d = payload as StoredDecision;
        // Asks travel as `ask`; answers are the app's own doing (RESOLVE_ASK); a re-emit (token issued) is the same row.
        if (d.decision === "step_up" || this.forwarded.has(d.id)) return null;
        this.forwarded.add(d.id);
        return frame("decision", { decision: this.toDecision(d) });
      }
      case "ask": {
        const d = payload as StoredDecision;
        if (this.forwarded.has(d.id)) return null;
        this.forwarded.add(d.id);
        const deadline = d.deadline_at ?? d.human_deadline_at ?? new Date(Date.now() + ASK_WINDOW_MS).toISOString();
        return frame("ask", { decision: this.toDecision(d), deadline_at: deadline });
      }
      case "ask_expired":
        return frame("ask_expired", { id: (payload as StoredDecision).id });
      case "leash_changed":
        return frame("leash_changed", { leash: this.leash() });
      default:
        return null;
    }
  }
}

/** The night rule the leash enforces ("decline" / "ask"), or null when it has none. */
function enforcedNight(view: LeashView): AppSmart["night"] | null {
  const rule = [...view.rules, ...view.learned_rules].find((r) => r.hard_rule?.field === "authorization.night");
  const v = rule?.hard_rule?.value;
  return v === "decline" || v === "ask" ? v : null;
}

function busiestCard(rows: Row[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.status === "approved" && r.transaction_type === "purchase") counts.set(r.card_id as string, (counts.get(r.card_id as string) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? DEMO_CARD;
}

/** `valid_until` from the app: null or missing = no end; a string must be a readable instant. */
function readUntil(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const ms = typeof v === "string" ? Date.parse(v) : Number.NaN;
  if (Number.isNaN(ms)) throw new ServiceError(400, "invalid_date", "valid_until must be an ISO date.");
  return new Date(ms).toISOString();
}

function readValues(given: Partial<AppRuleValues> | undefined, fallback: AppRuleValues): AppRuleValues {
  const num = (v: unknown, name: string, dflt: number) => {
    if (v === undefined || v === null) return dflt;
    const n = typeof v === "number" || typeof v === "string" ? Number(v) : Number.NaN;
    if (!(n > 0)) throw new ServiceError(400, "invalid_limit", `${name} must be a positive amount.`);
    return n;
  };
  return { orderLimit: num(given?.orderLimit, "orderLimit", fallback.orderLimit), monthBudget: num(given?.monthBudget, "monthBudget", fallback.monthBudget) };
}

const SMART_OPTIONS: { [K in keyof AppSmart]: readonly AppSmart[K][] } = {
  unsure: ["ask", "decline"],
  night: ["decline", "ask"],
  newShops: ["ask", "known"],
  learn: ["on", "off"],
};

/** Only known keys with known values; anything else is ignored rather than stored. */
function pickSmart(given: Partial<AppSmart> | undefined): Partial<AppSmart> {
  const out: Partial<AppSmart> = {};
  if (!given || typeof given !== "object") return out;
  for (const key of Object.keys(SMART_OPTIONS) as (keyof AppSmart)[]) {
    const v = given[key];
    if (v !== undefined && (SMART_OPTIONS[key] as readonly string[]).includes(v as string)) (out as Record<string, string>)[key] = v as string;
  }
  return out;
}
