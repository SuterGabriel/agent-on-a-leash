// Guard 3: rolling period budget. Counts APPROVED purchases in (t - N days, t], simulated time.
import type { Guard } from "../types";
import { DAY_MS } from "../ledger";
import { chf, limitBand, pct } from "./limitBand";

export const periodBudget: Guard = ({ auth, policy, ledger, simTime }) => {
  const period = policy.periodLimit;
  if (!period) return { guard: "period_budget", verdict: "SKIP", evidence: [] };

  const inWindow = ledger.approvedInWindow(simTime, period.days);
  const before = Math.round(inWindow.reduce((s, e) => s + e.amount_chf, 0) * 100) / 100;
  const total = Math.round((before + auth.billing_amount_chf) * 100) / 100;
  const verdict = limitBand(total, period.amountChf, policy.overshootTolerance);

  const oldest = inWindow.reduce<number | null>((m, e) => (m === null || e.sim_time < m ? e.sim_time : m), null);
  const freesUp = oldest === null ? null : new Date(oldest + period.days * DAY_MS).toISOString();

  const evidence = [
    {
      fact: `approved_spend_${period.days}d_before`,
      value: before,
      comparator: "<=",
      threshold: period.amountChf,
      source: "ledger",
    },
    {
      fact: `total_${period.days}d_with_this_order`,
      value: total,
      comparator: "<=",
      threshold: period.amountChf,
      source: "ledger + authorization.billing_amount_chf",
    },
    { fact: "budget_frees_up_at", value: freesUp, comparator: null, threshold: null, source: "ledger" },
  ];

  if (verdict === "PASS") return { guard: "period_budget", verdict, evidence };

  return {
    guard: "period_budget",
    verdict,
    reason_code: "over_period_budget",
    evidence,
    message:
      verdict === "STEP_UP"
        ? `With this order you would spend ${chf(total)} in ${period.days} days, ${pct(total, period.amountChf)} above your budget of ${chf(period.amountChf)}. Approve anyway?`
        : `With this order you would spend ${chf(total)} in ${period.days} days, above your budget of ${chf(period.amountChf)}.`,
  };
};
