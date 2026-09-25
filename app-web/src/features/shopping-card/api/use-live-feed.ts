import type { Dispatch } from "react";
import { useEffect, useState } from "react";
import { api, dataMode } from "@/features/shopping-card/api/client";
import { registerLiveDecision } from "@/features/shopping-card/api/live-decisions";
import type { Action } from "@/features/shopping-card/prototype-state";
import { leashPatch } from "@/features/shopping-card/prototype-state";
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

        // The leash first (an existing Agent Card skips onboarding), then the feed. A missing leash is not an outage.
        api.getLeash()
            .then((leash) => {
                if (!cancelled && leash.status !== "off") dispatch({ type: "GO", screen: "3.1", patch: leashPatch(leash) });
            })
            .catch(() => undefined)
            .then(() => api.memory().then((memory) => !cancelled && dispatch({ type: "PATCH", patch: { memory } })).catch(() => undefined))
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
