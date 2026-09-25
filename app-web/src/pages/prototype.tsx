import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { DeviceChromeContext } from "@/components/chrome/device-chrome";
import { api, dataMode } from "@/features/shopping-card/api/client";
import { useLiveFeed } from "@/features/shopping-card/api/use-live-feed";
import { scenarioDecisions } from "@/features/shopping-card/demo-data";
import { formatClock } from "@/features/shopping-card/format";
import { PrototypePhone } from "@/features/shopping-card/prototype-phone";
import type { FrameId } from "@/features/shopping-card/prototype-state";
import { PrototypeProvider, currentFrame, usePrototype } from "@/features/shopping-card/prototype-state";
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

/** What the scenario picker says on stage: a title and what the audience will see. Viseca's names stay in the data. */
const SCENE: Record<string, { title: string; shows: string }> = {
    SCEN0000: { title: "Connection check · 1 purchase", shows: "One grocery order, CHF 18 against a CHF 20 limit. Approved, nothing else happens." },
    SCEN0001: {
        title: "Weekly groceries budget · 10 purchases",
        shows: "Groceries, CHF 120 per order and CHF 300 across 7 days. A 5 % overshoot asks, a split order asks, cosmetics in the basket asks, over budget asks, far over the limit declines.",
    },
    SCEN0002: {
        title: "One item, right shop, returns · 12 purchases",
        shows: "Road-running shoes size 43, sports retailer, 14-day returns, max CHF 200. Wrong item, wrong size, wrong shop type, too-short returns and final sale are declined; missing return terms ask.",
    },
    SCEN0003: {
        title: "Above the limit · 11 purchases",
        shows: "Clothing up to CHF 250 from known shops, pause if it does not look like him. A new device at night asks, a burst of four orders from it is stopped, CHF 268 above the limit asks.",
    },
    SCEN0004: {
        title: "Manipulated agent · 11 purchases",
        shows: "The 27-inch monitor from a known seller, CHF 400 or less, nothing added. Duplicate order asks, fake shop PixelHarbour declined, shop text that gives orders asks, protection plan added declined, wrong item declined.",
    },
};

/** One step of the guide. `optional` steps are taps the presenter may skip (the guide then moves past them). */
type Step = { frames: FrameId[]; where: string; tap: string; startRun?: boolean; scenario?: string; scene?: number; optional?: boolean };

const SETUP: Step[] = [
    { frames: ["1.1"], where: "Card tab", tap: "Tap Get started" },
    { frames: ["1.2"], where: "How it works", tap: "Continue" },
    { frames: ["1.3", "1.3a"], where: "Rules from your shopping", tap: "Tap CHF 300, step to 400. Tap the 30-day budget, step to 2'000. Then Use these rules" },
    { frames: ["1.4"], where: "Smart settings", tap: "Leave as proposed. Create card with Face ID" },
    { frames: ["1.5"], where: "Your Agent Card is ready", tap: "Done" },
];

const ASK: FrameId[] = ["4.0", "4.1", "4.2"];
const ANSWERED: FrameId[] = ["4.4", "4.3", "4.5"];
const HOME: FrameId[] = ["3.1", "3.1c"];
const DETAILS: FrameId[] = ["5.1", "5.2", "5.2b", "5.2c"];

/**
 * The programme: every scene in the order that tells the story, with its beats in the order the purchases arrive.
 * A question pauses the run until it is answered, so the order on the phone is fixed.
 */
