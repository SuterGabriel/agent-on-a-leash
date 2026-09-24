import {
  approvedPurchasesByMerchant,
  approvedPurchasesByMerchantFromRows,
  BUILT_IN_PROTECTIONS,
  RULE_FIELDS,
  RULE_KEYS,
  scenarioAttempts,
  type CreateLeashRequest,
  type DataPack,
  type EngineVerdict,
  type KnownShop,
  type LeashRule,
  type LeashView,
  type Budget,
  type ChargeResult,
  type DecisionToken,
  type ParseResult,
  type Row,
  type Suggestion,
  type TightenRequest,
  type UncertaintyPolicy,
} from "@leash/shared";
import { applyAnswers, compile, QUESTION_IDS, toMandateDraft } from "../compiler/compile.js";
import type { Engine } from "../engine/port.js";
import { resolveAsk } from "../asks.js";
import { InMemoryDecisionStore, LeashBus, type DecisionStore, type StoredDecision } from "../store.js";
import { Worker, type WorkerOptions } from "../worker.js";
import { VisecaError, type MandateDraftRequest, type VisecaApi } from "../viseca/api.js";
import { computeBudget } from "./budget.js";
import { LEARNS_SHOP_ON_APPROVE, suggestionFor } from "./suggestions.js";
import { TokenVault } from "../tokens/vault.js";

/** Errors the HTTP layer turns into status codes. */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Creates a mandate draft. Viseca's format for guidance/open_questions is undocumented;
 * if it rejects them (422), the leash is created without them rather than not at all.
 */
export async function createMandateSafely(api: VisecaApi, draft: MandateDraftRequest) {
  try {
    return await api.createMandate(draft);
  } catch (err) {
    if (err instanceof VisecaError && err.status === 422 && (draft.guidance.length > 0 || draft.open_questions.length > 0)) {
      return await api.createMandate({ ...draft, guidance: [], open_questions: [] });
    }
    throw err;
  }
}

interface LeashState {
  mandate_id: string;
  parsed: ParseResult;
  answers: Record<string, string>;
  rules: LeashRule[];
  learned: LeashRule[];
  uncertainty_policy: UncertaintyPolicy;
  revoked: boolean;
  paused_until: number | null;
  card_id: string | null;
  /** Shops that became known through the customer's approvals. */
  learned_shops: Map<string, { name: string; count: number }>;
}

interface RunRecord {
  run_id: string;
  scenario_id: string;
  mandate_id: string;
  state: "running" | "finished" | "failed";
  error?: string;
  started_at: string;
}

export interface LeashServiceOptions {
  api: VisecaApi;
  pack: DataPack;
  engine: Engine;
  mode: "offline" | "live";
  worker?: WorkerOptions;
  store?: DecisionStore;
  tokens?: TokenVault;
  /** Live mode: the live scenario catalogue (its IDs differ from the local pack). */
  scenarios?: ScenarioInfo[];
  /** Live mode: the live card history, for known shops. */
  historyRows?: Row[];
  log?: (line: string) => void;
}

export interface ScenarioInfo {
  scenario_id: string;
  scenario_name: string;
  cardholder_instruction: string;
  event_count: number;
}

/**
 * The engine names its checks after its guards; the leash names rules after what the customer said.
 * This map lets the backend put the customer's own words on each check.
 */
export const CHECK_TO_RULE: Record<string, string> = {
  per_order_limit: RULE_KEYS.order_limit,
  period_budget: RULE_KEYS.period_budget,
  item_scope: RULE_KEYS.purpose,
  requested_item: RULE_KEYS.requested_item,
  addon: RULE_KEYS.no_extras,
  return_terms: RULE_KEYS.return_window,
  merchant_type: RULE_KEYS.merchant_type,
  familiarity: RULE_KEYS.known_shop,
  session: RULE_KEYS.session,
};

const APPROVED = new Set(["approved", "approved_by_you"]);

