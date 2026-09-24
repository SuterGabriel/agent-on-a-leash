import type { ReactNode } from "react";
import { cx } from "@/utils/cx";

interface GroupedListProps {
    title?: ReactNode;
    /** Right side of the header (e.g. "Show all"). */
    action?: ReactNode;
    footer?: ReactNode;
    children: ReactNode;
    /** Card colour: white on the grey screen (default), grey inside a white sheet. */
    surface?: "primary" | "secondary";
    className?: string;
}

/** Section header + white card (radius 16, no shadow, no border) holding list rows. */
export const GroupedList = ({ title, action, footer, children, surface = "primary", className }: GroupedListProps) => (
    <section className={cx("flex flex-col gap-2", className)}>
        {(title || action) && (
            <div className="flex items-baseline justify-between px-4">
                {title && <h2 className="text-md font-semibold text-primary">{title}</h2>}
                {action}
            </div>
        )}
        <div className={cx("flex flex-col overflow-hidden rounded-2xl", surface === "primary" ? "bg-primary" : "bg-secondary")}>{children}</div>
        {footer && <p className="px-4 text-sm text-tertiary">{footer}</p>}
    </section>
);
