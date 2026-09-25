// What each screen shows: the backend's data in live mode, the prototype's data in mock mode. One place, so no screen
// mixes the two (a live screen never shows a prototype number, a mock screen never waits for a server).
import { dataMode } from "@/features/shopping-card/api/client";
import type { SuggestResponse } from "@/features/shopping-card/api/types";
import { analysis, customer, knownShops, proposedRules, smartSettings, task } from "@/features/shopping-card/demo-data";
import type { ProposedRule, RuleKey } from "@/features/shopping-card/demo-data";
import type { State } from "@/features/shopping-card/prototype-state";

export const isLive = dataMode === "live";

export interface AnalysisView {
    windowDays: number;
    purchases: number;
    typical: number;
    biggest: number;
    perMonth: number;
    shopsUsed: number;
    categories: string[];
    categoryShare: number;
}

export const analysisView = (s: State): AnalysisView => {
    const a = s.suggest?.analysis;
    if (!isLive || !a || !s.suggest) return analysis;
    return {
        windowDays: s.suggest.window_days,
        purchases: a.purchases,
        typical: a.typical_chf,
        biggest: a.biggest_chf,
        perMonth: a.per_month_chf,
        shopsUsed: a.shops_used,
        categories: a.categories,
        categoryShare: a.category_share,
    };
};

/** The four proposed rules, with the backend's evidence when live. */
export const proposedView = (s: State): ProposedRule[] => {
    const fromBackend = new Map<RuleKey, SuggestResponse["rules"][number]>((s.suggest?.rules ?? []).map((r) => [r.key, r]));
    return proposedRules.map((r) => (isLive && fromBackend.get(r.key) ? { ...r, evidence: fromBackend.get(r.key)!.evidence } : r));
};

/** "Each payment · CHF 300" etc., counting live shops and categories. */
export const ruleValueView = (key: RuleKey, s: State): string | null => {
    const a = analysisView(s);
    if (key === "knownShops") return isLive && s.knownShops ? `${s.knownShops.length} shops` : `${a.shopsUsed} shops`;
    if (key === "categories") return String(a.categories.length);
    return null;
};

export const smartEvidence = (s: State, key: string): string => s.suggest?.smart.evidence[key] ?? smartSettings.find((x) => x.key === key)?.evidence ?? "";

export const cardLast4 = (s: State): string => (isLive ? (s.cardLast4 ?? "••••") : customer.cardLast4);

/** The task the agent was given: what the backend stored (live), or the prototype's SCEN0004 task. */
export const taskView = (s: State): { instruction: string; rules: { key: string; label: string; yourWords: string }[]; original?: { language: string; text: string } } | null => {
    if (!isLive) return task;
    const t = s.liveTask;
    if (!t) return null;
    return { instruction: t.instruction, rules: t.rules.map((r) => ({ key: r.key, label: r.label, yourWords: r.your_words })), original: t.original };
};

export const knownShopsView = (s: State): { id: string; name: string; used: string; learned: boolean }[] => {
    if (!isLive) return knownShops.map((k) => ({ id: k.name, name: k.name, used: k.used, learned: false }));
    return (s.knownShops ?? []).map((k) => ({
        id: k.merchant_id,
        name: k.name,
        used: k.new ? `You said yes${k.times_used > 1 ? ` ${k.times_used} times` : ""}` : `Used ${k.times_used} time${k.times_used === 1 ? "" : "s"}`,
        learned: k.new,
    }));
};

/** "Rolling 30 days · CHF 289.00 frees up 11 Oct": the date is the backend's (live), the prototype's otherwise. */
export const freesUpLabel = (s: State): string | null => {
    if (!isLive) return "11 Sep";
    if (!s.freesUpAt) return null;
    const t = new Date(s.freesUpAt);
    return Number.isNaN(t.getTime()) ? null : t.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

const LANGUAGE: Record<string, string> = { de: "German", gsw: "Swiss German", fr: "French", it: "Italian", rm: "Romansh", en: "English", other: "another language" };
export const languageName = (code: string) => LANGUAGE[code] ?? code;

export const SIGNAL_COPY: Record<string, string> = {
    new_device: "New phone",
    unusual_hour: "At an unusual hour",
    quick_series: "Many payments in a few minutes",
    new_country: "From a new country",
    unfamiliar_merchant: "Shops you never used",
    untrusted_device: "A phone you said wasn't you",
};
