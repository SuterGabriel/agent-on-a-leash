import type { Dispatch, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api, dataMode } from "@/features/shopping-card/api/client";
import type { ActivityItem, RuleKey, SmartSettings } from "@/features/shopping-card/demo-data";
import { burstIds, defaultSmart, getDecision, pushReasons, rowFor, suggestedValues, suggestionFor } from "@/features/shopping-card/demo-data";
import type { Decision } from "@/types/decision";

// ---------- screens, sheets, frames (concept v4: 06_product/09-concept-v4-agent-card.md) ----------

export type ScreenId = "1.1" | "1.2" | "1.3" | "1.4" | "1.5" | "3.1" | "4.0" | "5.1" | "5.2" | "6.1" | "6.3" | "7.1" | "7.3" | "7.3b";

export type SheetId = "edit-rule" | "question" | "approved" | "declined" | "timesup" | "was-this-you" | "freeze" | "turn-off";

/** Every frame, as listed in "Jump to screen". Mirrors the Figma page "UI mobile v3 · demo". */
export const frames = [
    { id: "1.1", name: "1.1 Card tab · banner" },
    { id: "1.2", name: "1.2 How it works" },
    { id: "1.3", name: "1.3 Rules from your shopping" },
    { id: "1.3a", name: "1.3a Change a value (sheet)" },
    { id: "1.4", name: "1.4 Smart settings" },
    { id: "1.5", name: "1.5 Your Agent Card is ready" },
    { id: "3.1", name: "3.1 Agent Card home" },
    { id: "3.1b", name: "3.1b Home · no payments yet" },
    { id: "3.1c", name: "3.1c Home · Viseca offline" },
    { id: "4.0", name: "4.0 Push · your agent wants to pay" },
    { id: "4.1", name: "4.1 Ask me sheet" },
    { id: "4.2", name: "4.2 Ask me · see checks" },
    { id: "4.3", name: "4.3 Approved by you" },
    { id: "4.4", name: "4.4 You declined · learned rule" },
    { id: "4.5", name: "4.5 Time's up" },
    { id: "5.1", name: "5.1 Push · payment stopped" },
    { id: "5.2", name: "5.2 Payment details · lookalike shop" },
    { id: "5.2b", name: "5.2b Payment details · shop gave orders" },
    { id: "5.2c", name: "5.2c Payment details · approved" },
    { id: "6.1", name: "6.1 Rules (control centre)" },
    { id: "6.2", name: "6.2 Tighten a rule (sheet)" },
    { id: "6.2b", name: "6.2b Loosen a rule · Face ID" },
    { id: "6.3", name: "6.3 Card details and known shops" },
    { id: "7.1", name: "7.1 Push · 4 payments stopped" },
    { id: "7.2", name: "7.2 Was this you? (sheet)" },
    { id: "7.3", name: "7.3 Not me · card frozen" },
    { id: "7.3b", name: "7.3b Yes, it was me" },
    { id: "8.1", name: "8.1 Freeze card (sheet)" },
    { id: "8.2", name: "8.2 Turn off Agent Card (sheet)" },
] as const;

export type FrameId = (typeof frames)[number]["id"];

// ---------- state ----------

export interface Banner {
    kind: "ask" | "stopped" | "burst";
    title: string;
    body: string;
    target: Action;
    key: number;
}

export interface RuleValues {
    orderLimit: number;
    monthBudget: number;
}

export interface State {
    screen: ScreenId;
    history: ScreenId[];
    sheet: SheetId | null;
    /** 4.2: Ask me sheet expanded to show all checks. */
    questionExpanded: boolean;
    /** 5.2: which payment is open. */
    paymentId: string;
    activity: ActivityItem[];
    /** Final approvals in the rolling 30 days. */
    monthSpent: number;
    waiting: { decisionId: string; deadline: number } | null;
    banner: Banner | null;
    /** Face ID overlay running; dispatches `then` when finished. */
    faceId: { then: Action } | null;
    frozen: boolean;
    offline: boolean;
    cardCreated: boolean;
    /** The agent has started a task (its instruction arrived with the first purchase). */
    taskActive: boolean;
    rules: RuleValues;
    smart: SmartSettings;
    learned: { text: string; added: string }[];
    /** Edit rule sheet: which rule and the draft value. */
    editing: { key: Extract<RuleKey, "orderLimit" | "monthBudget">; draft: number } | null;
    /** Reason for the last answered ask (drives the learned-rule offer on 4.4). */
    lastAnswered: string | null;
}