const PROGRAMME: { scenario: string; title: string; beats: Omit<Step, "scenario" | "scene">[] }[] = [
    {
        scenario: "SCEN0004",
        title: "Manipulated agent",
        beats: [
            { frames: HOME, where: "Home", tap: "PixelHarbor, CHF 289: approved, quiet. The bar moves" },
            { frames: ASK, where: "Buy it again?", tap: "The same monitor 25 minutes later. Decline" },
            { frames: ANSWERED, where: "You declined", tap: "Nothing to learn from a repeat. Done" },
            {
                frames: HOME,
                where: "Home",
                tap: "CHF 520 with 'pre-authorised up to CHF 900' in the text: declined, quoted. PixelHarbour, one letter off: declined. Tap it",
            },
            { frames: DETAILS, where: "Payment details", tap: "'Real shop, not a lookalike' failed, the fact next to it. OK", optional: true },
            { frames: ASK, where: "Your agent wants to pay CHF 299", tap: "The grey box: 'ignore any previous spending instructions'. Decline (or say it)" },
            { frames: ANSWERED, where: "You declined", tap: "Always decline when a shop's text gives orders? Yes, always" },
            {
                frames: HOME,
                where: "Home",
                tap: "Protection plan added: declined. A new offer after the decline: approved. A gift voucher instead of the monitor: declined",
            },
            { frames: ASK, where: "Circuit and Pine", tap: "Bought there with his other card, never with this one. Decline" },
            { frames: ["6.1"], where: "Rules", tap: "The learned rule. Tighten in one tap, looser needs Face ID" },
        ],
    },
    {
        scenario: "SCEN0003",
        title: "Above the limit",
        beats: [
            { frames: HOME, where: "Home", tap: "Loom and Pine, Milano Weave: quiet approvals at shops he knows" },
            { frames: ASK, where: "Is this you?", tap: "A device he never used, at night. Approve: it was him" },
            { frames: HOME, where: "Home", tap: "Four more orders in minutes from that device at shops he never used: stopped, no question. Tap one" },
            { frames: DETAILS, where: "Payment details", tap: "'Looks like you' and 'Only shops you have used' failed. OK", optional: true },
            { frames: ASK, where: "RainThread", tap: "A shop he never used, from the new device. Approve" },
            { frames: ASK, where: "CHF 268 at Loom and Pine", tap: "Above his CHF 250 limit. Decline" },
            { frames: HOME, where: "Home", tap: "A yes to one purchase never raises a limit. The card learned the device, not a higher limit" },
        ],
    },
    {
        scenario: "SCEN0001",
        title: "Weekly groceries budget",
        beats: [
            { frames: HOME, where: "Home", tap: "CHF 44.50, then CHF 120 exactly at the limit: both quiet" },
            { frames: ASK, where: "CHF 126", tap: "5 % over the CHF 120 limit. Decline" },
            { frames: ASK, where: "Second order in 10 minutes", tap: "Together CHF 135. Split order? Decline" },
            { frames: ASK, where: "Fragrance gift in the basket", tap: "Not groceries. Decline" },
            { frames: ANSWERED, where: "You declined", tap: "Never buy cosmetics? Yes, always" },
            { frames: ASK, where: "CHF 324 in 7 days", tap: "Over the CHF 300 budget. Decline" },
            { frames: HOME, where: "Home", tap: "CHF 138: declined without a question. The week rolls on, CHF 88 goes through" },
        ],
    },
    {
        scenario: "SCEN0002",
        title: "One item, right shop, returns",
        beats: [
            { frames: HOME, where: "Home", tap: "The shoes at CHF 165: approved. Then size 42, final sale, 7-day returns: declined quietly. Tap one" },
            { frames: DETAILS, where: "Payment details", tap: "The fact that failed, in his words. OK", optional: true },
            { frames: ASK, where: "No return policy stated", tap: "He asked for 14 days. Decline" },
            { frames: ASK, where: "Protection plan added", tap: "CHF 29 he did not ask for. Decline" },
            { frames: ANSWERED, where: "You declined", tap: "Always decline when something is added? Yes, always" },
            { frames: ASK, where: "CHF 215", tap: "7.5 % over the CHF 200 limit. Decline" },
            { frames: HOME, where: "Home", tap: "A cycling helmet and a sustainable-goods shop: declined. Summit Thread CHF 179: approved" },
        ],
    },
    {
        scenario: "SCEN0000",
        title: "Connection check",
        beats: [{ frames: HOME, where: "Home", tap: "One grocery order, CHF 18 against CHF 20: approved, quiet. That is the whole scene" }],
    },
];

const STEPS: Step[] = [
    ...SETUP,
    ...PROGRAMME.flatMap((sc, n) => [
        {
            frames: (n === 0 ? ["3.1b"] : []) as FrameId[],
            where: `Scene ${n + 1} of ${PROGRAMME.length} · ${sc.title}`,
            tap: SCENE[sc.scenario]?.shows ?? "Start run. The agent goes shopping",
            startRun: true,
            scenario: sc.scenario,
            scene: n,
        },
        ...sc.beats.map((b) => ({ ...b, scene: n })),
    ]),
];

