import type { Dispatch } from "react";
import { useEffect, useState } from "react";
import { api, dataMode } from "@/features/shopping-card/api/client";
import { registerLiveDecision } from "@/features/shopping-card/api/live-decisions";
import type { Leash } from "@/features/shopping-card/api/types";
import type { Action, State } from "@/features/shopping-card/prototype-state";
import type { Decision } from "@/types/decision";

/**
 * Live mode only (VITE_API_BASE set): loads the leash and the feed once, then turns Server-Sent Events into reducer actions.
 * Mock mode: does nothing, the demo controls dispatch the same `INGEST` action.
 */
export const useLiveFeed = (dispatch: Dispatch<Action>) => {
    const [status, setStatus] = useState<"mock" | "connecting" | "live" | "offline">(dataMode === "live" ? "connecting" : "mock");

    useEffect(() => {
        if (dataMode !== "live") return;
        let cancelled = false;

        // Every decision from the backend is registered before it reaches the reducer, so the screens can open it by id.
        const ingest = (decision: Decision, quiet?: boolean) => {
            registerLiveDecision(decision);
            dispatch({ type: "INGEST", decision, quiet });
        };

        /** What the phone shows of the leash: the numbers on 6.1, the switches on 1.4, the learned rules, the budget bar. */
        const leashPatch = (leash: Leash): Partial<State> => ({
            cardCreated: leash.status !== "off",
            rules: leash.rules,
            smart: leash.smart,
            monthSpent: leash.month_spent_chf,
            frozen: leash.status === "paused",
            learned: leash.learned.map((l) => ({ text: l.text, added: "Added today" })),
            taskActive: leash.task !== null,
        });

        // The leash first (an existing Agent Card skips onboarding), then the feed. A missing leash is not an outage.
        api.getLeash()
            .then((leash) => {
                if (!cancelled && leash.status !== "off") dispatch({ type: "GO", screen: "3.1", patch: leashPatch(leash) });
            })
            .catch(() => undefined)
            .then(() => api.feed())
            .then((feed) => {
                if (cancelled) return;
                [...feed.decisions].reverse().forEach((d) => ingest(d, true));
                feed.asks.forEach((d) => ingest(d, true));
                setStatus("live");
                dispatch({ type: "PATCH", patch: { offline: false } });
            })
            .catch(() => {
                setStatus("offline");
                dispatch({ type: "PATCH", patch: { offline: true } });
            });

        const stop = api.stream(
            (e) => {
                switch (e.type) {
                    case "decision":
                        ingest(e.decision);
                        break;
                    case "ask":
                        ingest(e.decision);
                        break;
                    case "ask_expired":
                        dispatch({ type: "TIME_UP" });
                        break;
                    case "leash_changed":
                        dispatch({ type: "PATCH", patch: leashPatch(e.leash) });
                        break;
                }
                setStatus("live");
                dispatch({ type: "PATCH", patch: { offline: false } });
            },
            () => {
                setStatus("offline");
                dispatch({ type: "PATCH", patch: { offline: true } });
            },
        );

        return () => {
            cancelled = true;
            stop();
        };
    }, [dispatch]);

    return status;
};
