import { useReducedMotion } from "motion/react";
import { formatClock } from "@/features/shopping-card/format";
import { cx } from "@/utils/cx";

interface CountdownRingProps {
    secondsLeft: number;
    total?: number;
    className?: string;
}

/** 96 ring, 4 px grey track, black progress, "1:54" in the centre. Stays black under 0:20 (no red); grey at 0:00. */
export const CountdownRing = ({ secondsLeft, total = 120, className }: CountdownRingProps) => {
    const reduceMotion = useReducedMotion();
    const r = 46;
    const c = 2 * Math.PI * r;
    const progress = Math.max(0, Math.min(1, secondsLeft / total));
    const done = secondsLeft <= 0;

    return (
        <div
            role="timer"
            aria-label={done ? "Time's up" : `${formatClock(secondsLeft)} left to answer`}
            className={cx("relative size-24 shrink-0", className)}
        >
            <svg viewBox="0 0 96 96" className="size-24 -rotate-90">
                <circle cx="48" cy="48" r={r} fill="none" strokeWidth="4" className="stroke-bg-tertiary" />
                <circle
                    cx="48"
                    cy="48"
                    r={r}
                    fill="none"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={c * (1 - progress)}
                    className={cx("stroke-bg-brand-solid", !reduceMotion && "transition-all duration-300 ease-linear")}
                />
            </svg>
            <span
                aria-hidden
                className={cx("absolute inset-0 flex items-center justify-center text-display-xs font-bold tabular-nums", done ? "text-tertiary" : "text-primary")}
            >
                {formatClock(secondsLeft)}
            </span>
        </div>
    );
};