/** Everything the app API needs: the current leash, runs, decisions, asks and suggestions. In memory. */
export class LeashService {
  readonly store: DecisionStore;
  readonly bus = new LeashBus();
  readonly worker: Worker;
  readonly tokens: TokenVault;
  private leash: LeashState | null = null;
  private runs = new Map<string, RunRecord>();
  private suggestions = new Map<string, Suggestion>();
  /** Approvals on their way to Viseca: decision id → CHF. Counted against the budget until they land. */
  private approving = new Map<string, number>();
  private historyCache = new Map<string, Map<string, { name: string; count: number }>>();
  private seq = 0;
  private readonly api: VisecaApi;
  private readonly pack: DataPack;
  private readonly inner: Engine;
  private readonly log: (line: string) => void;
  private readonly scenarioList: Map<string, ScenarioInfo>;
  private readonly historyRows: Row[] | null;
  readonly mode: "offline" | "live";

  constructor(opts: LeashServiceOptions) {
    this.api = opts.api;
    this.pack = opts.pack;
    this.inner = opts.engine;
    this.mode = opts.mode;
    this.log = opts.log ?? (() => {});
    this.scenarioList = new Map((opts.scenarios ?? [...this.pack.scenarios.values()]).map((sc) => [sc.scenario_id, sc]));
    this.historyRows = opts.historyRows ?? null;
    this.store = opts.store ?? new InMemoryDecisionStore();
    this.tokens = opts.tokens ?? new TokenVault();
    this.worker = new Worker(this.api, this.leashEngine(), this.store, this.bus, { log: this.log, ...opts.worker });
    this.bus.on("decision", (d) => this.afterDecision(d));
  }

  private nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  // ── Engine wrapper: pause, and the customer's words on every check ─────────────────────────────

  private leashEngine(): Engine {
    return {
      version: this.inner.version,
      decide: async (event, ctx): Promise<EngineVerdict> => {
        const leash = this.leash;
        if (leash && leash.mandate_id === event.mandate.mandate_id && this.isPaused(leash)) {
          const until = new Date(leash.paused_until as number).toISOString();
          return {
            decision: "decline",
            reason_codes: ["leash_paused"],
            headline: "Declined · Leash paused",
            because: `Your leash is paused until ${until}, so nothing is bought.`,
            checks: [],
            uncertainty: [],
            shop_text_quarantine: null,
            engine_version: this.inner.version,
          };
        }
        // Live scenarios don't say which card they use; the first purchase does.
        if (leash && !leash.card_id && leash.mandate_id === event.mandate.mandate_id) leash.card_id = event.authorization.card_id;
        const verdict = await this.inner.decide(event, ctx);
        // The engine returns rule keys; the customer's own words live only in our store.
        const rules = leash ? [...leash.rules, ...leash.learned] : [];
        return {
          ...verdict,
          checks: verdict.checks.map((c) => {
            if (c.your_words !== null || c.source === "built_in") return c;
            const key = CHECK_TO_RULE[c.key] ?? c.key;
            return { ...c, your_words: rules.find((r) => r.key === key)?.your_words?.text ?? null };
          }),
        };
      },
    };
  }

  private isPaused(leash: LeashState) {
    return leash.paused_until !== null && Date.now() < leash.paused_until;
  }

  // ── S1–S3: parse and confirm ───────────────────────────────────────────────────────────────────

  parse(instruction: string): ParseResult {
    if (!instruction?.trim()) throw new ServiceError(400, "instruction_required", "Tell your agent what it may buy.");
    return compile(instruction);
  }

  async createLeash(req: CreateLeashRequest): Promise<LeashView> {
    if (!req.confirmed) throw new ServiceError(400, "confirmation_required", "Confirm with Face ID to activate the leash.");
    const parsed = this.parse(req.instruction);
    const answers = req.answers ?? {};
    const rules = applyAnswers(parsed, answers);
    const uncertainty = req.uncertainty_policy ?? parsed.uncertainty_policy;

    // Loosening = a new leash. The old one is revoked first so only one leash is ever active.
    if (this.leash && !this.leash.revoked) {
      await this.api.revokeMandate(this.leash.mandate_id).catch((err: Error) => this.log(`revoking previous leash failed: ${err.message}`));
    }
    const draft = await createMandateSafely(this.api, toMandateDraft(parsed, rules, answers, uncertainty));
    const { mandate_id } = await this.api.confirmMandate(draft.draft_id);
    this.leash = {
      mandate_id,
      parsed,
      answers,
      rules,
      learned: [],
      uncertainty_policy: uncertainty,
      revoked: false,
      paused_until: null,
      card_id: null,
      learned_shops: new Map(),
    };
    this.worker.invalidateMandate(mandate_id);
    this.bus.emit("leash_changed", { mandate_id });
    return this.getLeash();
  }