const base: State = {
    screen: "1.1",
    history: [],
    sheet: null,
    questionExpanded: false,
    paymentId: "AU0039",
    activity: [],
    monthSpent: 0,
    waiting: null,
    banner: null,
    faceId: null,
    frozen: false,
    offline: false,
    cardCreated: false,
    taskActive: false,
    rules: { ...suggestedValues },
    smart: { ...defaultSmart },
    learned: [],
    editing: null,
    lastAnswered: null,
};

export const initialState = (): State => ({ ...base });

export const ASK_SECONDS = 120;

/** The state a frame shows when opened from "Jump to screen". */
const frameState = (frame: FrameId): State => {
    const now = Date.now();
    const canonical: State = {
        ...base,
        cardCreated: true,
        taskActive: true,
        rules: { orderLimit: 400, monthBudget: 1500 },
        activity: [rowFor(getDecision("AU0039")), rowFor(getDecision("AU0036")), rowFor(getDecision("AU0035"))],
        monthSpent: 289,
        waiting: { decisionId: "AU0040", deadline: now + 114_000 },
    };
    const on = (screen: ScreenId, extra: Partial<State> = {}): State => ({ ...canonical, screen, ...extra });

    switch (frame) {
        case "1.1":
        case "1.2":
        case "1.3":
        case "1.4":
            return { ...base, screen: frame };
        case "1.3a":
            return { ...base, screen: "1.3", sheet: "edit-rule", editing: { key: "orderLimit", draft: 400 } };
        case "1.5":
            return { ...base, screen: "1.5", cardCreated: true, rules: { orderLimit: 400, monthBudget: 1500 } };
        case "3.1b":
            return on("3.1", { activity: [], monthSpent: 0, waiting: null, taskActive: false });
        case "3.1c":
            return on("3.1", { offline: true });
        case "4.0":
            return on("4.0", { waiting: { decisionId: "AU0040", deadline: now + ASK_SECONDS * 1000 } });
        case "4.1":
            return on("3.1", { sheet: "question" });
        case "4.2":
            return on("3.1", { sheet: "question", questionExpanded: true });
        case "4.3":
            return on("3.1", { sheet: "approved", waiting: null, activity: [rowFor(getDecision("AU0040"), "approved"), ...canonical.activity], monthSpent: 588 });
        case "4.4":
            return on("3.1", { sheet: "declined", waiting: null, lastAnswered: "AU0040", activity: [rowFor(getDecision("AU0040"), "you-declined"), ...canonical.activity] });
        case "4.5":
            return on("3.1", { sheet: "timesup", waiting: null, activity: [rowFor(getDecision("AU0040"), "times-up"), ...canonical.activity] });
        case "5.1":
            return on("5.1", { waiting: null });
        case "5.2":
            return on("5.2", { paymentId: "AU0039" });
        case "5.2b":
            return on("5.2", { paymentId: "AU0037", activity: [rowFor(getDecision("AU0037")), ...canonical.activity] });
        case "5.2c":
            return on("5.2", { paymentId: "AU0035" });
        case "6.1":
            return on("6.1", { learned: [{ text: "Always decline when a shop gives orders", added: "Added today" }] });
        case "6.2":
            return on("6.1", { sheet: "edit-rule", editing: { key: "orderLimit", draft: 350 } });
        case "6.2b":
            return on("6.1", { sheet: "edit-rule", editing: { key: "orderLimit", draft: 450 } });
        case "7.1":
            return on("7.1", { waiting: null });
        case "7.2":
            return on("3.1", { sheet: "was-this-you", waiting: null, activity: [...burstIds.map((id) => rowFor(getDecision(id))), ...canonical.activity] });
        case "7.3":
            return on("7.3", { frozen: true, waiting: null });
        case "8.1":
            return on("3.1", { sheet: "freeze" });
        case "8.2":
            return on("6.1", { sheet: "turn-off" });
        default:
            return on(frame as ScreenId);
    }
};

