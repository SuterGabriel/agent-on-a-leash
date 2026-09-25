// What the voice agent can do, as client tools that run here in the app.
// The agent (packages/backend/src/voice/agentDefinition.ts) never decides: every tool reads prototype state or
// dispatches the same action a tap would, so the phone screen always shows what the voice says.
// Tool names must match VOICE_TOOLS in that file.
import type { Dispatch } from "react";
import { api } from "@/features/shopping-card/api/client";
import type { SuggestResponse } from "@/features/shopping-card/api/types";
import { getDecision, proposedRules, shopQuote } from "@/features/shopping-card/demo-data";
import type { Action, State } from "@/features/shopping-card/prototype-state";
import type { Decision } from "@/types/decision";

export const VOICE_TOOLS = {
    getPendingAsk: "get_pending_ask",
    resolveAsk: "resolve_ask",
    readShopText: "read_shop_text",
    analyseHistory: "analyse_history",
    setRules: "set_rules",
    createCard: "create_card",
    endCall: "end_call",
} as const;

export type VoiceToolName = (typeof VOICE_TOOLS)[keyof typeof VOICE_TOOLS];

/** The snapshot the tools work on. Read through a getter so a handler always sees the latest state. */
export interface VoiceContext {
    state: State;
    dispatch: Dispatch<Action>;
    secondsLeft: number;
    endCall: () => void;
}

export type VoiceToolHandlers = Record<VoiceToolName, (params: Record<string, unknown>) => string | Promise<string>>;

// ---------- spoken text ----------

/** "189 francs", "44.50 francs": TTS reads this better than "CHF 44.50". */
export const spokenChf = (chf: number) => (Number.isInteger(chf) ? `${chf} francs` : `${chf.toFixed(2)} francs`);

const spokenTime = (seconds: number) => {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m === 0) return `${r} seconds`;
    return r === 0 ? `${m} minute${m > 1 ? "s" : ""}` : `${m} minute${m > 1 ? "s" : ""} ${r}`;
};

const waitingDecision = (state: State): Decision | null => (state.waiting ? getDecision(state.waiting.decisionId) : null);

/** One sentence with everything the agent may say about the open question. */
export const askSummary = (d: Decision, secondsLeft: number): string => {
    const item = d.items[0]?.name;
    const quote = shopQuote(d);
    return [
        `Your agent wants to pay ${spokenChf(d.amount.chf)} at ${d.merchant.name}${item ? ` for ${item}` : ""}.`,
        `Why the card asks: ${d.because}`,
        quote ? `The shop page also said: "${quote}" The card ignored that.` : "",
        `${spokenTime(secondsLeft)} left to answer.`,
    ]
        .filter(Boolean)
        .join(" ");
};

/** The first thing the agent says. Composed here, not by the model, so what is read aloud comes from the engine. */
export const openingFor = (state: State, secondsLeft: number): string => {
    const d = waitingDecision(state);
    if (d) return `${askSummary(d, secondsLeft)} Approve or decline?`;
    if (state.cardCreated) {
        return `Hi. Your Agent Card is active: ${spokenChf(state.rules.orderLimit)} per payment and ${spokenChf(state.rules.monthBudget)} in any 30 days. Do you want to change a limit?`;
    }
    return "Hi. I can help you set up your Agent Card, the card your AI agent shops with. Shall I look at your recent shopping on this card and propose rules from it?";
};

// ---------- rules ----------

const bounds = (key: "orderLimit" | "monthBudget") => {
    const r = proposedRules.find((p) => p.key === key);
    return { min: r?.min ?? 0, max: r?.max ?? 10_000 };
};

/** A spoken number becomes a limit: whole francs inside the stepper's range. */
const asLimit = (value: unknown, key: "orderLimit" | "monthBudget"): number | null => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    const { min, max } = bounds(key);
    return Math.max(min, Math.min(max, Math.round(value)));
};

const suggestedLimit = (s: SuggestResponse, key: "orderLimit" | "monthBudget", fallback: number) => {
    const v = s.rules.find((r) => r.key === key)?.suggested_value;
    return typeof v === "number" ? v : fallback;
};

/** What the agent says after the analysis. Same numbers as screen 1.3. */
const spokenAnalysis = (s: SuggestResponse, orderLimit: number, monthBudget: number) => {
    const a = s.analysis;
    return [
        `In the last ${s.window_days} days you made ${a.purchases} purchases on this card, typically ${spokenChf(a.typical_chf)}, the biggest ${spokenChf(a.biggest_chf)}, about ${spokenChf(a.per_month_chf)} a month.`,
        `I propose ${spokenChf(orderLimit)} per payment and ${spokenChf(monthBudget)} in any 30 days.`,
        `Only the ${a.shops_used} shops you already use; a new shop asks you first.`,
        "The proposal is on your screen. Say yes to use it, or tell me a different number.",
    ].join(" ");
};

// ---------- handlers ----------

