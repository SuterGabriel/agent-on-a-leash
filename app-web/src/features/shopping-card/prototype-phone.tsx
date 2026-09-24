import { useCallback, useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { PushBanner } from "@/components/shopping-card/push-banner";
import { FaceIdOverlay } from "@/features/shopping-card/face-id";
import { formatClock } from "@/features/shopping-card/format";
import { bannerDwellMs, duration, ease, screenOffset } from "@/features/shopping-card/motion-tokens";
import { usePrototype } from "@/features/shopping-card/prototype-state";
import { SheetHost, screens } from "@/features/shopping-card/screens";

/** In-app push banner: slides in from the top, tap opens the screen, slides away after a while. */
const BannerHost = () => {
    const { state, dispatch, secondsLeft } = usePrototype();
    const reduceMotion = useReducedMotion();
    const banner = state.banner;

    useEffect(() => {
        if (!banner) return;
        const t = window.setTimeout(() => dispatch({ type: "DISMISS_BANNER" }), bannerDwellMs);
        return () => window.clearTimeout(t);
    }, [banner, dispatch]);

    const body = banner?.kind === "ask" ? `Tap to answer. ${formatClock(state.waiting ? secondsLeft : 0)} left.` : banner?.body;

    return (
        <AnimatePresence>
            {banner && (
                <motion.div
                    key={banner.key}
                    className="absolute inset-x-2 top-14 z-40"
                    initial={reduceMotion ? { opacity: 0 } : { y: "-140%" }}
                    animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { y: "-140%" }}
                    transition={{ duration: duration.banner, ease: ease.ios }}
                >
                    <PushBanner
                        title={banner.title}
                        body={body ?? ""}
                        onPress={() => {
                            dispatch({ type: "DISMISS_BANNER" });
                            dispatch(banner.target);
                        }}
                    />
                </motion.div>
            )}
        </AnimatePresence>
    );
};

/** Everything inside the phone: current screen, sheets, push banner, Face ID. */
export const PrototypePhone = () => {
    const { state, dispatch } = usePrototype();
    const reduceMotion = useReducedMotion();
    const onFaceIdDone = useCallback(() => dispatch({ type: "FACE_ID_DONE" }), [dispatch]);
    const Current = screens[state.screen];

    return (
        <div className="relative size-full overflow-hidden bg-secondary">
            <motion.div
                key={state.screen}
                className="absolute inset-0"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: screenOffset }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: duration.screen, ease: ease.ios }}
            >
                <Current />
            </motion.div>
            <SheetHost />
            <BannerHost />
            <FaceIdOverlay isActive={!!state.faceId} onDone={onFaceIdDone} />
        </div>
    );
};
