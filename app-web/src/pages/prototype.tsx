import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { DeviceChromeContext } from "@/components/chrome/device-chrome";
import { api, dataMode } from "@/features/shopping-card/api/client";
import { useLiveFeed } from "@/features/shopping-card/api/use-live-feed";
import { scenarioDecisions } from "@/features/shopping-card/demo-data";
import { formatClock } from "@/features/shopping-card/format";
import { PrototypePhone } from "@/features/shopping-card/prototype-phone";
import type { FrameId } from "@/features/shopping-card/prototype-state";
import { PrototypeProvider, currentFrame, frames, usePrototype } from "@/features/shopping-card/prototype-state";
import { VoiceProvider } from "@/features/voice/voice-provider";
import { VoiceToggle } from "@/features/voice/voice-status";
import { cx } from "@/utils/cx";

const PHONE_W = 393;
const PHONE_H = 852;
const BEZEL = 10;

const useMatchMedia = (query: string) => {
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const mql = window.matchMedia(query);
        const onChange = () => setMatches(mql.matches);
        onChange();
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
    }, [query]);
    return matches;
};

const CONTROLS_W = 320;
const GAP = 40;

/** Scale the device so the whole phone fits next to the demo controls (height and width), never below 0.5. */
const useFitScale = (sideBySide: boolean) => {
    const [scale, setScale] = useState(1);
    useEffect(() => {
        const update = () => {
            const byHeight = (window.innerHeight - 48) / (PHONE_H + BEZEL * 2);
            const byWidth = (window.innerWidth - 48 - (sideBySide ? CONTROLS_W + GAP : 0)) / (PHONE_W + BEZEL * 2);
            setScale(Math.max(0.5, Math.min(1, byHeight, byWidth)));
        };
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, [sideBySide]);
    return scale;
};

const REPLAY_GAP_MS = 2500;

/** Outside the phone. In mock mode the buttons stand in for the engine; in live mode the stream drives the phone. */
const DemoControls = () => {
    const { state, dispatch, secondsLeft } = usePrototype();
    const status = useLiveFeed(dispatch);
    const [playing, setPlaying] = useState<number | null>(null);
    const timer = useRef<number | null>(null);

    const demo = (d: "approve" | "duplicate" | "lookalike" | "ask" | "burst") => dispatch({ type: "DEMO", demo: d });

    // Live: the backend replays a scenario through the engine; every decision arrives on the stream.
    const [scenarios, setScenarios] = useState<{ scenario_id: string; scenario_name: string }[]>([]);
    const [scenario, setScenario] = useState("SCEN0004");
    const [run, setRun] = useState<{ id: string; error?: string } | null>(null);
    useEffect(() => {
        if (dataMode !== "live") return;
        api.scenarios()
            .then((list) => {
                setScenarios(list);
                if (list.length && !list.some((s) => s.scenario_id === scenario)) setScenario(list[0].scenario_id);
            })
            .catch(() => setScenarios([]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const startRun = () => {
        setRun(null);
        api.startRun(scenario)
            .then((r) => setRun({ id: r.run_id }))
            .catch((err: Error) => setRun({ id: "", error: err.message }));
    };

    const stopReplay = () => {
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = null;
        setPlaying(null);
    };

    /** Replay all SCEN0004 purchases in order, one every 2.5 s. Backup for a dead Wi-Fi on stage. */
    const play = () => {
        stopReplay();
        const all = scenarioDecisions("SCEN0004");
        let i = 0;
        const next = () => {
            if (i >= all.length) return stopReplay();
            dispatch({ type: "INGEST", decision: all[i] });
            i += 1;
            setPlaying(i);
            timer.current = window.setTimeout(next, REPLAY_GAP_MS);
        };
        next();
    };

    useEffect(() => () => stopReplay(), []);

    const isLive = dataMode === "live";

    return (
        <aside aria-label="Demo controls" style={{ width: CONTROLS_W }} className="flex max-w-full shrink-0 flex-col gap-6 rounded-2xl bg-secondary p-5">
            <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold text-primary">Demo controls</h2>
                <p className="text-sm text-tertiary">
                    Data: <span className="font-medium text-primary">{status}</span>
                    {isLive ? " · decisions arrive from the backend" : " · set VITE_API_BASE to go live"}
                </p>
            </div>

            {isLive && (
                <div className="flex flex-col gap-2">
                    <label className="flex flex-col gap-2">
                        <span className="text-md font-semibold text-primary">Scenario on the backend</span>
                        <select
                            value={scenario}
                            onChange={(e) => setScenario(e.target.value)}
                            className="h-11 w-full cursor-pointer rounded-full bg-primary px-4 text-md text-primary outline-focus-ring focus-visible:outline-2"
                        >
                            {(scenarios.length ? scenarios : [{ scenario_id: scenario, scenario_name: scenario }]).map((s) => (
                                <option key={s.scenario_id} value={s.scenario_id}>
                                    {s.scenario_id} · {s.scenario_name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <Button
                        size="md"
                        color="secondary"
                        className="h-auto min-h-10 justify-start bg-primary py-2 text-left whitespace-normal"
                        onClick={startRun}
                    >
                        Start run: the agent shops with your card rules
                    </Button>
                    {run && (
                        <p className="px-1 text-sm text-secondary" aria-live="polite">
                            {run.error ? `Could not start: ${run.error}` : `Run ${run.id} started. Decisions arrive on the stream.`}
                        </p>
                    )}
                    {state.waiting && (
                        <p className="px-1 text-sm text-secondary tabular-nums" aria-live="off">
                            Question open · {formatClock(secondsLeft)} left
                        </p>
                    )}
                </div>
            )}

            {!isLive && (
                <div className="flex flex-col gap-2">
                    <Button
                        size="md"
                        color="secondary"
                        className="h-auto min-h-10 justify-start bg-primary py-2 text-left whitespace-normal"
                        onClick={() => demo("approve")}
                    >
                        Agent pays PixelHarbor CHF 289 (approved, quiet)
                    </Button>
                    <Button
                        size="md"
                        color="secondary"
                        className="h-auto min-h-10 justify-start bg-primary py-2 text-left whitespace-normal"
                        onClick={() => demo("duplicate")}
                    >
                        Same order again (declined, quiet)
                    </Button>
                    <Button
                        size="md"
                        color="secondary"
                        className="h-auto min-h-10 justify-start bg-primary py-2 text-left whitespace-normal"
                        onClick={() => demo("lookalike")}
                    >
                        Lookalike shop PixelHarbour (declined, push)
                    </Button>
                    <Button
                        size="md"
                        color="secondary"
                        className="h-auto min-h-10 justify-start bg-primary py-2 text-left whitespace-normal"
                        onClick={() => demo("ask")}
                    >
                        Shop text gives orders (ask me, 2:00)
                    </Button>
                    <Button
                        size="md"
                        color="secondary"
                        className="h-auto min-h-10 justify-start bg-primary py-2 text-left whitespace-normal"
                        onClick={() => demo("burst")}
                    >
                        Unusual burst at 02:14 (was this you?)
                    </Button>
                    <Button
                        size="md"
                        color="secondary"
                        className="h-auto min-h-10 justify-start bg-primary py-2 text-left whitespace-normal"
                        onClick={playing ? stopReplay : play}
                    >
                        {playing ? `Stop replay (${playing} of 11)` : "Play SCEN0004, all 11 purchases"}
                    </Button>
                    {state.waiting && (
                        <p className="px-1 text-sm text-secondary tabular-nums" aria-live="off">
                            Question open · {formatClock(secondsLeft)} left
                        </p>
                    )}
                </div>
            )}

            <VoiceToggle />

            <label className="flex flex-col gap-2">
                <span className="text-md font-semibold text-primary">Jump to screen</span>
                <select
                    value={currentFrame(state)}
                    onChange={(e) => dispatch({ type: "JUMP", frame: e.target.value as FrameId })}
                    className="h-11 w-full cursor-pointer rounded-full bg-primary px-4 text-md text-primary outline-focus-ring focus-visible:outline-2"
                >
                    {frames.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.name}
                        </option>
                    ))}
                </select>
            </label>

            <Button size="md" color="tertiary" onClick={() => dispatch({ type: "RESET" })}>
                Reset demo
            </Button>
        </aside>
    );
};

/** /prototype — clickable Agent Card prototype (concept: 06_product/09-concept-v4-agent-card.md). */
export const PrototypePage = () => {
    const isPhone = useMatchMedia("(max-width: 499px)");
    const sideBySide = useMatchMedia("(min-width: 900px)");
    const scale = useFitScale(sideBySide);

    useEffect(() => {
        document.title = "Agent Card prototype";
    }, []);

    return (
        <PrototypeProvider>
            <VoiceProvider>
                <DeviceChromeContext.Provider value={!isPhone}>
                    {isPhone ? (
                        <div className="flex flex-col bg-primary">
                            <div className="relative h-dvh w-full">
                                <PrototypePhone />
                            </div>
                            <div className="flex justify-center p-4">
                                <DemoControls />
                            </div>
                        </div>
                    ) : (
                        <div className={cx("flex min-h-dvh items-center justify-center bg-primary p-6", sideBySide ? "flex-row gap-10" : "flex-col gap-8")}>
                            {/* Outer box is the scaled size; the bezel keeps its own fixed size so the screen can never slide out of it. */}
                            <div style={{ width: (PHONE_W + BEZEL * 2) * scale, height: (PHONE_H + BEZEL * 2) * scale }} className="shrink-0">
                                <div
                                    style={{
                                        width: PHONE_W + BEZEL * 2,
                                        height: PHONE_H + BEZEL * 2,
                                        transform: `scale(${scale})`,
                                        transformOrigin: "top left",
                                        padding: BEZEL,
                                    }}
                                    className="rounded-[62px] bg-brand-solid"
                                >
                                    <div style={{ width: PHONE_W, height: PHONE_H }} className="relative overflow-hidden rounded-[52px]">
                                        <PrototypePhone />
                                    </div>
                                </div>
                            </div>
                            <DemoControls />
                        </div>
                    )}
                </DeviceChromeContext.Provider>
            </VoiceProvider>
        </PrototypeProvider>
    );
};
