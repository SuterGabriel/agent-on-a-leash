// Guard: how many orders ("one a day", "at most two per week"). Counts APPROVED orders in this run's ledger,
// in simulated time. One day = the same Swiss calendar day; longer periods are rolling windows.
import { swissDate } from "../../../shared/src/baselines";
import type { Guard } from "../types";

export const orderFrequency: Guard = ({ policy, ledger, simTime }) => {
  const max = policy.maxOrdersPerPeriod;
  if (!max) return { guard: "order_frequency", verdict: "SKIP", evidence: [] };

  const today = swissDate(simTime);
  const earlier =
    max.days === 1
      ? ledger.all().filter((e) => e.final_status === "approved" && e.sim_time <= simTime && swissDate(e.sim_time) === today)
      : ledger.approvedInWindow(simTime, max.days);
  const period = max.days === 1 ? `on ${today}` : `in ${max.days} days`;
  const evidence = [
    { fact: max.days === 1 ? "approved_orders_same_day" : `approved_orders_${max.days}d`, value: earlier.length, comparator: "<", threshold: max.count, source: "ledger" },
  ];
  if (earlier.length < max.count) return { guard: "order_frequency", verdict: "PASS", evidence };
  return {
    guard: "order_frequency",
    verdict: "DECLINE",
    reason_code: "too_many_orders",
    evidence,
    message: `You already have ${earlier.length} approved order(s) ${period}. You allowed ${max.count}.`,
  };
};
