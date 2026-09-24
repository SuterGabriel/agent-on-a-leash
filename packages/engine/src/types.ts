import type { Baselines, CardBaseline } from "../../shared/src/baselines";
import type { Authorization, Decision, Evidence, Policy } from "../../shared/src/types";
import type { Ledger } from "./ledger";
import type { ShopTextReport } from "./shoptext";

export type Verdict = "PASS" | "STEP_UP" | "DECLINE" | "UNCERTAIN" | "SKIP";

export interface GuardResult {
  guard: string;
  verdict: Verdict;
  reason_code?: string;
  message?: string; // one or two sentences for the customer, with the numbers
  evidence: Evidence[];
  signals?: string[]; // session signals noticed (may be reported without raising the decision)
}

/** Everything a guard may look at. Guards are pure: no network, no clock. */
export interface Facts {
  auth: Authorization;
  policy: Policy;
  ledger: Ledger;
  simTime: number; // simulated purchase time in ms
  base: Baselines;
  card: CardBaseline; // history of THIS card
  customerId: string | null;
  shop: ShopTextReport; // quarantined shop text, computed once
  addonLines: Set<number>; // line numbers that are add-ons, not the thing asked for
}

export type Guard = (f: Facts) => GuardResult;

export interface DecisionResult {
  authorization_id: string;
  decision: Decision;
  reason_codes: string[];
  customer_message: string;
  evidence: Evidence[];
  engine_version: string;
  // for our own screens and logs, not sent to the platform:
  guards: GuardResult[];
  flagged_shop_text: string[];
  elapsed_ms: number;
  replayed: boolean;
}