  private requireLeash(): LeashState {
    if (!this.leash) throw new ServiceError(404, "no_leash", "There is no leash yet.");
    return this.leash;
  }

  private requireActive(): LeashState {
    const leash = this.requireLeash();
    if (leash.revoked) throw new ServiceError(409, "leash_revoked", "This leash is revoked. Start a new leash.");
    return leash;
  }

  // ── S4 / S7: the leash as the app shows it ─────────────────────────────────────────────────────

  getLeash(): LeashView {
    const leash = this.leash;
    if (!leash) {
      return {
        status: "none",
        token: "off",
        mandate_id: null,
        instruction: null,
        card: null,
        rules: [],
        learned_rules: [],
        built_in: BUILT_IN_PROTECTIONS,
        uncertainty_policy: "ask",
        budget: null,
        known_shops: [],
        suggestions: [],
        paused_until: null,
      };
    }
    const status = leash.revoked ? "revoked" : this.isPaused(leash) ? "paused" : "active";
    const card = leash.card_id ? this.pack.cards.get(leash.card_id) : undefined;
    return {
      status,
      token: status === "active" ? "on" : "off",
      mandate_id: leash.mandate_id,
      instruction: leash.parsed.instruction,
      // Live cards (e.g. CA1331) are not in the local card table; show them anyway, without the type.
      card: leash.card_id
        ? { id: leash.card_id, label: `${card ? (card.card_type === "credit" ? "Credit card" : "Debit card") : "Card"} •• ${leash.card_id.slice(-4)}` }
        : null,
      rules: leash.rules,
      learned_rules: leash.learned,
      built_in: BUILT_IN_PROTECTIONS,
      uncertainty_policy: leash.uncertainty_policy,
      budget: this.budget(leash),
      known_shops: this.knownShops(leash),
      suggestions: [...this.suggestions.values()].filter((s) => s.status === "open"),
      paused_until: status === "paused" ? new Date(leash.paused_until as number).toISOString() : null,
    };
  }

  /** The tightest period budget, or null if the leash has none. */
  private budget(leash: LeashState): Budget | null {
    const period = [...leash.rules, ...leash.learned].filter((r) => r.hard_rule?.scope === "period");
    const tightest = period.sort((a, b) => Number(a.hard_rule!.value) - Number(b.hard_rule!.value))[0];
    return tightest ? computeBudget(Number(tightest.hard_rule!.value), tightest.hard_rule!.period_days ?? 7, this.leashDecisions()) : null;
  }

  private leashDecisions(): StoredDecision[] {
    const mandate = this.leash?.mandate_id;
    const runIds = new Set([...this.runs.values()].filter((r) => r.mandate_id === mandate).map((r) => r.run_id));
    return this.store.list().filter((d) => runIds.has(d.run_id));
  }

  private knownShops(leash: LeashState): KnownShop[] {
    const history = leash.card_id ? this.history(leash.card_id) : new Map<string, { name: string; count: number }>();
    const shops = new Map<string, KnownShop>();
    for (const [id, h] of history) shops.set(id, { merchant_id: id, name: h.name, times_used: h.count, new: false });
    for (const [id, l] of leash.learned_shops) {
      const prev = shops.get(id);
      shops.set(id, prev ? { ...prev, times_used: prev.times_used + l.count } : { merchant_id: id, name: l.name, times_used: l.count, new: true });
    }
    return [...shops.values()].sort((a, b) => Number(b.new) - Number(a.new) || b.times_used - a.times_used);
  }

  private history(cardId: string) {
    let h = this.historyCache.get(cardId);
    if (!h) {
      h = this.historyRows ? approvedPurchasesByMerchantFromRows(this.historyRows, cardId) : approvedPurchasesByMerchant(this.pack.dir, cardId);
      this.historyCache.set(cardId, h);
    }
    return h;
  }

  // ── S8 / S9: tighten, pause, revoke ────────────────────────────────────────────────────────────

