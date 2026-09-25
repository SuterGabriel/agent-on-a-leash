// Guard 15: session integrity. Does this look like the customer? Judged against THIS card's history,
// or all the customer's cards when the card has little ("baseline: customer").
// 1–2 signals: ask. 3 or more: stop. Signals are per purchase, so a clean purchase after a burst passes.
// No history to compare with (device, hour, country, shop unknown): that is missing data, not proof, so it asks
// (STEP_UP), even when the customer said "decline when unsure". A burst of orders is real data and keeps its weight.
// With no history, a purchase the customer approved earlier in this run becomes the baseline: the same device in the
// same country is then the customer for the rest of the run. With history, the history stays the baseline, a yes to one
// purchase does not vouch for the device: the public burst scenario still stops the purchases after an approved one.
import { swissHour } from "../../../shared/src/baselines";
import type { Guard } from "../types";

const MIN_HISTORY_FOR_HOURS = 30;

export const sessionIntegrity: Guard = ({ auth, policy, habits: card, habitsScope, ledger }) => {
  if (!policy.sessionIntegrity) return { guard: "session", verdict: "SKIP", evidence: [] };

  const hour = swissHour(auth.timestamp);
  const signals: string[] = [];
  const text: string[] = [];

  // No history for this card or its customer (live scenario cards): device, country and shop can't be "new" against
  // nothing. Only the burst signal stands on its own; the rest is unknown, and unknown is an ask, never a decline.
  const deviceApproved = ledger.approvedOnDevice(auth.customer_device_id);
  const countryApproved = ledger.approvedInCountry(auth.merchant.merchant_country);
  if (card.purchases === 0) {
    const evidence = [
      { fact: "card_history_purchases", value: 0, comparator: ">=", threshold: 1, source: "authorization_history" },
      { fact: "recent_attempt_count_10m", value: auth.recent_attempt_count_10m, comparator: "<", threshold: 2, source: "authorization" },
      { fact: "approved_in_this_run_same_device", value: deviceApproved, comparator: ">=", threshold: 1, source: "ledger" },
      { fact: "approved_in_this_run_same_country", value: countryApproved, comparator: ">=", threshold: 1, source: "ledger" },
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
    if (deviceApproved > 0 && countryApproved > 0) return { guard: "session", verdict: "PASS", evidence, signals: [] };
    return {
      guard: "session",
      verdict: "STEP_UP",
      reason_code: "no_session_history",
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
    { fact: "baseline", value: habitsScope, comparator: null, threshold: null, source: "authorization_history" },
  ];
  if (signals.length === 0) return { guard: "session", verdict: "PASS", evidence, signals };

  // Three or more signals stop the purchase, unless the customer asked to be asked ("... stop and ask me").
  const verdict = signals.length >= 3 && habitsScope !== "none" && policy.sessionAction !== "ask" ? "DECLINE" : "STEP_UP";
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
