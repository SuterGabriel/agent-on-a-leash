import { useDeviceChrome } from "@/components/chrome/device-chrome";
import { cx } from "@/utils/cx";

interface StatusBarProps {
    /** `light` = white glyphs on a dark background (lock screen). */
    tone?: "dark" | "light";
    className?: string;
}

/** iOS status bar, 54 high: 9:41, Dynamic Island, signal / wifi / battery. */
export const StatusBar = ({ tone = "dark", className }: StatusBarProps) => {
    const showChrome = useDeviceChrome();

    return (
        <div
            aria-hidden
            className={cx("relative flex h-13.5 shrink-0 items-center justify-between pr-7 pl-9", tone === "light" ? "text-white" : "text-primary", className)}
        >
            {showChrome && (
                <>
                    <span className="pt-1 text-lg font-semibold tabular-nums">9:41</span>
                    <span className="absolute top-2.75 left-1/2 h-9.25 w-31.25 -translate-x-1/2 rounded-full bg-brand-solid" />
                    <span className="flex items-center gap-1.5 pt-1">
                        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
                            <rect x="0" y="8" width="3" height="4" rx="1" />
                            <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
                            <rect x="10" y="3" width="3" height="9" rx="1" />
                            <rect x="15" y="0" width="3" height="12" rx="1" />
                        </svg>
                        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor">
                            <path d="M8 2.4c2.2 0 4.2.8 5.7 2.2l1.1-1.1A9.5 9.5 0 0 0 8 .8 9.5 9.5 0 0 0 1.2 3.5l1.1 1.1A8 8 0 0 1 8 2.4Z" />
                            <path d="M8 5.6c1.3 0 2.5.5 3.4 1.3l1.1-1.1A6.4 6.4 0 0 0 8 4a6.4 6.4 0 0 0-4.5 1.8l1.1 1.1A4.9 4.9 0 0 1 8 5.6Z" />
                            <path d="M8 8.8c.5 0 .9.2 1.2.5L8 10.5 6.8 9.3c.3-.3.7-.5 1.2-.5Z" />
                        </svg>
                        <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
                            <rect x="0.5" y="0.5" width="22" height="12" rx="3.5" stroke="currentColor" strokeOpacity="0.4" />
                            <rect x="2" y="2" width="19" height="9" rx="2" fill="currentColor" />
                            <path d="M24.5 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="currentColor" fillOpacity="0.4" />
                        </svg>
                    </span>
                </>
            )}
        </div>
    );
};