  async tighten(req: TightenRequest): Promise<LeashView> {
    const leash = this.requireActive();
    const now = new Date().toISOString();
    if (req.type === "unsure_decline") {
      if (leash.uncertainty_policy !== "decline") {
        await this.api.patchMandate(leash.mandate_id, { uncertainty_policy: "decline" });
        leash.uncertainty_policy = "decline";
      }
    } else {
      const rule = this.tightenRule(leash, req, now);
      await this.addHardRule(leash, rule);
      if (req.type === "lower_order_limit") leash.rules = leash.rules.filter((r) => r.key !== RULE_KEYS.order_limit);
      leash.rules.push(rule);
    }
    this.worker.invalidateMandate(leash.mandate_id);
    this.bus.emit("leash_changed", { mandate_id: leash.mandate_id });
    return this.getLeash();
  }

  private tightenRule(leash: LeashState, req: Exclude<TightenRequest, { type: "unsure_decline" }>, now: string): LeashRule {
    const base = { source: "you" as const, your_words: null, added_at: now };
    if (req.type === "lower_order_limit") {
      const value = Number(req.value);
      const current = leash.rules.filter((r) => r.key === RULE_KEYS.order_limit).map((r) => Number(r.hard_rule?.value));
      if (!(value > 0)) throw new ServiceError(400, "invalid_limit", "The limit must be a positive amount.");
      if (current.length > 0 && value >= Math.min(...current)) throw new ServiceError(400, "not_tighter", "That would loosen your leash. Start a new leash to loosen it.");
      return { ...base, id: this.nextId("r_order_limit"), key: RULE_KEYS.order_limit, label: `Each order CHF ${value} or less`, group: "limits", hard_rule: { field: RULE_FIELDS.amount, operator: "<=", value, currency: "CHF", scope: "purchase" } };
    }
    if (req.type === "block_shop") {
      if (!req.merchant_id) throw new ServiceError(400, "merchant_required", "Which shop should be blocked?");
      const name = req.name ?? this.pack.merchants.get(req.merchant_id)?.merchant_name ?? req.merchant_id;
      return { ...base, id: this.nextId("r_blocked_shop"), key: RULE_KEYS.blocked_shop, label: `Never buy from ${name}`, group: "restrictions", hard_rule: { field: RULE_FIELDS.merchantId, operator: "not_in", value: [req.merchant_id] } };
    }
    if (req.type === "block_category") {
      if (!req.category) throw new ServiceError(400, "category_required", "Which category should be blocked?");
      return { ...base, id: this.nextId("r_blocked_category"), key: RULE_KEYS.blocked_category, label: `Never buy ${req.category.replace(/_/g, " ")}`, group: "restrictions", hard_rule: { field: RULE_FIELDS.itemCategory, operator: "not_in", value: [req.category] } };
    }
    throw new ServiceError(400, "unknown_tighten", "Unknown way to tighten.");
  }

  /** Viseca only accepts a PATCH that keeps every existing rule, so we append to what it has stored. */
  private async addHardRule(leash: LeashState, rule: LeashRule) {
    if (!rule.hard_rule) return;
    const current = await this.api.getMandate(leash.mandate_id);
    await this.api.patchMandate(leash.mandate_id, { hard_rules: [...current.hard_rules, rule.hard_rule] });
  }

  pause(hours = 24): LeashView {
    const leash = this.requireActive();
    if (!(hours > 0 && hours <= 24 * 7)) throw new ServiceError(400, "invalid_pause", "Pause for up to 7 days.");
    leash.paused_until = Date.now() + hours * 3600 * 1000;
    this.bus.emit("leash_changed", { mandate_id: leash.mandate_id });
    return this.getLeash();
  }

  resume(): LeashView {
    const leash = this.requireActive();
    leash.paused_until = null;
    this.bus.emit("leash_changed", { mandate_id: leash.mandate_id });
    return this.getLeash();
  }

  /** `keepTokenOf`: a decision whose token survives (a one-item leash closing right after its purchase). */
  async revoke(keepTokenOf?: string): Promise<LeashView> {
    const leash = this.requireLeash();
    if (!leash.revoked) {
      await this.api.revokeMandate(leash.mandate_id);
      leash.revoked = true;
      // Pending asks stay as they are: Viseca has not specified what revoking does to them, so we don't fake a cancellation.
      // Tokens the agent hasn't used yet stop working at once.
      for (const t of this.tokens.revokeActive(keepTokenOf)) this.bus.emit("token", t);
      this.bus.emit("leash_changed", { mandate_id: leash.mandate_id });
    }
    return this.getLeash();
  }

