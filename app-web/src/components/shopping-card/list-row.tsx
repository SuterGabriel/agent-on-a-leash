import type { FC, ReactNode } from "react";
import { Check, ChevronRight } from "@untitledui/icons";
import { Button as AriaButton } from "react-aria-components";
import { Toggle } from "@/components/base/toggle/toggle";
import type { StatusPillStatus } from "@/components/shopping-card/status-pill";
import { StatusPill } from "@/components/shopping-card/status-pill";
import { cx } from "@/utils/cx";

export type ListRowTrailing = "chevron" | "value" | "toggle" | "check" | "none";

interface ListRowProps {
    title: ReactNode;
    subtitle?: ReactNode;
    /** 40 grey icon circle. */
    icon?: FC<{ className?: string }>;
    /** Custom leading element (avatar, card thumbnail). Wins over `icon`. */
    leading?: ReactNode;
    trailing?: ListRowTrailing;
    /** Trailing value (amount). Right-aligned, tabular. */
    value?: ReactNode;
    /** Declined amounts: grey + strike-through. */
    valueStruck?: boolean;
    /** Status pill before the chevron / instead of a value. */
    pill?: StatusPillStatus;
    /** Anything custom on the right (e.g. a small "Block" button). */
    accessory?: ReactNode;
    /** Check trailing: shows the check when true. */
    isSelected?: boolean;
    /** Toggle trailing. */
    toggle?: { isSelected: boolean; onChange?: (value: boolean) => void; isDisabled?: boolean };
    destructive?: boolean;
    /** Regular weight title (settings-style rows). */
    plainTitle?: boolean;
    onPress?: () => void;
    className?: string;
}

/**
 * Grouped list row (iOS inset grouped). Divider is inset to the text (68 with a leading element, 16 without)
 * and disappears on the last row of a group.
 */
export const ListRow = ({
    title,
    subtitle,
    icon: Icon,
    leading,
    trailing = "none",
    value,
    valueStruck,
    pill,
    accessory,
    isSelected,
    toggle,
    destructive,
    plainTitle,
    onPress,
    className,
}: ListRowProps) => {
    const lead = leading ?? (Icon ? <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tertiary text-primary"><Icon className="size-5" /></span> : null);

    const content = (
        <>
            {lead}
            <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 border-b border-secondary py-3 pr-4 group-last/row:border-b-0">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={cx("text-lg text-primary", !plainTitle && "font-semibold", destructive && "text-error-primary")}>{title}</span>
                    {subtitle && <span className="text-sm text-pretty text-secondary">{subtitle}</span>}
                </div>
                {value !== undefined && (
                    <span className={cx("shrink-0 text-right text-lg tabular-nums", valueStruck ? "text-tertiary line-through" : "text-primary")}>{value}</span>
                )}
                {pill && <StatusPill status={pill} />}
                {accessory}
                {trailing === "toggle" && toggle && (
                    <Toggle
                        size="md"
                        aria-label={typeof title === "string" ? title : undefined}
                        isSelected={toggle.isSelected}
                        onChange={toggle.onChange}
                        isDisabled={toggle.isDisabled}
                    />
                )}
                {trailing === "check" && <Check aria-hidden className={cx("size-5 shrink-0 text-primary", !isSelected && "invisible")} />}
                {trailing === "chevron" && <ChevronRight aria-hidden className="-mr-1 size-5 shrink-0 text-fg-quaternary" />}
            </div>
        </>
    );

    const root = "group/row flex w-full items-center gap-3 pl-4 text-left";

    if (onPress && trailing !== "toggle") {
        return (
            <AriaButton
                onPress={onPress}
                aria-pressed={trailing === "check" ? !!isSelected : undefined}
                className={cx(root, "cursor-pointer outline-focus-ring transition duration-100 ease-linear pressed:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2", className)}
            >
                {content}
            </AriaButton>
        );
    }

    return <div className={cx(root, className)}>{content}</div>;
};
