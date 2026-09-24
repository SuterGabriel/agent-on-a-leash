// The compiler's result in the shape a mandate needs. Goes through compile(), the same single path as
// POST /app/leash/parse (shared/src/compiler.ts reads the instruction; nothing here reads it again).
import type { MandateRule, UncertaintyPolicy } from "@leash/shared";
import { compile, toMandateDraft } from "../compiler/compile.js";

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
  const parsed = compile(body.instruction);
  const draft = toMandateDraft(parsed, parsed.rules);
  return {
    instruction: parsed.instruction,
    hard_rules: draft.hard_rules,
    uncertainty_policy: draft.uncertainty_policy,
    assumptions: parsed.assumptions,
    open_questions: draft.open_questions,
  };
}
