import { motion, useReducedMotion } from "motion/react";
import { duration, ease } from "@/features/shopping-card/motion-tokens";
import { formatChf } from "@/features/shopping-card/format";
import { cx } from "@/utils/cx";

interface BudgetMeterProps {
    /** Label above the amount, e.g. "ChatGPT this week". */
    label?: string;
    total: number;
    spent: number;
    /** e.g. "Rolling 7 days · CHF 44.50 frees up Mon 09:12" */
    caption?: string;
    className?: string;
}

/** "CHF 255.50 left" of "CHF 300". The black bar shows what is spent, like the Viseca one Cockpit bar. */
export const BudgetMeter = ({ label = "This week", total, spent, caption, className }: BudgetMeterProps) => {
    const reduceMotion = useReducedMotion();
    const left = Math.max(0, total - spent);
    const pct = Math.min(100, (spent / total) * 100);

    return (
        <div className={cx("flex flex-col gap-3 rounded-2xl bg-primary p-4", className)}>
            <div className="flex items-end justify-between gap-3">
                <div className="flex flex-col">
                    <span className="text-sm text-tertiary">{label}</span>
                    <span className="text-display-xs font-bold text-primary tabular-nums">{formatChf(left)} left</span>
                </div>
                <div className="flex flex-col items-end">
                    <span className="text-sm text-tertiary tabular-nums">of {formatChf(total, { cents: false })}</span>
                    <span className="text-md text-secondary tabular-nums">{formatChf(spent)} spent</span>
                </div>
            </div>
            <div
                role="meter"
                aria-label={`${label}: ${formatChf(spent)} spent of ${formatChf(total, { cents: false })}, ${formatChf(left)} left`}
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={spent}
                className="h-2 overflow-hidden rounded-full bg-tertiary"
            >
                <motion.div
                    className="h-full rounded-full bg-brand-solid"
                    initial={false}
                    animate={{ width: `${pct}%` }}
                    transition={reduceMotion ? { duration: 0 } : { duration: duration.meter, ease: ease.out }}
                />
            </div>
            {caption && <span className="text-sm text-tertiary">{caption}</span>}
        </div>
    );
};
