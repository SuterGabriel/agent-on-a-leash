// Strictest verdict wins: approve < step_up < decline.
// UNCERTAIN follows the customer's uncertainty policy.
// A crashed guard returns STEP_UP (see decide.ts), so it can never lead to approve.
import type { Decision, UncertaintyPolicy } from "../../shared/src/types";
import type { GuardResult } from "./types";

const RANK: Record<Decision, number> = { approve: 0, step_up: 1, decline: 2 };

export function verdictToDecision(r: GuardResult, uncertainty: UncertaintyPolicy): Decision {
  switch (r.verdict) {
    case "DECLINE":
      return "decline";
    case "STEP_UP":
      return "step_up";
    case "UNCERTAIN":
      return uncertainty === "ask" ? "step_up" : uncertainty;
    default:
      return "approve";
  }
}

export function aggregate(results: GuardResult[], uncertainty: UncertaintyPolicy) {
  const flagged = results
    .filter((r) => r.reason_code)
    .map((r) => ({ r, d: verdictToDecision(r, uncertainty) }));

  let decision: Decision = "approve";
  for (const x of flagged) if (RANK[x.d] > RANK[decision]) decision = x.d;

  // Reason codes: strictest first, then guard order (sort is stable).
  flagged.sort((a, b) => RANK[b.d] - RANK[a.d]);
  const reason_codes = flagged.map((x) => x.r.reason_code!);
  const lead = flagged.find((x) => x.d === decision)?.r;
  return { decision, reason_codes, lead };
}
