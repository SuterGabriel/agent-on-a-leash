// Decision shapes shared by engine, backend and app. Source: the App API contract.
import type { DecisionToken } from "./token.js";

export type EngineDecisionValue = "approve" | "decline" | "step_up";
export type CheckResult = "pass" | "fail" | "unsure";
export type CheckSource = "you" | "built_in" | "learned";
/** The five families every check belongs to, for the strip in the app and the judge view. */
export type CheckFamily = "money" | "item" | "shop" | "session" | "manipulation";

export interface Check {
  /** "order_limit", "known_shop", "shop_text" ... */
  key: string;
  /** "Each order CHF 120 or less, delivery included" */
  label: string;
  /** Filled by the backend from the rules store; null for built-in protections. */
  your_words: string | null;
  source: CheckSource;
  /** Missing only on synthetic checks (e.g. "rules we could not check"). */
  family?: CheckFamily;
  result: CheckResult;
  /** "CHF 126.00 (groceries 118 + delivery 8)" */
  fact: string | null;
}

/** What the engine returns for one purchase. Pure data, no I/O. */
export interface EngineVerdict {
  decision: EngineDecisionValue;
  reason_codes: string[];
  /** 4-6 words, e.g. "Not a shop you know" */
  headline: string;
  /** One sentence: rule + fact. Sent to Viseca as customer_message. */
  because: string;
  checks: Check[];
  uncertainty: string[];
  /** Quoted merchant text that tried to give orders; evidence only. */
  shop_text_quarantine: string | null;
  suggestion?: { id: string; text: string };
  engine_version: string;
}

export type DecisionStatus =
  | "approved"
  | "declined"
  | "waiting_for_you"
  | "approved_by_you"
  | "declined_by_you"
  | "expired";

/** What the app renders (S4 feed, S5 decision card, S6 ask sheet). */
export interface Decision extends Omit<EngineVerdict, "engine_version"> {
  /** Live authorization_id. */
  id: string;
  source_authorization_id: string;
  run_id: string;
  status: DecisionStatus;
  amount: { value: number; currency: string; chf: number };
  merchant: { id: string; name: string; category: string; country: string };
  items: { name: string; category: string; qty: number; unit_price: number; currency: string }[];
  group_id: string | null;
  /** Simulated purchase time. */
  purchased_at: string;
  decided_at: string;
  latency_ms: number;
  /** Human window end, only for asks. */
  deadline_at?: string;
  actions: string[];
  engine_version: string;
  /** Set after an approval: the single-use token the agent pays with (demo). */
  token?: DecisionToken;
}

export function statusFor(decision: EngineDecisionValue): DecisionStatus {
  if (decision === "approve") return "approved";
  if (decision === "decline") return "declined";
  return "waiting_for_you";
}
