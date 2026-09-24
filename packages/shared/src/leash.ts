// Leash shapes for the app API (S1–S9). Source: App API contract + Kim's "Rules, settings and why it was flagged".
import type { CheckSource } from "./decision.js";
import type { MandateRule, UncertaintyPolicy } from "./event.js";

export type RuleGroup = "limits" | "purpose" | "restrictions";

/** The customer's words a rule came from. start/end are character offsets in the instruction. */
export interface YourWords {
  text: string;
  start: number;
  end: number;
}

export interface LeashRule {
  id: string;
  /** Stable key shared with the engine's checks, see RULE_KEYS. */
  key: string;
  /** "Each order CHF 120 or less, delivery included" */
  label: string;
  group: RuleGroup;
  source: CheckSource;
  your_words: YourWords | null;
  /** Viseca rule format; travels with every purchase event. null = kept only in our store. */
  hard_rule: MandateRule | null;
  /** Set for learned and tightened rules. */
  added_at?: string;
}

export interface BuiltInProtection {
  key: string;
  label: string;
  /** One line shown when the customer taps the row. */
  explanation: string;
}

export interface OpenQuestion {
  id: string;
  text: string;
  options: string[];
}

/** POST /app/leash/parse */
export interface ParseResult {
  instruction: string;
  rules: LeashRule[];
  built_in: BuiltInProtection[];
  uncertainty_policy: UncertaintyPolicy;
  open_questions: OpenQuestion[];
  /** Sentences of the instruction no rule came from. */
  not_understood: string[];
  /** Every interpretation, in plain words. */
  assumptions: string[];
  warnings: string[];
}

/** POST /app/leash */
export interface CreateLeashRequest {
  instruction: string;
  /** Answers to open questions, by question id: { q_split_orders: "Yes" }. */
  answers?: Record<string, string>;
  uncertainty_policy?: UncertaintyPolicy;
  /** Face ID confirmation from the app. Without it nothing is created. */
  confirmed: boolean;
}

export interface Budget {
  period_days: number;
  limit_chf: number;
  spent_chf: number;
  left_chf: number;
  /** "CHF 44.50 frees up Mon 09:12": the oldest approved purchase leaving the window. Simulated time. */
  next_release: { amount_chf: number; at: string } | null;
}

export interface KnownShop {
  merchant_id: string;
  name: string;
  times_used: number;
  /** Became known through an approval in this leash. */
  new: boolean;
}

export interface Suggestion {
  id: string;
  decision_id: string;
  reason_code: string;
  /** "Always decline when something is added I didn't ask for" */
  text: string;
  rule: MandateRule;
  status: "open" | "accepted" | "dismissed";
}

export type LeashStatus = "none" | "active" | "paused" | "revoked";

/** GET /app/leash */
export interface LeashView {
  status: LeashStatus;
  token: "on" | "off";
  mandate_id: string | null;
  instruction: string | null;
  card: { id: string; label: string } | null;
  rules: LeashRule[];
  learned_rules: LeashRule[];
  built_in: BuiltInProtection[];
  uncertainty_policy: UncertaintyPolicy;
  budget: Budget | null;
  known_shops: KnownShop[];
  suggestions: Suggestion[];
  paused_until: string | null;
}

/** PATCH /app/leash/rules — only ever tightens. */
export type TightenRequest =
  | { type: "lower_order_limit"; value: number }
  | { type: "block_shop"; merchant_id: string; name?: string }
  | { type: "block_category"; category: string }
  | { type: "unsure_decline" };
