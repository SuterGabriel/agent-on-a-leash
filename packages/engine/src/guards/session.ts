// Guard 15: session integrity. Does this look like the customer? Judged against THIS card's history,
// or all the customer's cards when the card has little ("baseline: customer").
// 1–2 signals: ask. 3 or more: stop. Signals are per purchase, so a clean purchase after a burst passes.
// No history to compare with (device, hour, country, shop unknown): that is missing data, not proof, so it asks
// (STEP_UP), even when the customer said "decline when unsure". A burst of orders is real data and keeps its weight.
// With no history, a purchase the customer approved earlier in this run becomes the baseline: the same device in the
// same country is then the customer for the rest of the run. With history, the history stays the baseline, a yes to one
// purchase does not vouch for the device: the public burst scenario still stops the purchases after an approved one.
import { swissHour } from "../../../shared/src/baselines";
import type { Evidence } from "../../../shared/src/types";
import type { Guard } from "../types";

const MIN_HISTORY_FOR_HOURS = 30;

export const sessionIntegrity: Guard = ({ auth, policy, habits: card, habitsScope, ledger, learned, peers }) => {
  const device = auth.customer_device_id;
  const country = auth.merchant.merchant_country;
  // The customer said this device was not them: that is real data, not a missing fact. Stop it.
  if (device && learned?.untrustedDevices.has(device)) {
    return {
      guard: "session",
      verdict: "DECLINE",
      reason_code: "session_not_you",
      evidence: [{ fact: "device_you_said_was_not_you", value: device, comparator: null, threshold: null, source: "memory" }],
      signals: ["device_not_you"],
      message: "You told us this device was not you. We stopped the purchase.",
    };
  }
  if (!policy.sessionIntegrity) return { guard: "session", verdict: "SKIP", evidence: [] };

  const hour = swissHour(auth.timestamp);
  const signals: string[] = [];
  const text: string[] = [];

  // No history for this card or its customer (live scenario cards): device, country and shop can't be "new" against
  // nothing. Only the burst signal stands on its own; the rest is unknown, and unknown is an ask, never a decline.
  // What the customer vouched for in earlier runs counts like history.
  const learnedDevice = !!device && (learned?.devices.has(device) ?? false);
  const learnedCountry = (learned?.countries.get(country) ?? 0) > 0;
  const learnedHour = (learned?.hours.get(hour) ?? 0) > 0;
  const deviceApproved = ledger.approvedOnDevice(device) + (learnedDevice ? 1 : 0);
  const countryApproved = ledger.approvedInCountry(country) + (learnedCountry ? 1 : 0);
  if (card.purchases === 0) {
    const evidence: Evidence[] = [
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
    if (learnedDevice || learnedCountry) evidence.push({ fact: "confirmed_by_you_before", value: [learnedDevice && "device", learnedCountry && "country"].filter(Boolean).join(","), comparator: null, threshold: null, source: "memory" });
    if (deviceApproved > 0 && countryApproved > 0) return { guard: "session", verdict: "PASS", evidence, signals: [] };
    // Customers like this one: an hour or country that is odd even for them is worth saying. It still only asks.
    const odd: string[] = [];
    if (peers) {
      if (!peers.hours.has(hour)) odd.push(`${String(hour).padStart(2, "0")}:00 is unusual even for customers like you`);
      if (!peers.countries.has(country)) odd.push(`customers like you rarely buy in ${country}`);
      evidence.push({ fact: "odd_for_customers_like_you", value: odd.length, comparator: "=", threshold: 0, source: `${peers.neighbours.length} customers like you` });
    }
    return {
      guard: "session",
      verdict: "STEP_UP",
      reason_code: "no_session_history",
      evidence,
      message: `We don't have any purchase history for this card yet, so we can't compare this with how you usually shop.${odd.length ? ` Also: ${odd.join("; ")}.` : ""} Approve it and we remember this device.`,
    };
  }

  if (device && !card.devices.has(device) && !learnedDevice) {
    signals.push("new_device");
    text.push("a device you have never used");
  }
  if (card.purchases >= MIN_HISTORY_FOR_HOURS && !card.hours.has(hour) && !learnedHour) {
    signals.push("unusual_hour");
    text.push(`at ${String(hour).padStart(2, "0")}:00, an hour you never shop at`);
  }
  if (auth.recent_attempt_count_10m >= 2) {
    signals.push("quick_series");
    text.push(`${auth.recent_attempt_count_10m} other attempts in 10 minutes`);
  }
  if (!card.countries.has(country) && !learnedCountry) {
    signals.push("new_country");
    text.push(`a shop in ${auth.merchant.merchant_country}, where you never bought`);
  }
  if (!card.merchants.has(auth.merchant.merchant_id) && !learned?.shops.has(auth.merchant.merchant_id)) {
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
