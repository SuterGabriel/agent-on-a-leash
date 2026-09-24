import type { ReactNode } from "react";
import { useId } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FocusScope } from "react-aria";
import { duration, ease } from "@/features/shopping-card/motion-tokens";
import { cx } from "@/utils/cx";

interface BottomSheetProps {
    isOpen: boolean;
    onClose?: () => void;
    title?: ReactNode;
    /** Centred grey body text under the title. */
    description?: ReactNode;
    children?: ReactNode;
    /** Buttons. Pass two buttons for the equal-width side-by-side layout. */
    actions?: ReactNode;
    /** Accessible name when there is no visible title. */
    ariaLabel?: string;
    /** Key that re-triggers the content crossfade when the sheet changes state. */
    contentKey?: string;
    className?: string;
}

/**
 * iOS bottom sheet: grabber, title, body, equal buttons. Scrim black 40 %.
 * Positioned inside the nearest `relative` container (the phone frame), not portalled.
 */
export const BottomSheet = ({ isOpen, onClose, title, description, children, actions, ariaLabel, contentKey, className }: BottomSheetProps) => {
    const reduceMotion = useReducedMotion();
    const titleId = useId();

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="absolute inset-0 z-30 flex flex-col justify-end pt-13.5">
                    <motion.div
                        aria-hidden
                        className="absolute inset-0 bg-overlay/40"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: duration.scrim, ease: "linear" }}
                        onClick={onClose}
                    />
                    <FocusScope contain restoreFocus autoFocus>
                        <motion.div
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby={title ? titleId : undefined}
                            aria-label={title ? undefined : ariaLabel}
                            onKeyDown={(event) => event.key === "Escape" && onClose?.()}
                            className={cx("relative flex max-h-full flex-col overflow-hidden rounded-t-[20px] bg-primary outline-none", className)}
                            initial={reduceMotion ? { opacity: 0 } : { y: "100%" }}
                            animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
                            exit={reduceMotion ? { opacity: 0 } : { y: "100%" }}
                            transition={{ duration: duration.sheet, ease: ease.ios }}
                        >
                            <div className="flex shrink-0 justify-center pt-1.5 pb-2">
                                <span aria-hidden className="h-1.25 w-9 rounded-full bg-quaternary" />
                            </div>
                            <motion.div
                                key={contentKey}
                                className="flex min-h-0 flex-col"
                                initial={contentKey && !reduceMotion ? { opacity: 0 } : false}
                                animate={{ opacity: 1 }}
                                transition={{ duration: duration.screen, ease: ease.out }}
                            >
                                <div className={cx("scrollbar-hide flex min-h-0 flex-col overflow-y-auto px-4", !actions && "pb-9")}>
                                    {(title || description) && (
                                        <div className="flex flex-col items-center gap-2 px-2 pt-2 pb-6 text-center">
                                            {title && (
                                                <h2 id={titleId} className="text-xl font-semibold text-primary">
                                                    {title}
                                                </h2>
                                            )}
                                            {description && <p className="text-lg text-secondary">{description}</p>}
                                        </div>
                                    )}
                                    {children}
                                </div>
                                {actions && <div className="flex shrink-0 gap-3 px-4 pt-4 pb-9 *:flex-1">{actions}</div>}
                            </motion.div>
                        </motion.div>
                    </FocusScope>
                </div>
            )}
        </AnimatePresence>
    );
};
