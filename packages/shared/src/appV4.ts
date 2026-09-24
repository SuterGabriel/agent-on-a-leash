// The v4 app contract, as app-web consumes it (app-web/src/features/shopping-card/api/types.ts, app-web/src/types/decision.ts).
// Served by the backend under /v4/app/*. Kim's types are the source; keep this file in step with them.
import type { Check, DecisionStatus, EngineDecisionValue } from "./decision.js";
import type { MandateRule } from "./event.js";

export interface AppSmart {
  unsure: "ask" | "decline";
  night: "decline" | "ask";
  newShops: "ask" | "known";
  learn: "on" | "off";
}

export interface AppRuleValues {
  orderLimit: number;
  monthBudget: number;
}

/** GET /v4/app/leash/suggest */
export interface AppSuggestResponse {
  window_days: number;
  analysis: {
    purchases: number;
    typical_chf: number;
    biggest_chf: number;
    per_month_chf: number;
    biggest_month_chf: number;
    night_purchases: number;
    shops_used: number;
    categories: string[];
    category_share: number;
  };
  rules: {
    key: "orderLimit" | "monthBudget" | "knownShops" | "categories";
    suggested_value: number | string[] | null;
    evidence: string;
    hard_rule: MandateRule | null;
  }[];
  smart: AppSmart & { evidence: Record<string, string> };
  instruction_generated: string;
}

/** POST /v4/app/leash */
export interface AppCreateLeashRequest {
  instruction: string;
  rules: AppRuleValues;
  smart: AppSmart;
  task_instruction?: string;
}

/** GET /v4/app/leash */
export interface AppLeash {
  mandate_id: string;
  status: "active" | "paused" | "off";
  card_last4: string;
  instruction: string;
  rules: AppRuleValues;
  smart: AppSmart;
  learned: { id: string; text: string; added_at: string }[];
  task: { instruction: string; rules: { key: string; label: string; your_words: string }[] } | null;
  month_spent_chf: number;
  frees_up_at: string | null;
}

/** PATCH /v4/app/leash/rules */
export interface AppTightenRequest {
  rules?: Partial<AppRuleValues>;
  smart?: Partial<AppSmart>;
  block_shop?: string;
  face_id_confirmed?: boolean;
}

/** The decision as the app renders it. */
export interface AppDecision {
  id: string;
  scenario_id?: string;
  replay_order?: number;
  created_at: string;
  decision: EngineDecisionValue;
  status: DecisionStatus;
  reason_codes: string[];
  headline: string;
  because: string;
  checks: Check[];
  uncertainty: string[];
  shop_text_quarantine: string | null;
  amount: { value: number; currency: string; chf: number };
  merchant: { id: string; name: string; category: string; country: string };
  items: { name: string; category: string; qty: number; unit_price: number; currency: string }[];
  device_id?: string;
  group_id: string | null;
  deadline_at?: string;
  suggestion?: { id: string; text: string };
  actions: string[];
}

/** GET /v4/app/feed */
export interface AppFeedResponse {
  decisions: AppDecision[];
  asks: AppDecision[];
}

/** POST /v4/app/asks/:id/resolve */
export interface AppResolveRequest {
  decision: "approve" | "decline";
  reason?: string;
}

/** GET /v4/app/stream: `event:` is `type`, `data:` the rest. */
export type AppStreamEvent =
  | { type: "decision"; decision: AppDecision }
  | { type: "ask"; decision: AppDecision; deadline_at: string }
  | { type: "ask_expired"; id: string }
  | { type: "leash_changed"; leash: AppLeash };