  // ── S4 / S5 / S6: feed, decision card, asks ────────────────────────────────────────────────────

  feed(runId?: string): StoredDecision[] {
    const rows = runId ? this.store.list(runId) : this.store.list();
    return rows.sort((a, b) => b.purchased_at.localeCompare(a.purchased_at) || b.decided_at.localeCompare(a.decided_at));
  }

  decision(id: string): StoredDecision {
    const d = this.store.get(id);
    if (!d) throw new ServiceError(404, "decision_not_found", `No purchase ${id}.`);
    return d;
  }

  asks(): StoredDecision[] {
    return this.feed().filter((d) => d.status === "waiting_for_you");
  }

  async resolve(id: string, answer: "approve" | "decline", acceptSuggestion = false, overBudgetOk = false): Promise<StoredDecision> {
    if (answer !== "approve" && answer !== "decline") throw new ServiceError(400, "invalid_answer", "Answer approve or decline.");
    const reserved = answer === "approve" ? this.reserveBudget(id, overBudgetOk) : false;
    let d: StoredDecision;
    try {
      d = await resolveAsk(this.api, this.store, this.bus, id, answer);
    } finally {
      if (reserved) this.approving.delete(id);
    }
    if (answer === "decline") {
      const purpose = this.leash?.rules.filter((r) => r.key === RULE_KEYS.purpose).flatMap((r) => (Array.isArray(r.hard_rule?.value) ? r.hard_rule.value : [])) ?? [];
      const draft = suggestionFor(d, purpose);
      if (draft && !this.alreadyHasRule(draft.rule)) {
        const s: Suggestion = { id: this.nextId("sg"), decision_id: d.id, status: "open", ...draft };
        this.suggestions.set(s.id, s);
        d.suggestion = { id: s.id, text: s.text };
        this.store.save(d);
        this.bus.emit("decision", d);
        if (acceptSuggestion) await this.acceptSuggestion(s.id);
      }
    }
    return this.store.get(id) as StoredDecision;
  }

  /**
   * Each ask fit the budget when it was checked, but two approved together may not. Re-checked at the moment
   * of approval, counting approvals still on their way to Viseca; check and reservation run before any await,
   * so two taps at once can't both see the same money left. Returns whether something was reserved.
   */
  private reserveBudget(id: string, overBudgetOk: boolean): boolean {
    const d = this.store.get(id);
    const budget = this.leash ? this.budget(this.leash) : null;
    if (!d || d.status !== "waiting_for_you" || !budget || this.approving.has(id)) return false; // resolveAsk reports these
    const inFlight = [...this.approving.values()].reduce((s, chf) => s + chf, 0);
    const left = Math.round((budget.left_chf - inFlight) * 100) / 100;
    const over = Math.round((d.amount.chf - left) * 100) / 100;
    if (over > 0 && !overBudgetOk) {
      throw new ServiceError(409, "over_budget", `This puts you CHF ${over.toFixed(2)} over your ${budget.period_days}-day budget (CHF ${Math.max(0, left).toFixed(2)} left). Approve again to buy it anyway.`);
    }
    this.approving.set(id, d.amount.chf);
    return true;
  }

  private alreadyHasRule(rule: Suggestion["rule"]) {
    const all = this.leash ? [...this.leash.rules, ...this.leash.learned] : [];
    return all.some((r) => JSON.stringify(r.hard_rule) === JSON.stringify(rule));
  }

  async acceptSuggestion(id: string): Promise<LeashView> {
    const s = this.suggestions.get(id);
    if (!s) throw new ServiceError(404, "suggestion_not_found", `No suggestion ${id}.`);
    if (s.status !== "open") throw new ServiceError(409, "suggestion_closed", `This suggestion is already ${s.status}.`);
    const leash = this.requireActive();
    const rule: LeashRule = {
      id: this.nextId("r_learned"),
      key: `learned_${s.reason_code}`,
      label: s.text,
      group: "restrictions",
      source: "learned",
      your_words: null,
      hard_rule: s.rule,
      added_at: new Date().toISOString(),
    };
    await this.addHardRule(leash, rule);
    leash.learned.push(rule);
    s.status = "accepted";
    this.worker.invalidateMandate(leash.mandate_id);
    this.bus.emit("leash_changed", { mandate_id: leash.mandate_id });
    return this.getLeash();
  }