/** Which frame the current state shows (drives the "Jump to screen" select). */
export const currentFrame = (s: State): FrameId => {
    switch (s.sheet) {
        case "edit-rule":
            if (!s.cardCreated) return "1.3a";
            return s.editing && s.editing.draft > s.rules[s.editing.key] ? "6.2b" : "6.2";
        case "question":
            return s.questionExpanded ? "4.2" : "4.1";
        case "approved":
            return "4.3";
        case "declined":
            return "4.4";
        case "timesup":
            return "4.5";
        case "was-this-you":
            return "7.2";
        case "freeze":
            return "8.1";
        case "turn-off":
            return "8.2";
    }
    if (s.screen === "3.1") {
        if (s.offline) return "3.1c";
        if (s.activity.length === 0 && !s.waiting) return "3.1b";
    }
    if (s.screen === "5.2") {
        if (s.paymentId === "AU0037") return "5.2b";
        const d = getDecision(s.paymentId);
        if (d.decision === "approve") return "5.2c";
    }
    return s.screen;
};

// ---------- actions ----------

export type Action =
    | { type: "GO"; screen: ScreenId; sheet?: SheetId | null; patch?: Partial<State> }
    | { type: "BACK"; fallback?: ScreenId }
    | { type: "SHEET"; sheet: SheetId | null; patch?: Partial<State> }
    | { type: "PATCH"; patch: Partial<State> }
    | { type: "JUMP"; frame: FrameId }
    | { type: "RESET" }
    | { type: "FACE_ID"; then: Action }
    | { type: "FACE_ID_DONE" }
    | { type: "DISMISS_BANNER" }
    | { type: "EDIT_RULE"; key: "orderLimit" | "monthBudget" }
    | { type: "SAVE_RULE" }
    | { type: "SET_SMART"; key: keyof SmartSettings; value: string }
    | { type: "CREATE_CARD" }
    | { type: "RESOLVE_ASK"; outcome: "approved" | "declined" }
    | { type: "ACCEPT_SUGGESTION"; text: string }
    | { type: "REMOVE_LEARNED"; text: string }
    | { type: "TIME_UP" }
    | { type: "TURN_OFF" }
    /** One decision arrives (from the mock demo controls or from the live backend). */
    | { type: "INGEST"; decision: Decision; quiet?: boolean }
    | { type: "DEMO"; demo: "approve" | "duplicate" | "lookalike" | "ask" | "burst" };

let bannerSeq = 0;

const go = (s: State, screen: ScreenId, sheet: SheetId | null = null, patch: Partial<State> = {}): State => ({
    ...s,
    history: screen === s.screen ? s.history : [...s.history, s.screen].slice(-30),
    screen,
    sheet,
    questionExpanded: false,
    ...patch,
});

const ingest = (s: State, d: Decision, quiet = false): State => {
    bannerSeq += 1;
    const next: State = { ...s, cardCreated: true, taskActive: true };
    const isPush = !quiet && d.reason_codes.some((r) => pushReasons.includes(r));

    if (d.decision === "approve") {
        return { ...next, activity: [rowFor(d), ...s.activity], monthSpent: s.monthSpent + d.amount.chf };
    }

    if (d.decision === "step_up") {
        const waiting = { decisionId: d.id, deadline: Date.now() + ASK_SECONDS * 1000 };
        return {
            ...next,
            waiting,
            sheet: s.sheet === "question" ? s.sheet : null,
            banner: quiet
                ? s.banner
                : {
                      kind: "ask",
                      key: bannerSeq,
                      title: `Your agent wants to pay CHF ${Math.round(d.amount.chf)} at ${d.merchant.name}`,
                      body: "Tap to answer. 2:00 left.",
                      target: { type: "GO", screen: "3.1", sheet: "question" },
                  },
        };
    }

    // decline
    const row = rowFor(d);
    const isBurst = !!d.group_id;
    const alreadyBurst = isBurst && s.activity.some((a) => a.groupId === d.group_id);
    let banner = s.banner;
    if (isBurst && !alreadyBurst && !quiet) {
        banner = {
            kind: "burst",
            key: bannerSeq,
            title: "We stopped 4 payments, 02:14 to 02:24",
            body: "A new phone tried to pay at shops you never used.",
            target: { type: "GO", screen: "3.1", sheet: "was-this-you" },
        };
    } else if (isPush && !isBurst) {
        banner = {
            kind: "stopped",
            key: bannerSeq,
            title: `We stopped a payment at ${d.merchant.name}`,
            body: `${d.headline}. Nothing was bought.`,
            target: { type: "GO", screen: "5.2", patch: { paymentId: d.id } },
        };
    }
    return { ...next, activity: [row, ...s.activity], banner };
};

