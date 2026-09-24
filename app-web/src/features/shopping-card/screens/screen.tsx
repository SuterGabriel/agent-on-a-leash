import type { ReactNode } from "react";
import { HomeIndicator } from "@/components/chrome/home-indicator";
import { StatusBar } from "@/components/chrome/status-bar";
import { cx } from "@/utils/cx";

interface ScreenProps {
    nav?: ReactNode;
    children: ReactNode;
    /** Pinned bottom actions (primary + tertiary). */
    footer?: ReactNode;
    /** Floating element above the home indicator (tab bar). */
    floating?: ReactNode;
    /** Vertically centre the content (confirmation screens). */
    centered?: boolean;
    className?: string;
    contentClassName?: string;
}

/** One phone frame: status bar, optional nav, scrollable content, pinned footer, home indicator. */
export const Screen = ({ nav, children, footer, floating, centered, className, contentClassName }: ScreenProps) => (
    <div className={cx("absolute inset-0 flex flex-col bg-secondary", className)}>
        <StatusBar />
        {nav}
        <main
            className={cx(
                "scrollbar-hide flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pt-2 pb-6",
                centered && "justify-center",
                floating && "pb-28",
                contentClassName,
            )}
        >
            {children}
        </main>
        {footer && <div className="flex shrink-0 flex-col gap-1 px-4 pt-3">{footer}</div>}
        {floating && <div className="pointer-events-none absolute inset-x-0 bottom-8.5 flex justify-center *:pointer-events-auto">{floating}</div>}
        <HomeIndicator />
    </div>
);

/** Big confirmation / explainer title block. */
export const Hero = ({ title, body, children, align = "center" }: { title: ReactNode; body?: ReactNode; children?: ReactNode; align?: "center" | "left" }) => (
    <div className={cx("flex flex-col gap-2", align === "center" ? "items-center text-center" : "items-start")}>
        {children}
        <h1 className="text-display-sm font-bold text-primary">{title}</h1>
        {body && <p className="text-lg text-secondary">{body}</p>}
    </div>
);

/** Screen title inside the scroll area (setup steps). */
export const StepTitle = ({ children, body }: { children: ReactNode; body?: ReactNode }) => (
    <div className="flex flex-col gap-2 px-1">
        <h1 className="text-display-sm font-bold text-primary">{children}</h1>
        {body && <p className="text-lg text-secondary">{body}</p>}
    </div>
);

/** White card with padding (status sentences, info boxes). */
export const InfoCard = ({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) => (
    <div className={cx("flex items-start gap-3 rounded-2xl bg-primary p-4 text-lg text-primary", className)}>
        {icon && <span className="mt-0.5 shrink-0 text-primary">{icon}</span>}
        <div className="min-w-0 flex-1">{children}</div>
    </div>
);
