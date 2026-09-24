import type { Budget, Decision } from "@leash/shared";

const APPROVED = new Set(["approved", "approved_by_you"]);
const DAY_MS = 24 * 3600 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Rolling budget in simulated time: "now" is the latest purchase we saw. Only approved purchases count;
 * asks waiting for the customer do not. next_release = the oldest approved purchase leaving the window.
 */
export function computeBudget(limitChf: number, periodDays: number, decisions: Pick<Decision, "status" | "purchased_at" | "amount">[]): Budget {
  const times = decisions.map((d) => Date.parse(d.purchased_at)).filter((t) => !Number.isNaN(t));
  if (times.length === 0) return { period_days: periodDays, limit_chf: limitChf, spent_chf: 0, left_chf: limitChf, next_release: null };
  const now = Math.max(...times);
  const windowStart = now - periodDays * DAY_MS;
  const inWindow = decisions
    .filter((d) => APPROVED.has(d.status) && Date.parse(d.purchased_at) > windowStart && Date.parse(d.purchased_at) <= now)
    .sort((a, b) => a.purchased_at.localeCompare(b.purchased_at));
  const spent = round2(inWindow.reduce((s, d) => s + d.amount.chf, 0));
  const oldest = inWindow[0];
  return {
    period_days: periodDays,
    limit_chf: limitChf,
    spent_chf: spent,
    left_chf: round2(Math.max(0, limitChf - spent)),
    next_release: oldest ? { amount_chf: oldest.amount.chf, at: new Date(Date.parse(oldest.purchased_at) + periodDays * DAY_MS).toISOString() } : null,
  };
}
