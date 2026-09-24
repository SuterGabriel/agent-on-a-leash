// Shared decision shape for the app. Contract: 06_product/07-api-contract.md
// Mock data in this shape: src/mocks/decisions.json (our PROPOSED answers, not engine output)

export type DecisionKind = "approve" | "decline" | "step_up";

export type DecisionStatus =
    | "approved"
    | "declined"
    | "waiting_for_you"
    | "approved_by_you"
    | "declined_by_you"
    | "expired";

export type CheckResult = "pass" | "fail" | "unsure";

export type RuleSource = "you" | "built_in" | "learned";

export interface Check {
    key: string;
    label: string;
    your_words: string | null;
    source: RuleSource;
    result: CheckResult;
    fact: string | null;
}

export interface Money {
    value: number;
    currency: string;
    chf: number;
}

export interface Merchant {
    id: string;
    name: string;
    category: string;
    country: string;
}

export interface LineItem {
    name: string;
    category: string;
    qty: number;
    unit_price: number;
    currency: string;
}

export interface Decision {
    id: string;
    scenario_id?: string;
    replay_order?: number;
    created_at: string;
    decision: DecisionKind;
    status: DecisionStatus;
    reason_codes: string[];
    headline: string;
    because: string;
    checks: Check[];
    uncertainty: string[];
    shop_text_quarantine: string | null;
    amount: Money;
    merchant: Merchant;
    items: LineItem[];
    device_id?: string;
    group_id: string | null;
    deadline_at?: string;
    suggestion?: { id: string; text: string };
    actions: string[];
}

export interface ScenarioRule {
    key: string;
    label: string;
    your_words: string | null;
    source: RuleSource;
}

export interface MockData {
    _note: string;
    scenarios: Record<string, { name: string; instruction: string; rules: ScenarioRule[] }>;
    decisions: Decision[];
}

/** Failing and unsure checks first, then passes. */
export const sortChecks = (checks: Check[]): Check[] => {
    const order: Record<CheckResult, number> = { fail: 0, unsure: 1, pass: 2 };
    return [...checks].sort((a, b) => order[a.result] - order[b.result]);
};
