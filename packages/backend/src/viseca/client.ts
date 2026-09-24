import type { DecisionRequestEnvelope } from "@leash/shared";
import {
  pick,
  toRunInfo,
  toStoredMandate,
  VisecaError,
  type DecisionBody,
  type DecisionResponse,
  type MandateDraftRequest,
  type MandatePatch,
  type ResolveBody,
  type RunInfo,
  type StoredMandate,
  type VisecaApi,
} from "./api.js";

const TIMEOUT_MS = 30_000;

/** Live Viseca API over HTTPS. The team key is only ever read from the environment. */
export class HttpVisecaClient implements VisecaApi {
  constructor(
    private readonly baseUrl: string,
    private readonly teamApiKey: string | null,
  ) {}

  private async request(method: string, path: string, body?: unknown, auth = true): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth) {
      if (!this.teamApiKey) throw new Error("TEAM_API_KEY is not set (see .env.example)");
      headers.Authorization = `Bearer ${this.teamApiKey}`;
    }
    const res = await fetch(this.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 204) return { status: 204, body: null };
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // keep text body
    }
    // Check the HTTP status first; errors come as JSON under `error`.
    if (!res.ok) throw new VisecaError(res.status, pick(parsed, "error") ?? parsed);
    return { status: res.status, body: parsed };
  }

  async healthz() {
    return (await this.request("GET", "/healthz", undefined, false)).body;
  }
  async bootstrap() {
    return (await this.request("GET", "/v1/bootstrap")).body;
  }
  async referenceData() {
    return (await this.request("GET", "/v1/reference-data")).body;
  }
  /** Card history of the live pack, as CSV text. */
  async authorizationHistoryCsv(): Promise<string> {
    const body = (await this.request("GET", "/v1/reference-data/authorization-history.csv")).body;
    if (typeof body !== "string") throw new Error("authorization history: expected CSV text");
    return body;
  }
  async createMandate(body: MandateDraftRequest) {
    const res = (await this.request("POST", "/v1/mandates", body)).body;
    const draftId = pick<string>(res, "draft_id");
    if (!draftId) throw new Error(`create mandate: no draft_id in ${JSON.stringify(res)}`);
    return { draft_id: draftId, raw: res };
  }
  async confirmMandate(draftId: string) {
    const res = (await this.request("POST", `/v1/mandates/${encodeURIComponent(draftId)}/confirm`, { confirmed: true })).body;
    const mandateId = pick<string>(res, "mandate_id");
    if (!mandateId) throw new Error(`confirm mandate: no mandate_id in ${JSON.stringify(res)}`);
    return { mandate_id: mandateId, raw: res };
  }
  async getMandate(mandateId: string): Promise<StoredMandate> {
    return toStoredMandate((await this.request("GET", `/v1/mandates/${encodeURIComponent(mandateId)}`)).body);
  }
  async patchMandate(mandateId: string, patch: MandatePatch) {
    return (await this.request("PATCH", `/v1/mandates/${encodeURIComponent(mandateId)}`, patch)).body;
  }
  async revokeMandate(mandateId: string) {
    return (await this.request("DELETE", `/v1/mandates/${encodeURIComponent(mandateId)}`)).body;
  }
  async startRun(body: { scenario_id: string; mandate_id: string }): Promise<RunInfo> {
    return toRunInfo((await this.request("POST", "/v1/scenario-runs", body)).body);
  }
  async getRun(runId: string): Promise<RunInfo> {
    return toRunInfo((await this.request("GET", `/v1/scenario-runs/${encodeURIComponent(runId)}`)).body);
  }
  async nextDecisionRequest(waitSeconds: number): Promise<DecisionRequestEnvelope | null> {
    const res = await this.request("GET", `/v1/decision-requests/next?wait=${waitSeconds}`);
    return res.status === 204 ? null : (res.body as DecisionRequestEnvelope);
  }
  async postDecision(authorizationId: string, body: DecisionBody): Promise<DecisionResponse> {
    return (await this.request("POST", `/v1/authorizations/${encodeURIComponent(authorizationId)}/decision`, body)).body as DecisionResponse;
  }
  async resolve(authorizationId: string, body: ResolveBody) {
    return (await this.request("POST", `/v1/authorizations/${encodeURIComponent(authorizationId)}/resolve`, body)).body;
  }
  async listAuthorizations() {
    return (await this.request("GET", "/v1/authorizations")).body;
  }
  async events(since: number | string) {
    return (await this.request("GET", `/v1/events?since=${encodeURIComponent(String(since))}`)).body;
  }
  async resetTeam() {
    return (await this.request("POST", "/v1/team/reset", {})).body;
  }
}