/**
 * Where the guide goes when the phone shows `frame`: only forward, to the next step if it has that frame, or past an
 * optional step to the one after it. Home and the ask sheet come round several times in a scene, so going back or
 * jumping far ahead would put the guide on the wrong beat.
 */
function follow(step: number, frame: FrameId): number {
    const here = STEPS[step];
    if (!here) return step;
    const next = STEPS[step + 1];
    if (next?.frames.includes(frame)) return step + 1;
    const after = STEPS[step + 2];
    if (next?.optional && after?.frames.includes(frame) && after.scene === here.scene) return step + 2;
    return step;
}

/** Live: pick a customer without purchases; 1.3 then proposes rules from their profile and customers like them. */
const ColdStartPicker = () => {
    const { state, dispatch } = usePrototype();
    const [customers, setCustomers] = useState<{ customer_id: string; name: string }[]>([]);
    useEffect(() => {
        api.coldCustomers()
            .then(setCustomers)
            .catch(() => setCustomers([]));
    }, []);
    if (!customers.length) return null;
    return (
        <label className="flex flex-col gap-2">
            <span className="text-md font-semibold text-primary">Customer for setup (1.3)</span>
            <select
                value={state.coldCustomerId ?? ""}
                disabled={state.cardCreated}
                onChange={(e) => dispatch({ type: "PATCH", patch: { coldCustomerId: e.target.value || null, suggest: null } })}
                className="h-11 w-full cursor-pointer rounded-full bg-primary px-4 text-md text-primary outline-focus-ring focus-visible:outline-2 disabled:opacity-50"
            >
                <option value="">This card (its own history)</option>
                {customers.map((c) => (
                    <option key={c.customer_id} value={c.customer_id}>
                        New: {c.name} ({c.customer_id})
                    </option>
                ))}
            </select>
            <span className="px-1 text-sm text-tertiary">{state.cardCreated ? "Turn the card off to set up again." : "A new customer has no purchases: we start from customers like them."}</span>
        </label>
    );
};

