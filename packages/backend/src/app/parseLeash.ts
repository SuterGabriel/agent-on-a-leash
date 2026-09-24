// POST /app/leash/parse. Only calls the one policy compiler (packages/shared/src/compiler.ts); no parsing here.
import type { MandateRule, UncertaintyPolicy } from "@leash/shared";
import { compilePolicy, toHardRules } from "../../../shared/src/compiler.js";

export interface ParseLeashResponse {
  instruction: string;
  /** Viseca rule format, ready for POST /v1/mandates. */
  hard_rules: MandateRule[];
  uncertainty_policy: UncertaintyPolicy;
  /** Every interpretation, in plain words, for the customer to check (S2). */
  assumptions: string[];
  open_questions: string[];
}

export function parseLeash(body: { instruction?: unknown }): ParseLeashResponse {
  if (typeof body.instruction !== "string" || !body.instruction.trim()) throw new Error("instruction must be a non-empty string");
  const policy = compilePolicy(body.instruction);
  return {
    instruction: policy.instruction,
    hard_rules: toHardRules(policy),
    uncertainty_policy: policy.uncertainty,
    assumptions: policy.assumptions,
    open_questions: policy.openQuestions,
  };
}