export const reducer = (s: State, a: Action): State => {
    switch (a.type) {
        case "GO":
            return go(s, a.screen, a.sheet ?? null, a.patch);
        case "BACK": {
            const prev = s.history[s.history.length - 1] ?? a.fallback ?? "3.1";
            return { ...s, screen: prev, history: s.history.slice(0, -1), sheet: null };
        }
        case "SHEET":
            return { ...s, sheet: a.sheet, questionExpanded: false, ...a.patch };
        case "PATCH":
            return { ...s, ...a.patch };
        case "JUMP":
            return frameState(a.frame);
        case "RESET":
            return initialState();
        case "FACE_ID":
            return { ...s, faceId: { then: a.then } };
        case "FACE_ID_DONE":
            return s.faceId ? reducer({ ...s, faceId: null }, s.faceId.then) : s;
        case "DISMISS_BANNER":
            return { ...s, banner: null };
        case "EDIT_RULE":
            return { ...s, sheet: "edit-rule", editing: { key: a.key, draft: s.rules[a.key] } };
        case "SAVE_RULE":
            if (!s.editing) return s;
            return { ...s, rules: { ...s.rules, [s.editing.key]: s.editing.draft }, sheet: null, editing: null };
        case "SET_SMART":
            return { ...s, smart: { ...s.smart, [a.key]: a.value } };
        case "CREATE_CARD":
            return go({ ...s, cardCreated: true }, "1.5");
        case "RESOLVE_ASK": {
            if (!s.waiting) return s;
            const d = getDecision(s.waiting.decisionId);
            const row = rowFor(d, a.outcome === "approved" ? "approved" : "you-declined");
            return {
                ...s,
                waiting: null,
                activity: [row, ...s.activity],
                monthSpent: a.outcome === "approved" ? s.monthSpent + d.amount.chf : s.monthSpent,
                sheet: a.outcome,
                questionExpanded: false,
                lastAnswered: d.id,
            };
        }
        case "ACCEPT_SUGGESTION":
            if (s.learned.some((l) => l.text === a.text)) return { ...s, sheet: null };
            return { ...s, sheet: null, learned: [...s.learned, { text: a.text, added: "Added today" }] };
        case "REMOVE_LEARNED":
            return { ...s, learned: s.learned.filter((l) => l.text !== a.text) };
        case "TIME_UP": {
            if (!s.waiting) return s;
            const d = getDecision(s.waiting.decisionId);
            const onLock = s.screen === "4.0" || s.screen === "5.1" || s.screen === "7.1";
            return {
                ...s,
                waiting: null,
                banner: null,
                faceId: null,
                activity: [rowFor(d, "times-up"), ...s.activity],
                screen: onLock ? "3.1" : s.screen,
                sheet: "timesup",
                questionExpanded: false,
            };
        }
        case "TURN_OFF":
            return go({ ...s, cardCreated: false, taskActive: false, waiting: null, frozen: false, activity: [], monthSpent: 0, learned: [] }, "1.1");
        case "INGEST":
            return ingest(s, a.decision, a.quiet);
        case "DEMO": {
            switch (a.demo) {
                case "approve":
                    return ingest(s, getDecision("AU0035"));
                case "duplicate":
                    return ingest(s, getDecision("AU0036"));
                case "lookalike":
                    return ingest(s, getDecision("AU0039"));
                case "ask":
                    return ingest({ ...s, sheet: null }, getDecision("AU0040"));
                case "burst":
                    return burstIds.reduce((acc, id) => ingest(acc, getDecision(id)), s);
            }
        }
    }
    return s;
};

