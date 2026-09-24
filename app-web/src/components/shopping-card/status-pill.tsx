import { cx } from "@/utils/cx";

export type StatusPillStatus = "approved" | "declined" | "waiting" | "active" | "paused" | "off" | "you-declined" | "times-up";

const labels: Record<StatusPillStatus, string> = {
    approved: "Approved",
    declined: "Declined",
    waiting: "Waiting for you",
    active: "Active",
    paused: "Paused",
    off: "Off",
    "you-declined": "You declined",
    "times-up": "Time's up",
};

interface StatusPillProps {
    status: StatusPillStatus;
    className?: string;
}

/**
 * Monochrome status: grey pill + black text for every state; only "Waiting for you" is a black pill.
 * Paused / Off are quieter (grey text). No green, red or yellow.
 */
export const StatusPill = ({ status, className }: StatusPillProps) => (
    <span
        className={cx(
            "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-sm font-medium whitespace-nowrap",
            status === "waiting" ? "bg-brand-solid text-white" : "bg-tertiary",
            status === "paused" || status === "off" ? "text-tertiary" : status !== "waiting" && "text-primary",
            className,
        )}
    >
        {labels[status]}
    </span>
);