  dismissSuggestion(id: string): LeashView {
    const s = this.suggestions.get(id);
    if (!s) throw new ServiceError(404, "suggestion_not_found", `No suggestion ${id}.`);
    if (s.status === "open") s.status = "dismissed";
    return this.getLeash();
  }

  /** Memory grows only through approvals; one-item leashes close after the first approval. */
  private afterDecision(d: StoredDecision) {
    const leash = this.leash;
    if (!leash || leash.revoked || !APPROVED.has(d.status)) return;
    if (!this.leashDecisions().some((x) => x.id === d.id)) return;
    if (d.token) return; // this decision was handled already
    if (d.status === "approved_by_you" && d.reason_codes.some((c) => LEARNS_SHOP_ON_APPROVE.has(c))) {
      const prev = leash.learned_shops.get(d.merchant.id);
      leash.learned_shops.set(d.merchant.id, { name: d.merchant.name, count: (prev?.count ?? 0) + 1 });
    }
    this.issueToken(leash, d);
    if (/^y(es)?$/i.test(leash.answers[QUESTION_IDS.closeAfterFirst] ?? "")) {
      void this.revoke(d.id).catch((err: Error) => this.log(`closing leash after first item failed: ${err.message}`));
    }
  }

  // ── Decision-bound tokens (demo) ───────────────────────────────────────────────────────────────

  /** After an approval the agent gets a token for exactly this purchase, capped by the leash's own limits. */
  private issueToken(leash: LeashState, d: StoredDecision) {
    const limits = [...leash.rules, ...leash.learned].filter((r) => r.key === RULE_KEYS.order_limit).map((r) => Number(r.hard_rule?.value));
    const token = this.tokens.issue({
      decision_id: d.id,
      merchant_id: d.merchant.id,
      merchant_name: d.merchant.name,
      approved_chf: d.amount.chf,
      order_limit_chf: limits.length ? Math.min(...limits) : null,
      budget_left_chf: this.getLeash().budget?.left_chf ?? null,
    });
    d.token = token;
    this.store.save(d);
    this.bus.emit("token", token);
    this.bus.emit("decision", d);
  }

  listTokens(): DecisionToken[] {
    return this.tokens.list().sort((a, b) => b.history[0]!.at.localeCompare(a.history[0]!.at));
  }

  token(id: string): DecisionToken {
    const t = this.tokens.get(id);
    if (!t) throw new ServiceError(404, "token_not_found", `No token ${id}.`);
    return t;
  }

  /**
   * Simulates the merchant charging a token. Defaults to the bound shop and the approved amount;
   * override to show what a fooled agent can't do: pay elsewhere, more, later (`later: true`), or twice.
   */
  demoCharge(id: string, opts: { merchant_id?: string; amount_chf?: number; later?: boolean } = {}): ChargeResult {
    const t = this.token(id);
    const amount = opts.amount_chf ?? t.approved_chf;
    if (!(amount > 0)) throw new ServiceError(400, "invalid_amount", "The amount must be positive.");
    const at = opts.later ? Date.parse(t.expires_at) + 1_000 : Date.now();
    const merchantId = opts.merchant_id ?? t.merchant_id;
    const result = this.tokens.charge(id, merchantId, amount, at, this.pack.merchants.get(merchantId)?.merchant_name ?? merchantId);
    if (result.token) this.bus.emit("token", result.token);
    return result;
  }

  demoRefund(id: string, amountChf?: number): ChargeResult {
    const t = this.token(id);
    const result = this.tokens.refund(id, amountChf ?? t.charged_chf);
    if (result.token) this.bus.emit("token", result.token);
    return result;
  }

  // ── Demo control and judge view ────────────────────────────────────────────────────────────────

