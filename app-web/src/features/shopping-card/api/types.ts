// Request / response shapes of OUR backend (06_product/07-api-contract.md), as the app consumes them.
// The app never talks to the Viseca API. `Decision` is the shared decision object (src/types/decision.ts).
import type { Decision } from "@/types/decision";

/** GET /app/leash/suggest — rules proposed from the card history, with evidence. */
export interface SuggestResponse {
    window_days: number;
    analysis: {
        purchases: number;
        typical_chf: number;
        biggest_chf: number;
        per_month_chf: number;
        biggest_month_chf: number;
        night_purchases: number;
        shops_used: number;
        categories: string[];
        category_share: number;
    };
    rules: {
        key: "orderLimit" | "monthBudget" | "knownShops" | "categories";
        suggested_value: number | string[] | null;
        evidence: string;
        hard_rule: HardRule | null;
    }[];
    smart: {
        unsure: "ask" | "decline";
        night: "decline" | "ask";
        newShops: "ask" | "known";
        learn: "on" | "off";
        evidence: Record<string, string>;
    };
    instruction_generated: string;
    /** Only for a card without purchases: what we inferred from the profile and from customers like this one. */
    cold_start?: ColdStart;
}

/** Cold start: the customer's own profile read into signals (by Apertus or keywords) plus their nearest neighbours. */
export interface ColdStart {
    customer_id: string;
    signals: {
        categories: string[];
        night_owl: boolean;
        travel_countries: string[];
        prefers_refundable: boolean;
        prefers_known_shops: boolean;
        budget_hint: string | null;
        source: "apertus" | "keywords";
    };
    predicted_categories: { category: string; confidence: number; from: string[] }[];
    neighbours: { customer_id: string; score: number; why: string[] }[];
    prior: {
        ticket_p50: number;
        ticket_p90: number;
        month_p50: number;
        categories: { category: string; share: number }[];
        hours: number[];
        countries: string[];
        shops: { merchant_id: string; name: string; neighbours: number }[];
    } | null;
}

/** POST /app/leash/understand — a leash in any language, read by our compiler after Apertus translated it. */
export interface UnderstandResponse {
    language: string;
    original: string;
    english: string;
    translated: boolean;
    please_check: string[];
    rules: { key: string; label: string; label_local: string; your_words: string | null }[];
    not_understood: string[];
    model: { used: boolean; cached: boolean; fallback: boolean; latency_ms: number; name: string | null; error?: string };
}

/** GET /app/memory — what the card learned from the customer's answers. */
export interface MemoryView {
    key: string;
    learning?: boolean;
    shops: { merchant_id: string; name: string; times: number; last_at: string; source: string }[];
    devices: { device_id: string; times: number; last_at: string; trusted: boolean }[];
    countries: { country: string; times: number }[];
    hours: { hour: number; times: number }[];
    blocked_shops: { merchant_id: string; name: string; at: string }[];
}

/** GET /api/status — backend mode and the run in progress. */
export interface BackendStatus {
    mode?: string;
    [k: string]: unknown;
}

/** Viseca `hard_rules` entry (technical_details.md §Rule format). */
export interface HardRule {
    field: string;
    operator: "<" | "<=" | "=" | "!=" | ">" | ">=" | "in" | "not_in";
    value: number | string | string[];
    currency?: "CHF" | "EUR" | "GBP" | "USD";
    scope?: "purchase" | "period";
    period_days?: number;
}

/** POST /app/leash — create the Agent Card mandate (draft + confirm happen in the backend). */
export interface CreateLeashRequest {
    instruction: string;
    rules: { orderLimit: number; monthBudget: number };
    smart: SuggestResponse["smart"] extends infer S ? Omit<S, "evidence"> : never;
    /** Optional task instruction if the agent already sent one. */
    task_instruction?: string;
    /** The customer's own words when the task was written in another language (the task is its translation). */
    original_instruction?: { language: string; text: string };
    /** ISO instant the Agent Card stops working; null or omitted = no end. */
    valid_until?: string | null;
}

export interface Leash {
    mandate_id: string;
    status: "active" | "paused" | "off";
    card_last4: string;
    instruction: string;
    rules: { orderLimit: number; monthBudget: number };
    smart: Omit<SuggestResponse["smart"], "evidence">;
    learned: { id: string; text: string; added_at: string }[];
    task: { instruction: string; rules: { key: string; label: string; your_words: string }[]; original?: { language: string; text: string } } | null;
    month_spent_chf: number;
    frees_up_at: string | null;
    /** The card stops working here (purchases after it are declined `leash_ended`); null = no end. */
    valid_until?: string | null;
    /** Shops the customer knows: card history plus what they confirmed. `new` = learned from an answer. */
    known_shops?: { merchant_id: string; name: string; times_used: number; new: boolean }[];
}

/** PATCH /app/leash/rules — only stricter values are accepted without `face_id_confirmed`. */
export interface TightenRequest {
    rules?: Partial<{ orderLimit: number; monthBudget: number }>;
    smart?: Partial<Omit<SuggestResponse["smart"], "evidence">>;
    block_shop?: string;
    /** An earlier end is stricter; a later end or null (no end) needs `face_id_confirmed`. */
    valid_until?: string | null;
    face_id_confirmed?: boolean;
}

/** GET /app/feed */
export interface FeedResponse {
    decisions: Decision[];
    asks: Decision[];
}

/** POST /app/asks/:id/resolve */
export interface ResolveRequest {
    decision: "approve" | "decline";
    /** Optional customer reason chips ("Too expensive"). */
    reason?: string;
    /** Required for approve (the backend answers 403 `face_id_required` without it). Never needed for decline. */
    face_id_confirmed?: boolean;
}

/** GET /app/stream (Server-Sent Events). `event:` name = `type`, `data:` = JSON of the rest. */
export type StreamEvent =
    | { type: "decision"; decision: Decision }
    | { type: "ask"; decision: Decision; deadline_at: string }
    | { type: "ask_expired"; id: string }
    | { type: "leash_changed"; leash: Leash };
