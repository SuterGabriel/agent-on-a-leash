import type { DecisionRequestEnvelope, EngineDecisionValue, MandateRule, UncertaintyPolicy } from "@leash/shared";

// Request and response shapes of the Viseca API (technical_details.md).
// Response bodies are only partly documented; unknown fields stay in `raw`.

export interface MandateDraftRequest {
  instruction: string;
  hard_rules: MandateRule[];
  uncertainty_policy: UncertaintyPolicy;
  guidance: string[];
  open_questions: string[];
}

export interface MandatePatch {
  /** Must keep every existing rule unchanged; may only add. */
  hard_rules?: MandateRule[];
  /** Only approve/ask → decline is allowed. */
  uncertainty_policy?: UncertaintyPolicy;
  guidance?: string[];
  open_questions?: string[];
}

export interface StoredMandate {
  mandate_id: string;
  status: string;
  instruction: string;
  hard_rules: MandateRule[];
  uncertainty_policy: UncertaintyPolicy;
  guidance: string[];
  open_questions: string[];
  raw: unknown;
}

export interface RunInfo {
  run_id: string;
  scenario_id?: string;
  mandate_id?: string;
  status?: string;
  counters?: Record<string, number>;
  raw: unknown;
}

/** Viseca requires each evidence entry to be an object (a list of strings is rejected with 422). */
export type EvidenceEntry = Record<string, unknown>;

export interface DecisionBody {
  authorization_id: string;
  decision: EngineDecisionValue;
  reason_codes?: string[];
  customer_message?: string;
  evidence?: EvidenceEntry[];
  engine_version?: string;
}

export interface ResolveBody {
  decision: "approve" | "decline";
  customer_message?: string;
  evidence?: EvidenceEntry[];
}

/** Response of POST /decision, as seen live on 24 Sep 2026. */
export interface DecisionResponse {
  authorization_id?: string;
  /** "approved", "declined" or "pending_step_up" */
  status?: string;
  /** Only for step_up: end of the customer's answer window, set by Viseca. */
  step_up_expires_at?: string;
}

/** Implemented by the live HTTP client and by the offline platform clone. */
export interface VisecaApi {
  healthz(): Promise<unknown>;
  bootstrap(): Promise<unknown>;
  referenceData(): Promise<unknown>;
  createMandate(body: MandateDraftRequest): Promise<{ draft_id: string; raw: unknown }>;
  confirmMandate(draftId: string): Promise<{ mandate_id: string; raw: unknown }>;
  getMandate(mandateId: string): Promise<StoredMandate>;
  patchMandate(mandateId: string, patch: MandatePatch): Promise<unknown>;
  revokeMandate(mandateId: string): Promise<unknown>;
  startRun(body: { scenario_id: string; mandate_id: string }): Promise<RunInfo>;
  getRun(runId: string): Promise<RunInfo>;
  /** null = HTTP 204, nothing to do right now. */
  nextDecisionRequest(waitSeconds: number): Promise<DecisionRequestEnvelope | null>;
  postDecision(authorizationId: string, body: DecisionBody): Promise<DecisionResponse>;
  resolve(authorizationId: string, body: ResolveBody): Promise<unknown>;
  listAuthorizations(): Promise<unknown>;
  events(since: number | string): Promise<unknown>;
  resetTeam(): Promise<unknown>;
}

export class VisecaError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `Viseca API error ${status}: ${JSON.stringify(body)}`);
    this.name = "VisecaError";
  }
}

/** Reads `key` from a response body, also looking one level into `data` (response envelopes are not fully documented). */
export function pick<T>(body: unknown, key: string): T | undefined {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return undefined;
  if (key in b) return b[key] as T;
  const inner = b.data as Record<string, unknown> | undefined;
  if (inner && typeof inner === "object" && key in inner) return inner[key] as T;
  return undefined;
}

export function toStoredMandate(body: unknown): StoredMandate {
  const src = (pick<Record<string, unknown>>(body, "mandate") ?? pick<Record<string, unknown>>(body, "data") ?? body) as Record<string, unknown>;
  return {
    mandate_id: String(src.mandate_id ?? ""),
    status: String(src.status ?? "unknown"),
    instruction: String(src.instruction ?? ""),
    hard_rules: (src.hard_rules as MandateRule[]) ?? [],
    uncertainty_policy: (src.uncertainty_policy as UncertaintyPolicy) ?? "ask",
    guidance: (src.guidance as string[]) ?? [],
    open_questions: (src.open_questions as string[]) ?? [],
    raw: body,
  };
}

/**
 * Live run responses carry flat counters: generated_event_count, delivered_event_count, finalized_event_count,
 * processed_event_count, pending_event_count, queued_event_count, platform_rejected_count. Collected into `counters`
 * without the "_event_count" / "_count" suffix: { generated, delivered, finalized, ... }.
 */
export function toRunInfo(body: unknown): RunInfo {
  const runId = pick<string>(body, "run_id");
  if (!runId) throw new Error(`run response without run_id: ${JSON.stringify(body)}`);
  const counters: Record<string, number> = {};
  for (const [k, v] of Object.entries((body ?? {}) as Record<string, unknown>)) {
    if (typeof v === "number" && k.endsWith("_count")) counters[k.replace(/(_event)?_count$/, "")] = v;
  }
  return {
    run_id: runId,
    scenario_id: pick<string>(body, "scenario_id"),
    mandate_id: pick<string>(body, "mandate_id"),
    status: pick<string>(body, "status"),
    counters,
    raw: body,
  };
}
