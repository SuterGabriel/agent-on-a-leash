import { useEffect, useState } from "react";
import { Check, FaceId } from "@untitledui/icons";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { duration, ease } from "@/features/shopping-card/motion-tokens";
import { cx } from "@/utils/cx";

/** Small Face ID glyph for buttons ("Approve", "Create with Face ID"). */
export const FaceIdGlyph = ({ className }: { className?: string }) => <FaceId aria-hidden className={cx("size-5", className)} />;

interface FaceIdOverlayProps {
    isActive: boolean;
    onDone: () => void;
}

/** Fake Face ID: glyph pulses (~500 ms), turns into a check, then calls onDone (~800 ms total). */
export const FaceIdOverlay = ({ isActive, onDone }: FaceIdOverlayProps) => {
    const reduceMotion = useReducedMotion();
    const [phase, setPhase] = useState<"scan" | "done">("scan");

    useEffect(() => {
        if (!isActive) return;
        setPhase("scan");
        const t1 = window.setTimeout(() => setPhase("done"), duration.faceIdScan * 1000);
        const t2 = window.setTimeout(onDone, duration.faceIdTotal * 1000);
        return () => {
            window.clearTimeout(t1);
            window.clearTimeout(t2);
        };
    }, [isActive, onDone]);

    return (
        <AnimatePresence>
            {isActive && (
                <motion.div
                    className="absolute inset-0 z-50 flex items-center justify-center"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, ease: "linear" }}
                    role="status"
                    aria-live="polite"
                    aria-label={phase === "scan" ? "Face ID" : "Confirmed"}
                >
                    <div className="flex size-40 flex-col items-center justify-center gap-3 rounded-3xl bg-tertiary text-primary">
                        <motion.span
                            animate={reduceMotion || phase === "done" ? { scale: 1 } : { scale: [1, 0.9, 1] }}
                            transition={{ duration: duration.faceIdScan, ease: ease.out }}
                        >
                            {phase === "scan" ? <FaceId className="size-16" strokeWidth={1.5} /> : <Check className="size-16" strokeWidth={1.5} />}
                        </motion.span>
                        <span className="text-md font-semibold">Face ID</span>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
