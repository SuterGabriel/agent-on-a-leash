import { useDeviceChrome } from "@/components/chrome/device-chrome";
import { cx } from "@/utils/cx";

interface HomeIndicatorProps {
    tone?: "dark" | "light";
    className?: string;
}

/** iOS home indicator area, 34 high with the 134 × 5 bar. */
export const HomeIndicator = ({ tone = "dark", className }: HomeIndicatorProps) => {
    const showChrome = useDeviceChrome();

    return (
        <div aria-hidden className={cx("flex h-8.5 shrink-0 items-end justify-center pb-2", className)}>
            {showChrome && <span className={cx("h-1.25 w-33.5 rounded-full", tone === "light" ? "bg-primary" : "bg-brand-solid")} />}
        </div>
    );
};
