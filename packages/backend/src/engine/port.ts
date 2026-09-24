import type { AuthorizationEvent, EngineVerdict, EventMandate } from "@leash/shared";

export interface EngineContext {
  runId: string;
  /**
   * Latest mandate we hold. Viseca freezes the mandate at run start (event.mandate);
   * the engine applies the stricter of the two so "Tighten" works immediately.
   * null when it could not be loaded; then the snapshot alone applies.
   */
  currentMandate: EventMandate | null;
}

/** Dev 1's engine plugs in here. Pure: no network, no clock besides the event's own timestamps. */
export interface Engine {
  readonly version: string;
  decide(event: AuthorizationEvent, ctx: EngineContext): EngineVerdict | Promise<EngineVerdict>;
}

/** Placeholder until the engine lands: asks the customer about every purchase. Never approves. */
export const stubEngine: Engine = {
  version: "stub-0",
  decide: () => ({
    decision: "step_up",
    reason_codes: ["customer_confirmation"],
    headline: "Please check this purchase",
    because: "Our rules engine is not connected yet, so we ask you about every purchase.",
    checks: [],
    uncertainty: ["rules engine not connected"],
    shop_text_quarantine: null,
    engine_version: "stub-0",
  }),
};

/** Safe fallback when the engine throws or runs out of time: ask, never approve. */
export function fallbackVerdict(reason: "engine_error" | "engine_timeout", engineVersion: string): EngineVerdict {
  return {
    decision: "step_up",
    reason_codes: [reason],
    headline: "We need you to check this",
    because:
      reason === "engine_timeout"
        ? "Our checks did not finish in time, so we are asking you instead of guessing."
        : "Our checks hit an error, so we are asking you instead of guessing.",
    checks: [],
    uncertainty: [reason === "engine_timeout" ? "checks did not finish in time" : "checks failed with an error"],
    shop_text_quarantine: null,
    engine_version: engineVersion,
  };
}
