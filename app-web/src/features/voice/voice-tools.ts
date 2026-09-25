// What the voice agent can do, as client tools that run here in the app.
// The agent (packages/backend/src/voice/agentDefinition.ts) never decides: every tool reads prototype state or
// dispatches the same action a tap would. Tool names must match VOICE_TOOLS in that file.
import type { Dispatch } from "react";
import { apiBase, authHeaders } from "@/features/shopping-card/api/client";
import { getDecision, shopQuote } from "@/features/shopping-card/demo-data";
import type { Action, State } from "@/features/shopping-card/prototype-state";
import type { Decision } from "@/types/decision";

export const VOICE_TOOLS = {
    getPendingAsk: "get_pending_ask",
    resolveAsk: "resolve_ask",
    readShopText: "read_shop_text",
    parseInstruction: "parse_instruction",
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
        return `Hi. No question is waiting. Your Agent Card is active with ${spokenChf(state.rules.orderLimit)} per order and ${spokenChf(state.rules.monthBudget)} per 30 days. What would you like to do?`;
    }
    return "Hi. Your Agent Card is not set up yet. Tell me your rules in your own words, for example how much per order and per month, and I will read back what I understood.";
};

// ---------- parse spoken rules ----------

export interface ParsedRules {
    orderLimit: number | null;
    monthBudget: number | null;
    understood: string[];
    notUnderstood: string[];
    openQuestions: string[];
}

interface ParseResponse {
    rules: { key: string; label: string; hard_rule: { field: string; operator: string; value: number | string | string[]; scope?: string } | null }[];
    open_questions: { id: string; text: string; options: string[] }[];
    not_understood: string[];
}

const amount = (s: string | undefined) => (s ? Number(s.replace(/['’]/g, "")) : null);

/** Offline reading of the two limits the card has. Enough for the demo when the backend is not connected. */
export const parseLocally = (instruction: string): ParsedRules => {
    const order = /(\d[\d'’]*)\s*(?:chf|francs?|franken)?\s*(?:per|each|a|for every|pro)\s*(?:order|purchase|bestellung|einkauf)/i.exec(instruction);
    const month = /(\d[\d'’]*)\s*(?:chf|francs?|franken)?\s*(?:per|a|pro|in|every)\s*(?:month|monat|30 days|30 tage)/i.exec(instruction);
    const orderLimit = amount(order?.[1]);
    const monthBudget = amount(month?.[1]);
    const understood = [
        orderLimit ? `Each order ${spokenChf(orderLimit)} or less` : "",
        monthBudget ? `In any 30 days ${spokenChf(monthBudget)} or less` : "",
    ].filter(Boolean);
    return { orderLimit, monthBudget, understood, notUnderstood: understood.length ? [] : [instruction], openQuestions: [] };
};

/** The backend compiler (POST /app/leash/parse) when connected, the local reading otherwise. */
export const parseInstruction = async (instruction: string): Promise<ParsedRules> => {
    if (!apiBase) return parseLocally(instruction);
    const root = apiBase.replace(/\/v4$/, "");
    const res = await fetch(`${root}/app/leash/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ instruction }),
    });
    if (!res.ok) return parseLocally(instruction);
    const parsed = (await res.json()) as ParseResponse;
    const limit = (scope: string) => {
        const r = parsed.rules.find((x) => x.hard_rule?.field === "authorization.billing_amount_chf" && x.hard_rule.scope === scope);
        return typeof r?.hard_rule?.value === "number" ? r.hard_rule.value : null;
    };
    return {
        orderLimit: limit("purchase"),
        monthBudget: limit("period"),
        understood: parsed.rules.map((r) => r.label),
        notUnderstood: parsed.not_understood,
        openQuestions: parsed.open_questions.map((q) => `${q.text} (${q.options.join(" or ")})`),
    };
};

const spokenParse = (p: ParsedRules) =>
    [
        p.understood.length ? `Understood: ${p.understood.join("; ")}.` : "I could not read any rule from that.",
        p.notUnderstood.length ? `Not understood: ${p.notUnderstood.join("; ")}.` : "",
        p.openQuestions.length ? `Open questions: ${p.openQuestions.join(" ")}` : "",
        p.orderLimit || p.monthBudget ? `Numbers for create_card: order_limit_chf=${p.orderLimit ?? "none"}, month_budget_chf=${p.monthBudget ?? "none"}.` : "",
    ]
        .filter(Boolean)
        .join(" ");

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

    [VOICE_TOOLS.parseInstruction]: async ({ instruction }) => {
        if (typeof instruction !== "string" || !instruction.trim()) return "I need the rules in your words first.";
        return spokenParse(await parseInstruction(instruction));
    },

    [VOICE_TOOLS.createCard]: ({ order_limit_chf, month_budget_chf }) => {
        const { state, dispatch } = get();
        if (state.cardCreated) return "The Agent Card already exists. Rules can be tightened in the app.";
        const orderLimit = typeof order_limit_chf === "number" && order_limit_chf > 0 ? Math.round(order_limit_chf) : state.rules.orderLimit;
        const monthBudget = typeof month_budget_chf === "number" && month_budget_chf > 0 ? Math.round(month_budget_chf) : state.rules.monthBudget;
        dispatch({ type: "PATCH", patch: { rules: { orderLimit, monthBudget } } });
        dispatch({ type: "FACE_ID", then: { type: "CREATE_CARD" } });
        return `Your Agent Card is being created with ${spokenChf(orderLimit)} per order and ${spokenChf(monthBudget)} per 30 days. Face ID confirms it on screen.`;
    },

    [VOICE_TOOLS.endCall]: () => {
        get().endCall();
        return "Bye.";
    },
});
