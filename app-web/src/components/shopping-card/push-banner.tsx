import { Button as AriaButton } from "react-aria-components";
import { cx } from "@/utils/cx";

interface PushBannerProps {
    title: string;
    body: string;
    /** App name shown above the title. */
    appName?: string;
    time?: string;
    onPress?: () => void;
    className?: string;
}

/** App icon for the Viseca one app: white tile with the orange ring. */
export const AppIcon = ({ className }: { className?: string }) => (
    <span aria-hidden className={cx("flex size-9.5 shrink-0 items-center justify-center rounded-lg border border-secondary bg-primary", className)}>
        <span className="size-5 rounded-full border-3 border-utility-brand-500" />
    </span>
);

/** iOS notification banner: one app icon, "one", "now", title, body. */
export const PushBanner = ({ title, body, appName = "one", time = "now", onPress, className }: PushBannerProps) => (
    <AriaButton
        onPress={onPress}
        aria-label={`${appName}: ${title}. ${body}`}
        className={cx(
            "flex w-full cursor-pointer items-start gap-3 rounded-3xl bg-primary p-3.5 text-left outline-focus-ring transition duration-100 ease-linear pressed:scale-98 focus-visible:outline-2",
            className,
        )}
    >
        <AppIcon />
        <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-primary">{appName}</span>
                <span className="text-sm text-tertiary">{time}</span>
            </span>
            <span className="text-md font-semibold text-primary">{title}</span>
            <span className="text-md text-secondary">{body}</span>
        </span>
    </AriaButton>
);
