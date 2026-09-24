import {
  buildEvent,
  scenarioAttempts,
  type AuthorizationEvent,
  type DataPack,
  type DecisionRequestEnvelope,
  type EventMandate,
  type MandateRule,
  type RecentAuthorization,
  type Row,
  type UncertaintyPolicy,
} from "@leash/shared";
import {
  toRunInfo,
  VisecaError,
  type DecisionBody,
  type MandateDraftRequest,
  type MandatePatch,
  type ResolveBody,
  type RunInfo,
  type StoredMandate,
  type VisecaApi,
} from "../viseca/api.js";

// In-process clone of the Viseca platform, driven by the 45 purchases in data/.
// Behaviour follows technical_details.md. Where the docs are silent, the choice is marked "assumption".

type FinalStatus = "approved" | "declined" | "pending" | "cancelled";

interface MandateRecord {
  mandate_id: string;
  status: "active" | "revoked";
  body: MandateDraftRequest;
}

interface AttemptState {
  attempt: Row;
  liveId: string;
  queuedAt?: number;
  deadlineAt?: number;
  event?: AuthorizationEvent;
  decision?: DecisionBody & { received_at: number; deadline_missed: boolean };
  humanDeadlineAt?: number;
  resolution?: ResolveBody & { received_at: number };
  /** The customer's answer window ran out: Viseca declines with reason step_up_expired. */
  expired?: boolean;
  status?: FinalStatus;
  deliveries: number;
}

interface RunState {
  run_id: string;
  scenario_id: string;
  mandate_id: string;
  snapshot: EventMandate;
  attempts: AttemptState[];
}

export interface OfflinePlatformOptions {
  decisionDeadlineMs?: number;
  humanWindowMs?: number;
  now?: () => number;
  /** Source AU ids to deliver twice, to exercise retry handling. */
  redeliver?: Set<string>;
}

const CANONICAL_UNCERTAINTY: UncertaintyPolicy[] = ["ask", "decline", "approve"];

export class OfflinePlatform implements VisecaApi {
  private readonly deadlineMs: number;
  private readonly humanWindowMs: number;
  private readonly now: () => number;
  private readonly redeliver: Set<string>;
  private drafts = new Map<string, MandateDraftRequest>();
  private mandates = new Map<string, MandateRecord>();
  private runs = new Map<string, RunState>();
  private byLiveId = new Map<string, { run: RunState; state: AttemptState }>();
  private seq = 0;
  private eventLog: { seq: number; type: string; authorization_id?: string; at: string }[] = [];