  async startRun(scenarioId: string, useCurrentLeash = false): Promise<RunRecord> {
    const scenario = this.scenarioList.get(scenarioId);
    if (!scenario) throw new ServiceError(404, "scenario_not_found", `No scenario ${scenarioId}.`);
    const running = [...this.runs.values()].find((r) => r.state === "running");
    if (running) throw new ServiceError(409, "run_in_progress", `Run ${running.run_id} is still running.`);
    if (!useCurrentLeash) await this.createLeash({ instruction: scenario.cardholder_instruction, confirmed: true });
    const leash = this.requireActive();
    // Offline the data pack knows the scenario's card; live it is read from the first purchase.
    leash.card_id = scenarioAttempts(this.pack, scenarioId)[0]?.card_id ?? null;

    const run = await this.api.startRun({ scenario_id: scenarioId, mandate_id: leash.mandate_id });
    const record: RunRecord = { run_id: run.run_id, scenario_id: scenarioId, mandate_id: leash.mandate_id, state: "running", started_at: new Date().toISOString() };
    this.runs.set(run.run_id, record);
    void this.worker
      .runUntilDone(run.run_id, { expectedEvents: scenario.event_count, maxIdlePolls: this.mode === "live" ? 20 : 5 })
      .then(() => {
        record.state = "finished";
      })
      .catch((err: Error) => {
        record.state = "failed";
        record.error = err.message;
        this.log(`run ${run.run_id} failed: ${err.message}`);
      });
    return record;
  }

  /** Resolves once the worker has no automated work left in this run (tests and scripts). */
  async waitForRun(runId: string, timeoutMs = 30_000): Promise<RunRecord> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const r = this.runs.get(runId);
      if (!r) throw new ServiceError(404, "run_not_found", `No run ${runId}.`);
      if (r.state !== "running") return r;
      await new Promise((res) => setTimeout(res, 20));
    }
    throw new ServiceError(504, "run_timeout", `Run ${runId} did not finish in time.`);
  }

  async status() {
    const runs = [...this.runs.values()].sort((a, b) => b.started_at.localeCompare(a.started_at));
    const latest = runs[0];
    let platform: unknown = null;
    if (latest) platform = await this.api.getRun(latest.run_id).then((r) => ({ status: r.status, counters: r.counters })).catch((err: Error) => ({ error: err.message }));
    return { mode: this.mode, engine_version: this.inner.version, leash: this.getLeash().status, latest_run: latest ? { ...latest, platform } : null, runs };
  }

  scenarios(): ScenarioInfo[] {
    return [...this.scenarioList.values()];
  }

  judge(runId?: string) {
    const runs = [...this.runs.values()].sort((a, b) => b.started_at.localeCompare(a.started_at));
    const run = runId ? this.runs.get(runId) : runs[0];
    if (!run) return { run: null, summary: null, rows: [] };
    const rows = this.store.list(run.run_id).sort((a, b) => a.purchased_at.localeCompare(b.purchased_at));
    const orderLimits = (this.leash?.mandate_id === run.mandate_id ? this.leash.rules : [])
      .filter((r) => r.key === RULE_KEYS.order_limit)
      .map((r) => Number(r.hard_rule?.value));
    const limit = orderLimits.length ? Math.min(...orderLimits) : null;
    const latencies = rows.map((d) => d.latency_ms).sort((a, b) => a - b);
    const median = latencies.length ? (latencies[Math.floor((latencies.length - 1) / 2)]! + latencies[Math.ceil((latencies.length - 1) / 2)]!) / 2 : null;
    return {
      run,
      summary: {
        engine_version: this.inner.version,
        model: "off",
        approved: rows.filter((d) => d.decision === "approve").length,
        asked: rows.filter((d) => d.decision === "step_up").length,
        declined: rows.filter((d) => d.decision === "decline").length,
        median_ms: median,
        deadline_misses: rows.filter((d) => d.deadline_missed).length,
        post_failures: rows.filter((d) => d.post_status === "post_failed").length,
        rules: this.leash?.mandate_id === run.mandate_id ? [...this.leash.rules, ...this.leash.learned].map((r) => r.label) : [],
      },
      rows: rows.map((d, i) => ({
        n: i + 1,
        id: d.id,
        source_authorization_id: d.source_authorization_id,
        purchase: d.items.map((it) => it.name).join(", "),
        shop: d.merchant.name,
        chf: d.amount.chf,
        decision: d.decision,
        reasons: d.reason_codes,
        message: d.because,
        model: "off",
        ms: d.latency_ms,
        margin_chf: limit === null ? null : Math.round((limit - d.amount.chf) * 100) / 100,
        final_status: d.status,
        checks: d.checks,
        shop_text_quarantine: d.shop_text_quarantine,
        deadline_missed: d.deadline_missed,
        token: d.token ? { id: d.token.id, status: d.token.status, max_chf: d.token.max_chf } : null,
      })),
    };
  }
}