/** Builds the handlers once; `get()` returns the live context on every call. */
export const buildVoiceTools = (get: () => VoiceContext): VoiceToolHandlers => ({
    [VOICE_TOOLS.getPendingAsk]: () => {
        const { state, secondsLeft } = get();
        const d = waitingDecision(state);
        return d ? askSummary(d, secondsLeft) : "none";
    },

    [VOICE_TOOLS.resolveAsk]: ({ decision }) => {
        const { state, dispatch } = get();
        const d = waitingDecision(state);
        if (!d) return "No question is waiting. Nothing was changed.";
        if (decision !== "approve" && decision !== "decline") return "Say approve or decline.";
        // A spoken "yes" is not enough to approve: the phone still asks for Face ID, same as the Approve button.
        if (decision === "approve") {
            dispatch({ type: "FACE_ID", then: { type: "RESOLVE_ASK", outcome: "approved" } });
            return `Approving ${spokenChf(d.amount.chf)} at ${d.merchant.name}. Confirm with Face ID on your phone and your agent will be told to go ahead.`;
        }
        dispatch({ type: "RESOLVE_ASK", outcome: "declined" });
        return `Declined. Nothing was bought. Your agent was told why.`;
    },

    [VOICE_TOOLS.readShopText]: () => {
        const d = waitingDecision(get().state);
        const quote = d ? shopQuote(d) : null;
        return quote ? `The shop page said: "${quote}"` : "none";
    },

    // Setup step 1: the same analysis screen 1.3 shows, from the backend (live) or the demo data (mock).
    [VOICE_TOOLS.analyseHistory]: async () => {
        const { state, dispatch } = get();
        if (state.cardCreated) {
            return `The Agent Card already exists with ${spokenChf(state.rules.orderLimit)} per payment and ${spokenChf(state.rules.monthBudget)} in any 30 days. Use set_rules to change a limit.`;
        }
        let s: SuggestResponse;
        try {
            s = await api.suggest();
        } catch {
            return "I could not read the shopping history right now. You can still tell me a limit per payment and per month.";
        }
        const orderLimit = suggestedLimit(s, "orderLimit", state.rules.orderLimit);
        const monthBudget = suggestedLimit(s, "monthBudget", state.rules.monthBudget);
        const { unsure, night, newShops, learn } = s.smart;
        dispatch({ type: "GO", screen: "1.3", patch: { rules: { orderLimit, monthBudget }, smart: { unsure, night, newShops, learn } } });
        return spokenAnalysis(s, orderLimit, monthBudget);
    },

    // Setup step 2, or later: a limit the cardholder said. Before the card exists it just updates the proposal on screen.
    // After, it is the same as the stepper: stricter applies at once, looser needs Face ID, one limit per call.
    [VOICE_TOOLS.setRules]: ({ order_limit_chf, month_budget_chf }) => {
        const { state, dispatch } = get();
        const orderLimit = asLimit(order_limit_chf, "orderLimit");
        const monthBudget = asLimit(month_budget_chf, "monthBudget");
        if (orderLimit === null && monthBudget === null) return "I need a number: francs per payment, or francs per 30 days.";

        if (!state.cardCreated) {
            const rules = { orderLimit: orderLimit ?? state.rules.orderLimit, monthBudget: monthBudget ?? state.rules.monthBudget };
            dispatch({ type: "GO", screen: "1.3", patch: { rules } });
            return `Set: ${spokenChf(rules.orderLimit)} per payment, ${spokenChf(rules.monthBudget)} in any 30 days. The screen shows it. Say yes to create the card with these.`;
        }

        const key = orderLimit !== null ? "orderLimit" : "monthBudget";
        const draft = (orderLimit ?? monthBudget) as number;
        const looser = draft > state.rules[key];
        dispatch({ type: "PATCH", patch: { editing: { key, draft } } });
        dispatch(looser ? { type: "FACE_ID", then: { type: "SAVE_RULE" } } : { type: "SAVE_RULE" });
        const what = key === "orderLimit" ? "per payment" : "in any 30 days";
        const rest = orderLimit !== null && monthBudget !== null ? " Tell me the other limit again after this one." : "";
        return looser
            ? `${spokenChf(draft)} ${what} is looser than before, so Face ID confirms it on your phone.${rest}`
            : `Done: ${spokenChf(draft)} ${what}, from the next payment.${rest}`;
    },

    // Setup step 3: only after a spoken yes. Face ID on the phone does the actual creation, as the button does.
    [VOICE_TOOLS.createCard]: () => {
        const { state, dispatch } = get();
        if (state.cardCreated) return "The Agent Card already exists.";
        dispatch({ type: "FACE_ID", then: { type: "CREATE_CARD" } });
        return `Creating your Agent Card with ${spokenChf(state.rules.orderLimit)} per payment and ${spokenChf(state.rules.monthBudget)} in any 30 days. Confirm with Face ID on your phone.`;
    },

    [VOICE_TOOLS.endCall]: () => {
        get().endCall();
        return "Bye.";
    },
});