  constructor(
    private readonly pack: DataPack,
    opts: OfflinePlatformOptions = {},
  ) {
    this.deadlineMs = opts.decisionDeadlineMs ?? 8_000;
    this.humanWindowMs = opts.humanWindowMs ?? 120_000;
    this.now = opts.now ?? Date.now;
    this.redeliver = opts.redeliver ?? new Set();
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, "0")}`;
  }

  private log(type: string, authorization_id?: string) {
    this.eventLog.push({ seq: this.eventLog.length + 1, type, authorization_id, at: new Date(this.now()).toISOString() });
  }

  async healthz() {
    return { status: "ok", mode: "offline" };
  }

  async bootstrap() {
    return {
      mode: "offline",
      scenarios: [...this.pack.scenarios.keys()],
      timeouts: { decision_deadline_seconds: this.deadlineMs / 1000, human_window_seconds: this.humanWindowMs / 1000 },
    };
  }

  async referenceData() {
    return { scenarios: [...this.pack.scenarios.values()], fx_rates: this.pack.fx };
  }

  async createMandate(body: MandateDraftRequest) {
    if (!body.instruction?.trim()) throw new VisecaError(422, { message: "instruction is required" });
    if (!Array.isArray(body.hard_rules)) throw new VisecaError(422, { message: "hard_rules must be a list" });
    if (!CANONICAL_UNCERTAINTY.includes(body.uncertainty_policy)) throw new VisecaError(422, { message: "invalid uncertainty_policy" });
    const draft_id = this.nextId("DRAFT");
    this.drafts.set(draft_id, structuredClone(body));
    return { draft_id, raw: { draft_id, ...body } };
  }

  async confirmMandate(draftId: string) {
    const body = this.drafts.get(draftId);
    if (!body) throw new VisecaError(404, { message: `draft ${draftId} not found` });
    const mandate_id = this.nextId("TM");
    this.mandates.set(mandate_id, { mandate_id, status: "active", body });
    this.drafts.delete(draftId);
    return { mandate_id, raw: { mandate_id } };
  }

  private mandate(mandateId: string): MandateRecord {
    const m = this.mandates.get(mandateId);
    if (!m) throw new VisecaError(404, { message: `mandate ${mandateId} not found` });
    return m;
  }

  async getMandate(mandateId: string): Promise<StoredMandate> {
    const m = this.mandate(mandateId);
    return { mandate_id: m.mandate_id, status: m.status, ...structuredClone(m.body), raw: m };
  }

  async patchMandate(mandateId: string, patch: MandatePatch) {
    const m = this.mandate(mandateId);
    if (m.status !== "active") throw new VisecaError(409, { message: "mandate is not active" });
    if (patch.hard_rules) {
      // Every existing rule must stay unchanged; rules may only be added.
      const next = patch.hard_rules.map((r) => JSON.stringify(r));
      const missing = m.body.hard_rules.filter((r) => !next.includes(JSON.stringify(r)));
      if (missing.length > 0) throw new VisecaError(422, { message: "existing hard_rules cannot be removed or replaced" });
    }
    if (patch.uncertainty_policy && patch.uncertainty_policy !== m.body.uncertainty_policy && patch.uncertainty_policy !== "decline") {
      throw new VisecaError(422, { message: "uncertainty_policy can only be tightened to decline" });
    }
    m.body = {
      ...m.body,
      ...(patch.hard_rules ? { hard_rules: structuredClone(patch.hard_rules) } : {}),
      ...(patch.uncertainty_policy ? { uncertainty_policy: patch.uncertainty_policy } : {}),
      ...(patch.guidance ? { guidance: patch.guidance } : {}),
      ...(patch.open_questions ? { open_questions: patch.open_questions } : {}),
    };
    this.log("mandate.updated");
    // Existing runs keep their snapshot.
    return { mandate_id: mandateId, ...m.body };
  }

  async revokeMandate(mandateId: string) {
    const m = this.mandate(mandateId);
    m.status = "revoked";
    this.log("mandate.revoked");
    return { mandate_id: mandateId, status: "revoked" };
  }

  async startRun(body: { scenario_id: string; mandate_id: string }): Promise<RunInfo> {
    const scenario = this.pack.scenarios.get(body.scenario_id);
    if (!scenario) throw new VisecaError(404, { message: `scenario ${body.scenario_id} not found` });
    const m = this.mandate(body.mandate_id);
    if (m.status !== "active") throw new VisecaError(409, { message: "mandate is not active" });
    const attempts = scenarioAttempts(this.pack, body.scenario_id);
    const authority = this.pack.authorities.get(attempts[0]?.authority_id ?? "");
    if (!authority) throw new VisecaError(500, { message: "scenario has no authority" });

    const run_id = this.nextId("RUN");
    const snapshot: EventMandate = {
      mandate_id: m.mandate_id,
      status: "active",
      customer_id: authority.customer_id,
      card_id: authority.card_id,
      instruction: m.body.instruction,
      hard_rules: structuredClone(m.body.hard_rules),
      uncertainty_policy: m.body.uncertainty_policy,
      profile_id: `PROFILE-${authority.authority_id}`,
    };
    const run: RunState = {
      run_id,
      scenario_id: body.scenario_id,
      mandate_id: m.mandate_id,
      snapshot,
      attempts: attempts.map((attempt) => ({ attempt, liveId: `${run_id}-AZ${String(attempt.replay_order).padStart(3, "0")}`, deliveries: 0 })),
    };
    for (const state of run.attempts) this.byLiveId.set(state.liveId, { run, state });
    this.runs.set(run_id, run);
    this.log("run.started");
    return this.runInfo(run);
  }

  private expireHumanWindows(run: RunState) {
    const now = this.now();
    for (const s of run.attempts) {
      if (s.status === "pending" && s.humanDeadlineAt !== undefined && now > s.humanDeadlineAt) {
        // As the live API does (seen 24 Sep 2026): an unanswered step_up ends as declined, reason step_up_expired.
        s.status = "declined";
        s.expired = true;
        this.log("authorization.expired", s.liveId);
      }
    }
  }

  private runInfo(run: RunState): RunInfo {
    this.expireHumanWindows(run);
    const count = (f: (s: AttemptState) => boolean) => run.attempts.filter(f).length;
    const finalized = count((s) => s.status === "approved" || s.status === "declined" || s.status === "cancelled");
    // Same flat fields as the live API (seen 24 Sep 2026), plus offline-only extras at the end.
    const raw = {
      run_id: run.run_id,
      scenario_id: run.scenario_id,
      mandate_id: run.mandate_id,
      status: finalized === run.attempts.length ? "completed" : "running",
      generated_event_count: run.attempts.length,
      delivered_event_count: count((s) => s.deliveries > 0),
      finalized_event_count: finalized,
      processed_event_count: finalized,
      pending_event_count: count((s) => s.deliveries > 0 && s.status !== "approved" && s.status !== "declined" && s.status !== "cancelled"),
      queued_event_count: count((s) => s.deliveries === 0),
      platform_rejected_count: 0,
      approved_count: count((s) => s.status === "approved"),
      declined_count: count((s) => s.status === "declined"),
      deadline_miss_count: count((s) => !!s.decision?.deadline_missed),
    };
    return toRunInfo(raw);
  }

  async getRun(runId: string): Promise<RunInfo> {
    const run = this.runs.get(runId);
    if (!run) throw new VisecaError(404, { message: `run ${runId} not found` });
    return this.runInfo(run);
  }

  /** Context the platform attaches: approved spend and recent attempts, computed from this run's decisions. */
  private contextFor(run: RunState, current: AttemptState) {
    const ts = Date.parse(current.attempt.timestamp as string);
    const earlier = run.attempts.filter((s) => s !== current && s.decision && Date.parse(s.attempt.timestamp as string) < ts);
    // Assumption: the period is the longest period rule in the snapshot, else 7 days.
    const periodDays = Math.max(0, ...run.snapshot.hard_rules.filter((r) => r.scope === "period").map((r) => r.period_days ?? 0)) || 7;
    const periodStart = ts - periodDays * 24 * 3600 * 1000;
    const approved = earlier
      .filter((s) => s.status === "approved" && Date.parse(s.attempt.timestamp as string) >= periodStart)
      .reduce((sum, s) => sum + Number(s.attempt.billing_amount_chf), 0);
    const windowStart = ts - 10 * 60 * 1000;
    const recent: RecentAuthorization[] = earlier
      .filter((s) => Date.parse(s.attempt.timestamp as string) >= windowStart)
      .map((s) => ({
        authorization_id: s.liveId,
        timestamp: s.attempt.timestamp as string,
        merchant_id: s.attempt.merchant_id as string,
        billing_amount_chf: Number(s.attempt.billing_amount_chf),
        status: s.status ?? "pending",
      }));
    return { approved_spend_in_period_chf: Math.round(approved * 100) / 100, recent_authorizations: recent };
  }

  async nextDecisionRequest(_waitSeconds: number): Promise<DecisionRequestEnvelope | null> {
    const now = this.now();
    for (const run of this.runs.values()) {
      this.expireHumanWindows(run);
      // Redelivery of an already answered purchase (tests the worker's retry handling).
      const again = run.attempts.find((s) => s.decision && s.deliveries === 1 && this.redeliver.has(s.attempt.authorization_id as string));
      if (again?.event) {
        again.deliveries += 1;
        return this.envelope(run, again);
      }
      // Assumption: purchases are queued one after another, the next once the previous has an automated decision.
      const next = run.attempts.find((s) => !s.decision);
      if (!next) continue;
      if (next.deliveries > 0 && next.deadlineAt !== undefined && now <= next.deadlineAt) continue; // delivered, waiting for the answer
      if (next.queuedAt === undefined) {
        next.queuedAt = now;
        next.deadlineAt = now + this.deadlineMs;
      }
      const related = next.attempt.related_authorization_id
        ? (run.attempts.find((s) => s.attempt.authorization_id === next.attempt.related_authorization_id)?.liveId ?? null)
        : null;
      next.event = buildEvent(this.pack, next.attempt, {
        liveAuthorizationId: next.liveId,
        requestId: `req-${next.liveId}`,
        mandate: run.snapshot,
        relatedLiveId: related,
        context: this.contextFor(run, next),
        receivedAt: new Date(now).toISOString(),
        deadlineAt: new Date(next.deadlineAt as number).toISOString(),
      });
      next.deliveries += 1;
      return this.envelope(run, next);
    }
    return null;
  }

  private envelope(run: RunState, s: AttemptState): DecisionRequestEnvelope {
    return {
      run_id: run.run_id,
      event_id: `evt-${s.liveId}-${s.deliveries}`,
      type: "authorization.request",
      authorization_id: s.liveId,
      status: "pending",
      occurred_at: new Date(this.now()).toISOString(),
      data: s.event as AuthorizationEvent,
    };
  }

  private attempt(authorizationId: string) {
    const found = this.byLiveId.get(authorizationId);
    if (!found) throw new VisecaError(404, { message: `authorization ${authorizationId} not found` });
    return found;
  }

  async postDecision(authorizationId: string, body: DecisionBody) {
    const { run, state } = this.attempt(authorizationId);
    if (body.authorization_id !== authorizationId) throw new VisecaError(422, { message: "authorization_id in body and URL differ" });
    if (!["approve", "decline", "step_up"].includes(body.decision)) throw new VisecaError(422, { message: "invalid decision" });
    // Live API: every evidence entry must be an object ("Input should be a valid dictionary").
    if (body.evidence?.some((e) => typeof e !== "object" || e === null || Array.isArray(e))) {
      throw new VisecaError(422, { code: "validation_error", message: "Request validation failed", details: [{ loc: ["body", "evidence"], msg: "Input should be a valid dictionary" }] });
    }
    if (state.decision) throw new VisecaError(409, { message: "decision already recorded" });
    const now = this.now();
    state.decision = { ...body, received_at: now, deadline_missed: state.deadlineAt !== undefined && now > state.deadlineAt };
    this.log(`decision.${body.decision}`, authorizationId);
    const decision = { ...body, decision_source: "team" };
    if (body.decision === "approve") state.status = "approved";
    else if (body.decision === "decline") state.status = "declined";
    else {
      state.status = "pending";
      state.humanDeadlineAt = now + this.humanWindowMs;
      return { authorization_id: authorizationId, status: "pending_step_up", decision, step_up_expires_at: new Date(state.humanDeadlineAt).toISOString() };
    }
    return { authorization_id: authorizationId, status: state.status, decision, run_id: run.run_id };
  }

  async resolve(authorizationId: string, body: ResolveBody) {
    const { run, state } = this.attempt(authorizationId);
    this.expireHumanWindows(run);
    if (state.decision?.decision !== "step_up") throw new VisecaError(409, { message: "only a step_up can be resolved" });
    if (state.status !== "pending") throw new VisecaError(409, { message: `authorization is ${state.status}` });
    if (body.decision !== "approve" && body.decision !== "decline") throw new VisecaError(422, { message: "invalid decision" });
    state.resolution = { ...body, received_at: this.now() };
    state.status = body.decision === "approve" ? "approved" : "declined";
    this.log(`resolve.${body.decision}`, authorizationId);
    return { authorization_id: authorizationId, status: state.status, resolved_by: "human" };
  }

  async listAuthorizations() {
    return [...this.runs.values()].flatMap((run) => {
      this.expireHumanWindows(run);
      return run.attempts
        .filter((s) => s.deliveries > 0)
        .map((s) => ({
          authorization_id: s.liveId,
          source_authorization_id: s.attempt.authorization_id,
          run_id: run.run_id,
          decision: s.decision?.decision ?? null,
          final_reason_codes: s.expired ? ["step_up_expired"] : null,
          status: s.status ?? "queued",
          deadline_missed: s.decision?.deadline_missed ?? false,
        }));
    });
  }

  async events(since: number | string) {
    const from = Number(since) || 0;
    const items = this.eventLog.filter((e) => e.seq > from);
    return { events: items, next_cursor: this.eventLog.length };
  }

  async resetTeam() {
    this.drafts.clear();
    this.mandates.clear();
    this.runs.clear();
    this.byLiveId.clear();
    this.eventLog = [];
    return { status: "reset" };
  }

  /** Test helper: the snapshot rules a run was started with. */
  snapshotRules(runId: string): MandateRule[] {
    return structuredClone(this.runs.get(runId)?.snapshot.hard_rules ?? []);
  }
}
