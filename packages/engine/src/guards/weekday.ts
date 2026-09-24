// Guard: allowed days ("never at the weekend", "weekdays only"), in Swiss local time.
import { swissWeekday } from "../../../shared/src/baselines";
import { WEEKDAYS } from "../../../shared/src/compiler";
import type { Guard } from "../types";

export const allowedWeekday: Guard = ({ policy, simTime }) => {
  const allowed = policy.allowedWeekdays;
  if (!allowed) return { guard: "weekday", verdict: "SKIP", evidence: [] };
  const day = swissWeekday(simTime);
  const evidence = [{ fact: "swiss_weekday", value: WEEKDAYS[day] ?? "unknown", comparator: "in", threshold: allowed.map((d) => WEEKDAYS[d]).join(","), source: "authorization.timestamp" }];
  if (allowed.includes(day)) return { guard: "weekday", verdict: "PASS", evidence };
  return {
    guard: "weekday",
    verdict: "DECLINE",
    reason_code: "not_allowed_day",
    evidence,
    message: `This order is on a ${WEEKDAYS[day] ?? "day"} (Swiss time). You allowed purchases only on ${allowed.map((d) => WEEKDAYS[d]).join(", ")}.`,
  };
};