/** Outside the phone. In mock mode the buttons stand in for the engine; in live mode the stream drives the phone. */
const DemoControls = () => {
    const { state, dispatch, secondsLeft } = usePrototype();
    const status = useLiveFeed(dispatch);
    const [replay, setReplay] = useState<{ scenario: string; done: number; total: number; running: boolean } | null>(null);
    const timer = useRef<number | null>(null);
    // The mock replay pauses while a question is open, as the backend does: the customer answers, then the run goes on.
    const waitingRef = useRef(false);
    waitingRef.current = !!state.waiting;

    const demo = (d: "approve" | "duplicate" | "lookalike" | "ask" | "burst") => dispatch({ type: "DEMO", demo: d });

    // One demo step at a time. The phone's frame sets the step when it maps to one; Back and Next move it by hand.
    const [step, setStep] = useState(0);

    // Live: the backend replays a scenario through the engine; every decision arrives on the stream.
    const [scenarios, setScenarios] = useState<{ scenario_id: string; scenario_name: string; event_count?: number }[]>([]);
    const [scenario, setScenario] = useState("SCEN0004");
    const [run, setRun] = useState<{ id: string; scenario: string; state: "running" | "finished" | "failed"; error?: string } | null>(null);
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
            .then((r) => {
                setRun({ id: r.run_id, scenario, state: "running" });
                setStep((i) => (STEPS[i]?.startRun ? i + 1 : i));
            })
            .catch((err: Error) => setRun({ id: "", scenario, state: "failed", error: err.message }));
    };
    // Scenes play one after another: poll the backend until the run ended, and only then allow the next Start run.
    useEffect(() => {
        if (!run || run.state !== "running") return;
        const id = window.setInterval(() => {
            api.status()
                .then((st) => {
                    const latest = st.latest_run;
                    if (latest && latest.run_id === run.id && latest.state !== "running") setRun({ ...run, state: latest.state });
                })
                .catch(() => undefined);
        }, 1500);
        return () => window.clearInterval(id);
    }, [run]);
    const running = run?.state === "running";
    const sceneSize = scenarios.find((sc) => sc.scenario_id === run?.scenario)?.event_count ?? 0;

    const clearTimer = () => {
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = null;
    };
    const stopReplay = () => {
        clearTimer();
        setReplay((r) => (r ? { ...r, running: false } : r));
    };

    /**
     * Mock mode: replay a scene's purchases in engine order, one every 2.5 s, from src/mocks/decisions.json.
     * A question pauses the replay until it is answered, so the phone sees the same order as with the backend.
     * Also the backup for a dead Wi-Fi on stage.
     */
    const play = (scenarioId: string) => {
        clearTimer();
        const all = scenarioDecisions(scenarioId);
        let i = 0;
        setReplay({ scenario: scenarioId, done: 0, total: all.length, running: true });
        const next = () => {
            if (waitingRef.current) {
                timer.current = window.setTimeout(next, 500);
                return;
            }
            if (i >= all.length) return stopReplay();
            dispatch({ type: "INGEST", decision: all[i] });
            i += 1;
            setReplay({ scenario: scenarioId, done: i, total: all.length, running: true });
            timer.current = window.setTimeout(next, REPLAY_GAP_MS);
        };
        next();
    };
    /** The guide's "Start scene" in mock mode: like Start run, but the decisions come from the mock data. */
    const startScene = (scenarioId: string) => {
        play(scenarioId);
        setStep((i) => (STEPS[i]?.startRun ? i + 1 : i));
    };

    useEffect(() => clearTimer, []);

    const isLive = dataMode === "live";

    const frame = currentFrame(state);
    const prevFrame = useRef<FrameId | null>(null);
    useEffect(() => {
        if (frame === prevFrame.current) return;
        prevFrame.current = frame;
        setStep((i) => follow(i, frame));
    }, [frame]);
    const current = STEPS[Math.min(step, STEPS.length - 1)]!;
    const next = STEPS[step + 1];
    // Landing on a scene's start step preselects that scene; the picker can still override it.
    useEffect(() => {
        if (current.startRun && current.scenario) setScenario(current.scenario);
    }, [current]);
    const [listOpen, setListOpen] = useState(false);
    /** Choosing a step moves the guide and puts the phone on that step's first screen (the "Next scene" step has none). */
    const goTo = (i: number) => {
        setStep(i);
        const frame = STEPS[i]?.frames[0];
        if (frame) dispatch({ type: "JUMP", frame });
        setListOpen(false);
    };
    /** Clicking the current step does the tap for you: the phone moves on to the next step's screen. */
    const doStep = () => {
        if (current.startRun) return;
        if (next?.startRun) return setStep(step + 1); // the scene card has no screen of its own
        if (next && next.frames.length) goTo(step + 1);
    };
    const canStep = !current.startRun && !!(next?.frames.length || next?.startRun);

    return (
        <aside aria-label="Demo controls" style={{ width: CONTROLS_W }} className="flex max-w-full shrink-0 flex-col gap-6 rounded-2xl bg-secondary p-5">
            <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold text-primary">Demo controls</h2>
                <p className="text-sm text-tertiary">
                    Data: <span className="font-medium text-primary">{status}</span>
                    {isLive ? " · decisions arrive from the backend" : " · set VITE_API_BASE to go live"}
                </p>
            </div>

            {isLive && <ColdStartPicker />}

            {!isLive && (
                <div className="flex flex-col gap-2">
                    <p className="px-1 text-sm text-tertiary">Mock replay (not the engine): our proposed answers from src/mocks/decisions.json.</p>
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
                        onClick={replay?.running ? stopReplay : () => play("SCEN0004")}
                    >
                        {replay?.running ? `Stop replay (${replay.done} of ${replay.total})` : "Play SCEN0004, all 11 purchases"}
                    </Button>
                    {state.waiting && (
                        <p className="px-1 text-sm text-secondary tabular-nums" aria-live="off">
                            Question open · {formatClock(secondsLeft)} left
                        </p>
                    )}
                </div>
            )}

            <div className="flex flex-col gap-2" aria-live="polite">
                <button
                    type="button"
                    className="flex cursor-pointer items-baseline justify-between rounded-lg outline-focus-ring focus-visible:outline-2"
                    aria-expanded={listOpen}
                    onClick={() => setListOpen((o) => !o)}
                >
                    <span className="text-md font-semibold text-primary">Demo, tap by tap {listOpen ? "▾" : "▸"}</span>
                    <span className="text-sm text-tertiary tabular-nums">
                        {step + 1} of {STEPS.length}
                    </span>
                </button>
                {listOpen && (
                    <ol className="flex flex-col gap-1" aria-label="All demo steps">
                        {STEPS.map((st, i) => (
                            <li key={i}>
                                <button
                                    type="button"
                                    onClick={() => goTo(i)}
                                    className={cx(
                                        "w-full cursor-pointer rounded-lg px-3 py-1.5 text-left text-sm outline-focus-ring focus-visible:outline-2",
                                        i === step ? "bg-primary font-semibold text-primary" : "text-secondary hover:bg-primary",
                                    )}
                                >
                                    {i + 1}. {st.where}
                                </button>
                            </li>
                        ))}
                    </ol>
                )}
                <div className="flex flex-col gap-3 rounded-xl bg-primary px-4 py-3">
                    <button
                        type="button"
                        onClick={doStep}
                        disabled={!canStep}
                        title="Click to do this tap on the phone"
                        className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg text-left outline-focus-ring hover:opacity-80 focus-visible:outline-2 disabled:cursor-default disabled:opacity-100"
                    >
                        <span>
                            <span className="block text-md font-semibold text-primary">{current.where}</span>
                            <span className="block text-sm text-secondary">{current.tap}</span>
                        </span>
                        {canStep ? <span className="text-lg text-tertiary group-hover:text-primary">›</span> : null}
                    </button>
                    {current.startRun && !isLive && current.scenario && (
                        <Button size="md" color="primary" isDisabled={!!replay?.running || !!state.waiting} onClick={() => startScene(current.scenario!)}>
                            {replay?.running ? "Scene running…" : "Start scene"}
                        </Button>
                    )}
                    {!isLive && replay && (
                        <p className="text-sm text-secondary" aria-live="polite">
                            {replay.running
                                ? `Scene running · ${replay.done} of ${replay.total} purchases decided`
                                : "Scene finished. Walk through the phone, then click on to the next scene."}
                        </p>
                    )}
                    {current.startRun && isLive && (
                        <div className="flex flex-col gap-2">
                            <select
                                aria-label="Scene"
                                value={scenario}
                                onChange={(e) => setScenario(e.target.value)}
                                className="h-11 w-full cursor-pointer rounded-full bg-secondary px-4 text-md text-primary outline-focus-ring focus-visible:outline-2"
                            >
                                {(scenarios.length ? scenarios : [{ scenario_id: scenario, scenario_name: scenario }]).map((sc) => (
                                    <option key={sc.scenario_id} value={sc.scenario_id}>
                                        {sc.scenario_id} · {SCENE[sc.scenario_id]?.title ?? sc.scenario_name}
                                    </option>
                                ))}
                            </select>
                            {SCENE[scenario] && <p className="text-sm text-tertiary">{SCENE[scenario].shows}</p>}
                            <Button size="md" color="primary" isDisabled={running || !!state.waiting} onClick={startRun}>
                                {running ? "Scene running…" : "Start run"}
                            </Button>
                            {run && (
                                <p className="text-sm text-secondary" aria-live="polite">
                                    {run.error
                                        ? `Could not start: ${run.error}`
                                        : running
                                          ? `Scene running · ${state.activity.length} of ${sceneSize || "?"} purchases decided`
                                          : run.state === "finished"
                                            ? "Scene finished. Walk through the phone, then pick the next scene here."
                                            : "The run failed on the backend. Start it again."}
                                </p>
                            )}
                        </div>
                    )}
                    {isLive && state.waiting && (
                        <p className="text-sm text-secondary tabular-nums" aria-live="off">
                            Question open · {formatClock(secondsLeft)} left
                        </p>
                    )}
                </div>
            </div>

            <VoiceToggle />

            <Button size="md" color="tertiary" onClick={() => dispatch({ type: "RESET" })}>
                Reset demo
            </Button>

            <a
                href="https://github.com/SuterGabriel/agent-on-a-leash"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center rounded-2xl bg-primary px-4 py-3 text-md font-semibold text-primary outline-focus-ring hover:bg-primary_hover focus-visible:outline-2"
            >
                For the code, click here (GitHub)
            </a>
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
