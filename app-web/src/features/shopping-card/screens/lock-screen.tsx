import { HomeIndicator } from "@/components/chrome/home-indicator";
import { StatusBar } from "@/components/chrome/status-bar";
import { PushBanner } from "@/components/shopping-card/push-banner";
import { getDecision } from "@/features/shopping-card/demo-data";
import { formatClock } from "@/features/shopping-card/format";
import { usePrototype } from "@/features/shopping-card/prototype-state";

/** 4.0 / 5.1 / 7.1 Push: lock screen, dim wallpaper (bg-brand-solid 90 %), one push banner. */
export const LockScreen = ({ kind }: { kind: "ask" | "stopped" | "burst" }) => {
    const { dispatch, secondsLeft, state } = usePrototype();
    const ask = getDecision(state.waiting?.decisionId ?? "AU0040");

    const push = {
        ask: {
            title: `Your agent wants to pay CHF ${Math.round(ask.amount.chf)} at ${ask.merchant.name}`,
            body: `Tap to answer. ${formatClock(state.waiting ? secondsLeft : 120)} left.`,
            onPress: () => dispatch({ type: "GO", screen: "3.1", sheet: "question" }),
        },
        stopped: {
            title: "We stopped a payment at PixelHarbour",
            body: "It looks like PixelHarbor, but it isn't. Nothing was bought.",
            onPress: () => dispatch({ type: "GO", screen: "5.2", patch: { paymentId: "AU0039" } }),
        },
        burst: {
            title: "We stopped 4 payments, 02:14 to 02:24",
            body: "A new phone tried to pay at shops you never used.",
            onPress: () => dispatch({ type: "GO", screen: "3.1", sheet: "was-this-you" }),
        },
    }[kind];

    return (
        <div className="absolute inset-0 flex flex-col bg-secondary">
            <div className="absolute inset-0 bg-brand-solid/90" />
            <StatusBar tone="light" className="relative" />
            <div className="relative flex flex-1 flex-col items-center px-2 pt-6">
                <span className="text-lg font-semibold text-white/80">Thursday 24 September</span>
                <span className="text-display-2xl font-semibold text-white tabular-nums">9:41</span>
                <PushBanner className="mt-10" title={push.title} body={push.body} onPress={push.onPress} />
            </div>
            <HomeIndicator tone="light" className="relative" />
        </div>
    );
};
