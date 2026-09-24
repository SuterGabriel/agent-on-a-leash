// Guard 15: session integrity. Does this look like the customer? Judged against THIS card's history.
// 1–2 signals: ask. 3 or more: stop. Signals are per purchase, so a clean purchase after a burst passes.
import { swissHour } from "../../../shared/src/baselines";
import type { Guard } from "../types";

const MIN_HISTORY_FOR_HOURS = 30;

export const sessionIntegrity: Guard = ({ auth, policy, card }) => {
  if (!policy.sessionIntegrity) return { guard: "session", verdict: "SKIP", evidence: [] };

  const hour = swissHour(auth.timestamp);
  const signals: string[] = [];
  const text: string[] = [];

  // No history for this card (live scenario cards): device, country and shop can't be "new" against nothing.
  // Only the burst signal stands on its own; the rest is unknown and goes to the uncertainty policy.
  if (card.purchases === 0) {
    const evidence = [
      { fact: "card_history_purchases", value: 0, comparator: ">=", threshold: 1, source: "authorization_history" },
      { fact: "recent_attempt_count_10m", value: auth.recent_attempt_count_10m, comparator: "<", threshold: 2, source: "authorization" },
    ];
    if (auth.recent_attempt_count_10m >= 2) {
      return {
        guard: "session",
        verdict: "STEP_UP",
        reason_code: "session_not_you",
        evidence,
        signals: ["quick_series"],
        message: `Is this you? ${auth.recent_attempt_count_10m} other attempts in 10 minutes.`,
      };
    }
    return {
      guard: "session",
      verdict: "UNCERTAIN",
      reason_code: "missing_info",
      evidence,
      message: "We don't have any purchase history for this card yet, so we can't compare this with how you usually shop.",
    };
  }

  if (auth.customer_device_id && !card.devices.has(auth.customer_device_id)) {
    signals.push("new_device");
    text.push("a device you have never used");
  }
  if (card.purchases >= MIN_HISTORY_FOR_HOURS && !card.hours.has(hour)) {
    signals.push("unusual_hour");
    text.push(`at ${String(hour).padStart(2, "0")}:00, an hour you never shop at`);
  }
  if (auth.recent_attempt_count_10m >= 2) {
    signals.push("quick_series");
    text.push(`${auth.recent_attempt_count_10m} other attempts in 10 minutes`);
  }
  if (!card.countries.has(auth.merchant.merchant_country)) {
    signals.push("new_country");
    text.push(`a shop in ${auth.merchant.merchant_country}, where you never bought`);
  }
  if (!card.merchants.has(auth.merchant.merchant_id)) {
    signals.push("unfamiliar_merchant");
    text.push(`at ${auth.merchant.merchant_name}, a shop you never used`);
  }

  const evidence = [
    { fact: "session_signals", value: signals.join(",") || "none", comparator: "count<", threshold: 1, source: "authorization vs card history" },
    { fact: "swiss_local_hour", value: hour, comparator: null, threshold: null, source: "authorization.timestamp" },
  ];
  if (signals.length === 0) return { guard: "session", verdict: "PASS", evidence, signals };

  const verdict = signals.length >= 3 ? "DECLINE" : "STEP_UP";
  return {
    guard: "session",
    verdict,
    reason_code: "session_not_you",
    evidence,
    signals,
    message:
      verdict === "DECLINE"
        ? `This does not look like you: ${text.join(", ")}. We stopped it.`
        : `Is this you? ${text.join(", ")}.`,
  };
};
