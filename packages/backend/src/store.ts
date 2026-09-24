import { EventEmitter } from "node:events";
import type { Decision } from "@leash/shared";

export interface StoredDecision extends Decision {
  /** Whether Viseca accepted our automated decision. */
  post_status: "posted" | "post_failed";
  deadline_missed: boolean;
  human_deadline_at?: string;
}

/** Decisions keyed by live authorization_id. In memory for now; Supabase in Step 4. */
export interface DecisionStore {
  get(id: string): StoredDecision | undefined;
  save(decision: StoredDecision): void;
  list(runId?: string): StoredDecision[];
}

export class InMemoryDecisionStore implements DecisionStore {
  private rows = new Map<string, StoredDecision>();
  get(id: string) {
    return this.rows.get(id);
  }
  save(decision: StoredDecision) {
    this.rows.set(decision.id, decision);
  }
  list(runId?: string) {
    return [...this.rows.values()].filter((d) => !runId || d.run_id === runId);
  }
}

/** Events the app stream (SSE) forwards: decision, ask, ask_expired, leash_changed. */
export interface LeashEvents {
  decision: [StoredDecision];
  ask: [StoredDecision];
  ask_expired: [StoredDecision];
  leash_changed: [{ mandate_id: string }];
}

export class LeashBus extends EventEmitter<LeashEvents> {}
