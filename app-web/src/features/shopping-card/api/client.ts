// One adapter for mock and live. Set VITE_API_BASE (e.g. http://localhost:8080) to go live; unset = mock.
// The mock returns the same shapes from src/mocks/decisions.json and demo-data.ts so the screens don't know the difference.
import type {
    ColdStart,
    CreateLeashRequest,
    FeedResponse,
    Leash,
    MemoryView,
    ResolveRequest,
    StreamEvent,
    SuggestResponse,
    TightenRequest,
    UnderstandResponse,
} from "@/features/shopping-card/api/types";
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

// The backend refuses writes under /app/* without the bearer when APP_SECRET is set (always in live mode).
// Local dev: leave VITE_APP_SECRET empty, the Vite proxy adds it server-side (vite.config.ts), so it never reaches the
// browser. A static deploy without a proxy (Vercel) needs VITE_APP_SECRET: hackathon-grade, one shared secret in the bundle.
const appSecret = (import.meta.env.VITE_APP_SECRET as string | undefined)?.trim();
export const authHeaders = (): Record<string, string> => (appSecret ? { Authorization: `Bearer ${appSecret}` } : {});

const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${apiBase}${path}`, { ...init, headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) } });
    if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
        throw Object.assign(new Error(body?.error?.message ?? `${init?.method ?? "GET"} ${path} → ${res.status}`), {
            status: res.status,
            code: body?.error?.code,
        });
    }
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
    /** customerId: look at a customer without history (cold start). */
    suggest: (customerId?: string): Promise<SuggestResponse> =>
        apiBase ? json(`/app/leash/suggest${customerId ? `?customer_id=${encodeURIComponent(customerId)}` : ""}`) : wait(300).then(mockSuggest),
    /** Live only: customers without purchases the demo can look at. */
    coldCustomers: (): Promise<{ customer_id: string; name: string }[]> => (apiBase ? json("/app/profile/customers") : Promise.resolve([])),
    profileInsight: (customerId?: string): Promise<({ cold_start: true } & ColdStart) | { cold_start: false; customer_id: string; reason: string }> =>
        apiBase ? json(`/app/profile/insight${customerId ? `?customer_id=${encodeURIComponent(customerId)}` : ""}`) : Promise.reject(new Error("mock mode")),
    /** A leash in any language: Apertus translates, our compiler reads. Live only. */
    understand: (instruction: string): Promise<UnderstandResponse> =>
        apiBase ? json("/app/leash/understand", { method: "POST", body: JSON.stringify({ instruction }) }) : Promise.reject(new Error("mock mode")),
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
    /** Unfreeze: a loosening, needs Face ID. */
    resume: (): Promise<Leash> =>
        apiBase ? json("/app/leash/resume", { method: "POST", body: JSON.stringify({ face_id_confirmed: true }) }) : wait(100).then(mockLeash),
    unblockShop: (merchantId: string): Promise<Leash> =>
        apiBase
            ? json("/app/leash/unblock-shop", { method: "POST", body: JSON.stringify({ merchant_id: merchantId, face_id_confirmed: true }) })
            : wait(100).then(mockLeash),
    /** "Was this you?" yes trusts the device (Face ID); no pauses the card and never trusts the device again. */
    wasMe: (id: string, answer: "yes" | "no"): Promise<{ learned: string[]; paused: boolean; leash: Leash } | undefined> =>
        apiBase
            ? json(`/app/decisions/${id}/was-me`, { method: "POST", body: JSON.stringify({ answer, face_id_confirmed: answer === "yes" }) })
            : wait(100).then(() => undefined),
    memory: (): Promise<MemoryView | null> => (apiBase ? json("/app/memory") : Promise.resolve(null)),
    forgetShop: (merchantId: string): Promise<MemoryView | null> =>
        apiBase ? json(`/app/memory/shops/${encodeURIComponent(merchantId)}`, { method: "DELETE" }) : Promise.resolve(null),
    forgetDevice: (deviceId: string): Promise<MemoryView | null> =>
        apiBase ? json(`/app/memory/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" }) : Promise.resolve(null),

    /** Live demo control: the scenarios the backend can replay, and starting one (the task lands on top of the card rules). */
    scenarios: (): Promise<{ scenario_id: string; scenario_name: string; cardholder_instruction: string; event_count: number }[]> =>
        apiBase ? json("/api/scenarios") : Promise.resolve([]),
    startRun: (scenarioId: string): Promise<{ run_id: string; scenario_id: string; state: string }> =>
        apiBase ? json("/api/runs", { method: "POST", body: JSON.stringify({ scenario_id: scenarioId }) }) : Promise.reject(new Error("mock mode")),
    /** Live: the latest run and whether it is still running, so the next scene starts only after the last one ended. */
    status: (): Promise<{ latest_run: { run_id: string; scenario_id: string; state: "running" | "finished" | "failed" } | null }> =>
        apiBase ? json("/api/status") : Promise.resolve({ latest_run: null }),

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
