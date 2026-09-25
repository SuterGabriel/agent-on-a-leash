// Guard: night, 23:00–06:00 Swiss time. "decline": nothing is bought at night; "ask": the customer is asked first.
// A night hour the customer already vouched for on this device ("Yes, it was me") is theirs: it passes.
import { swissHour } from "../../../shared/src/baselines";
import type { Guard } from "../types";

export const NIGHT_HOURS = new Set([23, 0, 1, 2, 3, 4, 5]);

export const nightPurchase: Guard = ({ auth, policy, learned }) => {
  if (!policy.nightAction) return { guard: "night", verdict: "SKIP", evidence: [] };
  const hour = swissHour(auth.timestamp);
  const evidence = [{ fact: "swiss_local_hour", value: hour, comparator: "not_in", threshold: "23-06", source: "authorization.timestamp" }];
  if (!NIGHT_HOURS.has(hour)) return { guard: "night", verdict: "PASS", evidence };

  const device = auth.customer_device_id;
  if (learned && device && learned.devices.has(device) && (learned.hours.get(hour) ?? 0) > 0) {
    return { guard: "night", verdict: "PASS", evidence: [...evidence, { fact: "night_hour_confirmed_by_you", value: learned.hours.get(hour) ?? 0, comparator: ">=", threshold: 1, source: "memory" }] };
  }
  const at = `${String(hour).padStart(2, "0")}:00`;
  return policy.nightAction === "decline"
    ? { guard: "night", verdict: "DECLINE", reason_code: "night_purchase", evidence, message: `This purchase is at ${at} (Swiss time). You said nothing is bought at night.` }
    : { guard: "night", verdict: "STEP_UP", reason_code: "night_purchase", evidence, message: `This purchase is at ${at} (Swiss time). You asked to be asked at night.` };
};
