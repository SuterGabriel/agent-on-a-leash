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
}

export interface Leash {
    mandate_id: string;
    status: "active" | "paused" | "off";
    card_last4: string;
    instruction: string;
    rules: { orderLimit: number; monthBudget: number };
    smart: Omit<SuggestResponse["smart"], "evidence">;
    learned: { id: string; text: string; added_at: string }[];
    task: { instruction: string; rules: { key: string; label: string; your_words: string }[] } | null;
    month_spent_chf: number;
    frees_up_at: string | null;
}

/** PATCH /app/leash/rules — only stricter values are accepted without `face_id_confirmed`. */
export interface TightenRequest {
    rules?: Partial<{ orderLimit: number; monthBudget: number }>;
    smart?: Partial<Omit<SuggestResponse["smart"], "evidence">>;
    block_shop?: string;
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
}

/** GET /app/stream (Server-Sent Events). `event:` name = `type`, `data:` = JSON of the rest. */
export type StreamEvent =
    | { type: "decision"; decision: Decision }
    | { type: "ask"; decision: Decision; deadline_at: string }
    | { type: "ask_expired"; id: string }
    | { type: "leash_changed"; leash: Leash };
