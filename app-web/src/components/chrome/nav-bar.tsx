import type { FC, ReactNode } from "react";
import { ChevronLeft } from "@untitledui/icons";
import { Button as AriaButton } from "react-aria-components";
import { cx } from "@/utils/cx";

interface NavBarButtonProps {
    icon: FC<{ className?: string }>;
    label: string;
    onPress?: () => void;
    className?: string;
}

/** 36 circle icon button used in the nav bar (search, close, more). */
export const NavBarButton = ({ icon: Icon, label, onPress, className }: NavBarButtonProps) => (
    <AriaButton
        aria-label={label}
        onPress={onPress}
        className={cx(
            "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-tertiary text-primary outline-focus-ring transition duration-100 ease-linear pressed:bg-quaternary focus-visible:outline-2 focus-visible:outline-offset-2",
            className,
        )}
    >
        <Icon className="size-5" />
    </AriaButton>
);

interface NavBarProps {
    /** `large` = 28 Bold title left + optional trailing button. `inline` = back chevron + centred 17 Semibold title. */
    variant?: "large" | "inline";
    title?: string;
    /** Label next to the back chevron (inline). Omit for chevron only. */
    backLabel?: string;
    onBack?: () => void;
    /** Leading element instead of the back button (e.g. a close button). */
    leading?: ReactNode;
    trailing?: ReactNode;
    className?: string;
}

export const NavBar = ({ variant = "large", title, backLabel, onBack, leading, trailing, className }: NavBarProps) => {
    if (variant === "large") {
        return (
            <header className={cx("flex shrink-0 items-center justify-between gap-3 px-4 pt-2 pb-3", className)}>
                <h1 className="text-display-sm font-bold text-primary">{title}</h1>
                {trailing}
            </header>
        );
    }

    return (
        <header className={cx("relative flex h-11 shrink-0 items-center justify-between px-2", className)}>
            <div className="z-10 flex min-w-0 items-center">
                {leading ??
                    (onBack && (
                        <AriaButton
                            onPress={onBack}
                            aria-label={backLabel ? undefined : "Back"}
                            className="flex h-11 cursor-pointer items-center gap-0.5 rounded-lg pr-2 text-lg text-primary outline-focus-ring pressed:opacity-60 focus-visible:outline-2"
                        >
                            <ChevronLeft className="size-7" />
                            {backLabel && <span>{backLabel}</span>}
                        </AriaButton>
                    ))}
            </div>
            {title && (
                <h1 className="pointer-events-none absolute inset-x-24 truncate text-center text-lg font-semibold text-primary">{title}</h1>
            )}
            <div className="z-10 flex items-center">{trailing}</div>
        </header>
    );
};