/** The learned rule we offer after the customer answered an ask (null when "Learn from my answers" is off). */
export const pendingSuggestion = (s: State): string | null => {
    if (s.smart.learn === "off" || !s.lastAnswered) return null;
    return suggestionFor(getDecision(s.lastAnswered));
};

// ---------- live side effects (mock: nothing happens; live: the backend is told what the customer did) ----------

const sideEffects = (a: Action, s: State) => {
    if (dataMode !== "live") return;
    const fail = (what: string) => (err: unknown) => console.error(`${what} failed`, err);
    switch (a.type) {
        case "RESOLVE_ASK":
            if (s.waiting) api.resolve(s.waiting.decisionId, { decision: a.outcome === "approved" ? "approve" : "decline" }).catch(fail("resolve"));
            break;
        case "CREATE_CARD":
            api.createLeash({ instruction: "", rules: s.rules, smart: s.smart }).catch(fail("create leash"));
            break;
        case "SAVE_RULE":
            if (s.editing) api.tighten({ rules: { [s.editing.key]: s.editing.draft }, face_id_confirmed: s.editing.draft > s.rules[s.editing.key] }).catch(fail("tighten"));
            break;
        case "SET_SMART":
            api.tighten({ smart: { [a.key]: a.value } }).catch(fail("tighten"));
            break;
        case "ACCEPT_SUGGESTION":
            if (s.lastAnswered) api.acceptSuggestion(s.lastAnswered).catch(fail("accept suggestion"));
            break;
        case "TURN_OFF":
            api.revoke().catch(fail("revoke"));
            break;
        case "SHEET":
            if (a.patch?.frozen) api.pause().catch(fail("pause"));
            break;
    }
};

// ---------- context ----------

interface PrototypeContextValue {
    state: State;
    dispatch: Dispatch<Action>;
    /** Seconds left on the ask-me question (live), or 0. */
    secondsLeft: number;
}

const PrototypeContext = createContext<PrototypeContextValue | null>(null);

export const PrototypeProvider = ({ children }: { children: ReactNode }) => {
    const [state, rawDispatch] = useReducer(reducer, undefined, initialState);
    const [now, setNow] = useState(() => Date.now());
    const stateRef = useRef(state);
    stateRef.current = state;

    // Same dispatch for mock and live; live additionally tells the backend (resolve, tighten, revoke ...).
    const dispatch = useCallback((a: Action) => {
        sideEffects(a, stateRef.current);
        rawDispatch(a);
    }, []);

    // Deep link for developers: /prototype?screen=4.1 opens that frame.
    useEffect(() => {
        const screen = new URLSearchParams(window.location.search).get("screen");
        if (screen && frames.some((f) => f.id === screen)) dispatch({ type: "JUMP", frame: screen as FrameId });
    }, []);

    // Real countdown: tick while a question is waiting.
    useEffect(() => {
        if (!state.waiting) return;
        setNow(Date.now());
        const id = window.setInterval(() => setNow(Date.now()), 250);
        return () => window.clearInterval(id);
    }, [state.waiting]);

    const secondsLeft = state.waiting ? Math.max(0, (state.waiting.deadline - now) / 1000) : 0;

    useEffect(() => {
        if (state.waiting && now >= state.waiting.deadline) dispatch({ type: "TIME_UP" });
    }, [now, state.waiting]);

    const value = useMemo(() => ({ state, dispatch, secondsLeft }), [state, secondsLeft]);
    return <PrototypeContext.Provider value={value}>{children}</PrototypeContext.Provider>;
};

export const usePrototype = () => {
    const ctx = useContext(PrototypeContext);
    if (!ctx) throw new Error("usePrototype must be used inside <PrototypeProvider>");
    return ctx;
};
