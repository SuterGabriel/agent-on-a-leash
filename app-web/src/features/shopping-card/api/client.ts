// One adapter for mock and live. Set VITE_API_BASE (e.g. http://localhost:8080) to go live; unset = mock.
// The mock returns the same shapes from src/mocks/decisions.json and demo-data.ts so the screens don't know the difference.
import type { CreateLeashRequest, FeedResponse, Leash, ResolveRequest, StreamEvent, SuggestResponse, TightenRequest } from "@/features/shopping-card/api/types";
import {
    analysis,
    customer,
    defaultSmart,
    instructionFromRules,
    proposedRules,
    scenarioDecisions,
    smartSettings,
    suggestedValues,
    task,
} from "@/features/shopping-card/demo-data";
import type { Decision } from "@/types/decision";

export const apiBase: string | undefined = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "");
export const dataMode: "mock" | "live" = apiBase ? "live" : "mock";

// The backend refuses writes under /app/* without this bearer when APP_SECRET is set (always in live mode).
// Hackathon-grade: one shared secret in the app bundle, not user authentication.
const appSecret = (import.meta.env.VITE_APP_SECRET as string | undefined)?.trim();
export const authHeaders = (): Record<string, string> => (appSecret ? { Authorization: `Bearer ${appSecret}` } : {});

const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${apiBase}${path}`, { ...init, headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- mock ----------

const mockSuggest = (): SuggestResponse => ({
    window_days: analysis.windowDays,
    analysis: {
        purchases: analysis.purchases,
        typical_chf: analysis.typical,
        biggest_chf: analysis.biggest,
        per_month_chf: analysis.perMonth,
        biggest_month_chf: analysis.biggestMonth,
        night_purchases: analysis.nightPurchases,
        shops_used: analysis.shopsUsed,
        categories: analysis.categories,
        category_share: analysis.categoryShare,
    },
    rules: proposedRules.map((r) => ({
        key: r.key,
        suggested_value:
            r.key === "orderLimit"
                ? suggestedValues.orderLimit
                : r.key === "monthBudget"
                  ? suggestedValues.monthBudget
                  : r.key === "categories"
                    ? analysis.categories
                    : null,
        evidence: r.evidence,
        hard_rule:
            r.key === "orderLimit"
                ? { field: "authorization.billing_amount_chf", operator: "<=", value: suggestedValues.orderLimit, currency: "CHF", scope: "purchase" }
                : r.key === "monthBudget"
                  ? {
                        field: "authorization.billing_amount_chf",
                        operator: "<=",
                        value: suggestedValues.monthBudget,
                        currency: "CHF",
                        scope: "period",
                        period_days: 30,
                    }
                  : null,
    })),
    smart: { ...defaultSmart, evidence: Object.fromEntries(smartSettings.map((s) => [s.key, s.evidence])) },
    instruction_generated: instructionFromRules(suggestedValues, defaultSmart),
});

const mockLeash = (): Leash => ({
    mandate_id: "mock-mandate",
    status: "active",
    card_last4: customer.cardLast4,
    instruction: instructionFromRules(suggestedValues, defaultSmart),
    rules: { ...suggestedValues },
    smart: { ...defaultSmart },
    learned: [],
    task: { instruction: task.instruction, rules: task.rules.map((r) => ({ key: r.key, label: r.label, your_words: r.yourWords })) },
    month_spent_chf: 0,
    frees_up_at: null,
});

// ---------- public API (same signatures for mock and live) ----------

export const api = {
    suggest: (): Promise<SuggestResponse> => (apiBase ? json("/app/leash/suggest") : wait(300).then(mockSuggest)),
    getLeash: (): Promise<Leash> => (apiBase ? json("/app/leash") : wait(100).then(mockLeash)),
    createLeash: (body: CreateLeashRequest): Promise<Leash> =>
        apiBase
            ? json("/app/leash", { method: "POST", body: JSON.stringify(body) })
            : wait(400).then(() => ({ ...mockLeash(), instruction: body.instruction, rules: body.rules })),
    tighten: (body: TightenRequest): Promise<Leash> =>
        apiBase ? json("/app/leash/rules", { method: "PATCH", body: JSON.stringify(body) }) : wait(150).then(mockLeash),
    pause: (): Promise<void> => (apiBase ? json("/app/leash/pause", { method: "POST" }) : wait(100).then(() => undefined)),
    revoke: (): Promise<void> => (apiBase ? json("/app/leash", { method: "DELETE" }) : wait(200).then(() => undefined)),
    feed: (): Promise<FeedResponse> => (apiBase ? json("/app/feed") : wait(100).then(() => ({ decisions: [], asks: [] }))),
    decision: (id: string): Promise<Decision> =>
        apiBase ? json(`/app/decisions/${id}`) : wait(50).then(() => scenarioDecisions("SCEN0004").find((d) => d.id === id) as Decision),
    resolve: (id: string, body: ResolveRequest): Promise<void> =>
        apiBase ? json(`/app/asks/${id}/resolve`, { method: "POST", body: JSON.stringify(body) }) : wait(100).then(() => undefined),
    acceptSuggestion: (id: string): Promise<void> => (apiBase ? json(`/app/suggestions/${id}/accept`, { method: "POST" }) : wait(100).then(() => undefined)),

    /** Live demo control: the scenarios the backend can replay, and starting one (the task lands on top of the card rules). */
    scenarios: (): Promise<{ scenario_id: string; scenario_name: string; cardholder_instruction: string; event_count: number }[]> =>
        apiBase ? json("/api/scenarios") : Promise.resolve([]),
    startRun: (scenarioId: string): Promise<{ run_id: string; scenario_id: string; state: string }> =>
        apiBase ? json("/api/runs", { method: "POST", body: JSON.stringify({ scenario_id: scenarioId }) }) : Promise.reject(new Error("mock mode")),

    /** Live: subscribe to /app/stream. Mock: no-op (the demo controls dispatch INGEST directly). Returns an unsubscribe. */
    stream: (onEvent: (e: StreamEvent) => void, onError?: (e: Event) => void): (() => void) => {
        if (!apiBase) return () => {};
        const es = new EventSource(`${apiBase}/app/stream`);
        const handle = (type: StreamEvent["type"]) => (ev: MessageEvent) => {
            try {
                onEvent({ type, ...JSON.parse(ev.data) } as StreamEvent);
            } catch (err) {
                console.error("Bad stream payload", type, err);
            }
        };
        (["decision", "ask", "ask_expired", "leash_changed"] as const).forEach((t) => es.addEventListener(t, handle(t) as EventListener));
        if (onError) es.onerror = onError;
        return () => es.close();
    },
};
