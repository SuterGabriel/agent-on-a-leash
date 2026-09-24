import { Lock01 } from "@untitledui/icons";
import { cx } from "@/utils/cx";

/** Monochrome Mastercard mark (two interlocking circles). */
const CardMark = ({ className }: { className?: string }) => (
    <svg aria-hidden viewBox="0 0 38 24" className={className}>
        <circle cx="12" cy="12" r="11" fill="currentColor" fillOpacity="0.55" />
        <circle cx="26" cy="12" r="11" fill="currentColor" fillOpacity="0.85" />
    </svg>
);

interface ShoppingCardProps {
    /** default = full card · frozen = grey + lock · small = 40 × 26 row thumbnail */
    variant?: "default" | "frozen" | "small";
    /** shopping = black "Online shopping" card · main = the customer's World Mastercard Gold */
    card?: "shopping" | "main";
    /** Colour picked in 1.3 (shopping card only). `orange` = black with the orange agent ring. */
    surface?: "black" | "grey" | "white" | "orange";
    name?: string;
    last4?: string;
    /** Text next to the lock on the frozen variant ("Frozen" or "Off"). */
    badge?: string;
    className?: string;
}

/**
 * Shopping card artwork, 1.586 : 1, radius 16. Black surface (bg-brand-solid), "Online shopping", orange agent dot,
 * "•• 7310", card mark. Frozen: grey surface + lock. `card="main"` draws the main gold card.
 */
const surfaces = {
    black: "bg-brand-solid text-white",
    grey: "bg-quaternary text-primary",
    white: "bg-primary text-primary",
    orange: "bg-brand-solid text-white ring-3 ring-utility-brand-500 ring-inset",
};

export const ShoppingCard = ({ variant = "default", card = "shopping", surface = "black", name, last4, badge = "Frozen", className }: ShoppingCardProps) => {
    const isMain = card === "main";
    const label = name ?? (isMain ? "World Mastercard Gold CHF" : "Agent Card");
    const digits = last4 ?? (isMain ? "7049" : "7310");

    if (variant === "small") {
        return (
            <span
                aria-hidden
                className={cx(
                    "relative flex h-6.5 w-10 shrink-0 items-end justify-between rounded-sm p-1",
                    isMain ? "bg-utility-brand-200 text-primary" : "bg-brand-solid text-white",
                    className,
                )}
            >
                {!isMain && <span className="absolute top-1 left-1 size-1.5 rounded-full bg-utility-brand-500" />}
                <CardMark className="ml-auto h-2 w-3" />
            </span>
        );
    }

    const frozen = variant === "frozen";

    return (
        <div
            role="img"
            aria-label={`${label} card ending ${digits}${frozen ? `, ${badge.toLowerCase()}` : ""}`}
            className={cx(
                "relative flex aspect-856/540 w-full flex-col justify-between rounded-2xl p-5",
                frozen ? "bg-quaternary text-primary" : isMain ? "bg-utility-brand-200 text-primary" : surfaces[surface],
                className,
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <span className="flex items-center gap-2 text-lg font-semibold">
                    {label}
                    {!isMain && <span className="size-2 rounded-full bg-utility-brand-500" />}
                </span>
                {frozen && (
                    <span className="flex items-center gap-1 text-md font-semibold">
                        <Lock01 className="size-4" />
                        {badge}
                    </span>
                )}
            </div>
            <div className="flex items-end justify-between">
                <span className="text-lg font-medium tracking-wide tabular-nums">•• {digits}</span>
                <CardMark className="h-7 w-11" />
            </div>
        </div>
    );
};
