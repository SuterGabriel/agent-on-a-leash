import {
  assertAuthorizationEvent,
  statusFor,
  type AuthorizationEvent,
  type DecisionRequestEnvelope,
  type EngineVerdict,
  type EventMandate,
} from "@leash/shared";
import { fallbackVerdict, type Engine } from "./engine/port.js";
import { VisecaError, type DecisionBody, type DecisionResponse, type VisecaApi } from "./viseca/api.js";
import type { DecisionStore, LeashBus, StoredDecision } from "./store.js";

export interface WorkerOptions {
  /** Upper bound for one engine call. */
  engineBudgetMs?: number;
  /** Time kept free before deadline_at for posting the answer. */
  safetyMarginMs?: number;
  /** Customer window for step_up, from /v1/bootstrap (default 120 s). */
  humanWindowMs?: number;
  /** How long a loaded mandate stays fresh. */
  mandateCacheMs?: number;
  pollWaitSeconds?: number;
  log?: (line: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls Viseca, asks the engine, posts the answer, stores it and tells the app. */
export class Worker {
  private readonly engineBudgetMs: number;
  private readonly safetyMarginMs: number;
  private readonly humanWindowMs: number;
  private readonly mandateCacheMs: number;
  private readonly pollWaitSeconds: number;
  private readonly log: (line: string) => void;
  private mandateCache = new Map<string, { at: number; mandate: EventMandate | null }>();
  private expiryTimers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly api: VisecaApi,
    private readonly engine: Engine,
    private readonly store: DecisionStore,
    private readonly bus: LeashBus,
    opts: WorkerOptions = {},
  ) {
    this.engineBudgetMs = opts.engineBudgetMs ?? 5_000;
    this.safetyMarginMs = opts.safetyMarginMs ?? 500;
    this.humanWindowMs = opts.humanWindowMs ?? 120_000;
    this.mandateCacheMs = opts.mandateCacheMs ?? 30_000;
    this.pollWaitSeconds = opts.pollWaitSeconds ?? 25;
    this.log = opts.log ?? (() => {});
  }

  /** Call after we PATCH a mandate so the next decision sees the tightened rules. */
  invalidateMandate(mandateId: string) {
    this.mandateCache.delete(mandateId);
  }

  private async currentMandate(snapshot: EventMandate): Promise<EventMandate | null> {
    const cached = this.mandateCache.get(snapshot.mandate_id);
    if (cached && Date.now() - cached.at < this.mandateCacheMs) return cached.mandate;
    let mandate: EventMandate | null = null;
    try {
      const stored = await this.api.getMandate(snapshot.mandate_id);
      mandate = {
        ...snapshot,
        status: stored.status === "revoked" ? "revoked" : snapshot.status,
        hard_rules: stored.hard_rules,
        uncertainty_policy: stored.uncertainty_policy,
      };
    } catch (err) {
      this.log(`mandate ${snapshot.mandate_id}: could not load current version (${(err as Error).message}), using snapshot`);
    }
    this.mandateCache.set(snapshot.mandate_id, { at: Date.now(), mandate });
    return mandate;
  }

  private async decideSafely(event: AuthorizationEvent, runId: string): Promise<EngineVerdict> {
    const untilDeadline = Date.parse(event.deadline_at) - Date.now() - this.safetyMarginMs;
    const budget = Math.max(50, Math.min(this.engineBudgetMs, untilDeadline));
    // Loading the mandate must not eat the engine's budget; give it a slice and fall back to the snapshot.
    const currentMandate = await Promise.race([this.currentMandate(event.mandate), sleep(Math.min(1_000, budget / 4)).then(() => null)]);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(() => this.engine.decide(event, { runId, currentMandate })),
        new Promise<EngineVerdict>((resolve) => {
          timer = setTimeout(() => resolve(fallbackVerdict("engine_timeout", this.engine.version)), budget);
        }),
      ]);
    } catch (err) {
      this.log(`engine error on ${event.authorization.authorization_id}: ${(err as Error).message}`);
      return fallbackVerdict("engine_error", this.engine.version);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async postWithRetry(id: string, body: DecisionBody): Promise<{ status: "posted" | "post_failed"; response?: DecisionResponse }> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return { status: "posted", response: await this.api.postDecision(id, body) };
      } catch (err) {
        // 409 = Viseca already has an answer for this purchase: treat as posted.
        if (err instanceof VisecaError && err.status === 409) return { status: "posted" };
        // 422 = our body is wrong; retrying the same body cannot help.
        if (err instanceof VisecaError && err.status === 422) {
          this.log(`post ${id} rejected as invalid: ${JSON.stringify(err.body)}`);
          return { status: "post_failed" };
        }
        this.log(`post ${id} failed (attempt ${attempt}): ${(err as Error).message}`);
        if (attempt === 1) await sleep(250);
      }
    }
    return { status: "post_failed" };
  }

  /** Handles one delivered purchase. Returns the stored decision. */
  async handle(envelope: DecisionRequestEnvelope): Promise<StoredDecision> {
    const receivedAt = Date.now();
    const event = envelope.data;
    assertAuthorizationEvent(event);
    const a = event.authorization;
    const id = a.authorization_id;

    // Same live ID again: one answer, counted once. Re-post only if Viseca never got it.
    const existing = this.store.get(id);
    if (existing) {
      this.log(`${id}: delivered again, reusing stored ${existing.status}`);
      if (existing.post_status === "post_failed") {
        existing.post_status = (await this.postWithRetry(id, toDecisionBody(id, existing))).status;
        this.store.save(existing);
      }
      return existing;
    }

    const verdict = await this.decideSafely(event, envelope.run_id);
    const body = toDecisionBody(id, verdict);
    const { status: postStatus, response } = await this.postWithRetry(id, body);
    const decidedAt = Date.now();

    const decision: StoredDecision = {
      ...verdict,
      id,
      source_authorization_id: a.source_authorization_id,
      run_id: envelope.run_id,
      status: statusFor(verdict.decision),
      amount: { value: a.amount, currency: a.currency, chf: a.billing_amount_chf },
      merchant: { id: a.merchant.merchant_id, name: a.merchant.merchant_name, category: a.merchant.merchant_category, country: a.merchant.merchant_country },
      items: a.items.map((i) => ({ name: i.item_name, category: i.item_category, qty: i.quantity, unit_price: i.unit_price, currency: i.currency })),
      group_id: null,
      purchased_at: a.timestamp,
      decided_at: new Date(decidedAt).toISOString(),
      latency_ms: decidedAt - receivedAt,
      actions: verdict.decision === "step_up" ? ["approve", "decline"] : ["ok"],
      post_status: postStatus,
      deadline_missed: decidedAt > Date.parse(event.deadline_at),
    };

    if (verdict.decision === "step_up" && postStatus === "posted") {
      // Viseca sets the end of the answer window (step_up_expires_at); our own clock is only the fallback.
      const expiresAt = response?.step_up_expires_at ? Date.parse(response.step_up_expires_at) : decidedAt + this.humanWindowMs;
      decision.human_deadline_at = new Date(expiresAt).toISOString();
      decision.deadline_at = decision.human_deadline_at;
      this.scheduleExpiry(id, Math.max(0, expiresAt - Date.now()));
    }

    this.store.save(decision);
    this.log(`${id} ${a.source_authorization_id} CHF ${a.billing_amount_chf.toFixed(2)} → ${verdict.decision} (${decision.latency_ms} ms, ${postStatus})`);
    this.bus.emit("decision", decision);
    if (decision.status === "waiting_for_you") this.bus.emit("ask", decision);
    return decision;
  }

  private scheduleExpiry(id: string, inMs: number) {
    const timer = setTimeout(() => {
      this.expiryTimers.delete(timer);
      const d = this.store.get(id);
      if (d && d.status === "waiting_for_you") {
        // Nothing is sent to Viseca: an unanswered ask simply buys nothing.
        d.status = "expired";
        this.store.save(d);
        this.bus.emit("ask_expired", d);
      }
    }, inMs);
    timer.unref();
    this.expiryTimers.add(timer);
  }

  /** Polls until the run has no automated work left. `expectedEvents` = the scenario's event_count. */
  async runUntilDone(runId: string, opts: { maxIdlePolls?: number; expectedEvents?: number } = {}): Promise<void> {
    const maxIdle = opts.maxIdlePolls ?? 20;
    let idle = 0;
    while (true) {
      const envelope = await this.api.nextDecisionRequest(this.pollWaitSeconds);
      if (envelope) {
        idle = 0;
        await this.handle(envelope);
        continue;
      }
      // 204 does not mean the run is over: check progress.
      const run = await this.api.getRun(runId);
      if (isRunDone(run.status, run.counters, opts.expectedEvents)) return;
      idle += 1;
      if (idle >= maxIdle) {
        this.log(`run ${runId}: no work after ${idle} polls, stopping (status ${run.status ?? "unknown"})`);
        return;
      }
    }
  }

  stop() {
    for (const t of this.expiryTimers) clearTimeout(t);
    this.expiryTimers.clear();
  }
}

export function toDecisionBody(id: string, v: Pick<EngineVerdict, "decision" | "reason_codes" | "because" | "checks" | "engine_version">): DecisionBody {
  return {
    authorization_id: id,
    decision: v.decision,
    reason_codes: v.reason_codes,
    customer_message: v.because,
    // One object per check (Viseca rejects plain strings). Viseca stores them as sent, so the jury sees the checklist.
    evidence: v.checks.map((c) => ({ key: c.key, label: c.label, source: c.source, result: c.result, fact: c.fact })),
    engine_version: v.engine_version,
  };
}

/**
 * The worker's job for a run is over when Viseca says "completed", or when every purchase has been delivered and
 * nothing is queued (customer answers can still arrive later via /resolve). Counter names as seen live.
 */
export function isRunDone(status: string | undefined, counters: Record<string, number> | undefined, expectedEvents?: number): boolean {
  if (status === "completed") return true;
  if (!counters || typeof counters.delivered !== "number" || typeof counters.queued !== "number") return false;
  const total = Math.max(counters.generated ?? 0, expectedEvents ?? 0);
  return total > 0 && counters.queued === 0 && counters.delivered >= total;
}
