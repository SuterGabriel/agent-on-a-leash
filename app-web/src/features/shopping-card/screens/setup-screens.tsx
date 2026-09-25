import { useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { NavBar } from "@/components/chrome/nav-bar";
import { GroupedList } from "@/components/shopping-card/grouped-list";
import { api } from "@/features/shopping-card/api/client";
import type { ColdStart } from "@/features/shopping-card/api/types";
import { alwaysOn, instructionFromRules, ruleLabel, smartSettings } from "@/features/shopping-card/demo-data";
import { analysisView, isLive, languageName, proposedView, ruleValueView, smartEvidence } from "@/features/shopping-card/live-view";
import { FaceIdGlyph } from "@/features/shopping-card/face-id";
import { usePrototype } from "@/features/shopping-card/prototype-state";
import { RuleRow } from "@/features/shopping-card/rule-row";
import { Screen, StepTitle } from "@/features/shopping-card/screens/screen";
import { SettingRow } from "@/features/shopping-card/setting-row";

const Stat = ({ value, label }: { value: string; label: string }) => (
    <div className="flex flex-col gap-0.5">
        <span className="text-display-xs font-bold text-primary tabular-nums">{value}</span>
        <span className="text-sm text-tertiary">{label}</span>
    </div>
);

/** The analysis card on 1.3: four honest numbers from the last 90 days. */
export const AnalysisCard = () => {
    const { state } = usePrototype();
    const analysis = analysisView(state);
    const cold = !!state.suggest?.cold_start;
    return (
        <div className="grid grid-cols-2 gap-4 rounded-2xl bg-primary p-4">
            <Stat value={String(analysis.purchases)} label={`purchases in ${analysis.windowDays} days`} />
            <Stat value={`CHF ${analysis.typical}`} label={cold ? "typical, customers like you" : "typical payment"} />
            <Stat value={`CHF ${analysis.biggest}`} label={cold ? "high end, customers like you" : "biggest payment"} />
            <Stat value={`CHF ${analysis.perMonth}`} label={cold ? "a month, customers like you" : "a month, online"} />
        </div>
    );
};

const pct = (x: number) => `${Math.round(x * 100)} %`;

/** 1.3 for a card without purchases: what we read from the customer's profile and learned from customers like them. */
const ColdStartCard = ({ cold }: { cold: ColdStart }) => (
    <GroupedList
        title="New here? We started from customers like you"
        footer={`Read from your profile by ${cold.signals.source === "apertus" ? "Apertus, the Swiss open model" : "our keyword reader"}. Customers like you are only a hint: they never approve a payment. Your own answers soon replace them.`}
    >
        <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-1">
                <span className="text-md font-semibold text-primary">You probably buy</span>
                {cold.predicted_categories.slice(0, 4).map((c) => (
                    <span key={c.category} className="flex justify-between text-md text-secondary">
                        <span>{c.category.replace(/_/g, " ")}</span>
                        <span className="text-tertiary tabular-nums">
                            {pct(c.confidence)} · {c.from.join(" + ")}
                        </span>
                    </span>
                ))}
            </div>
            {cold.neighbours.length > 0 && (
                <div className="flex flex-col gap-1">
                    <span className="text-md font-semibold text-primary">Why these customers</span>
                    <span className="text-sm text-secondary">{[...new Set(cold.neighbours.flatMap((n) => n.why))].slice(0, 4).join(" · ")}</span>
                </div>
            )}
            {cold.prior && cold.prior.shops.length > 0 && (
                <span className="text-sm text-tertiary">Shops they use: {cold.prior.shops.slice(0, 4).map((s) => s.name).join(", ")}. A new shop still asks you first.</span>
            )}
        </div>
    </GroupedList>
);

/** 1.3 Rules from your shopping (setup without typing; tap a value to change it) */
export const RulesFromShoppingScreen = () => {
    const { state, dispatch } = usePrototype();
    const analysis = analysisView(state);
    const cold = state.suggest?.cold_start ?? null;

    // Live: the proposal comes from the backend (this card's history, or customers like this one without history).
    useEffect(() => {
        if (!isLive || state.cardCreated) return;
        let gone = false;
        api.suggest(state.coldCustomerId ?? undefined)
            .then((suggest) => {
                if (gone) return;
                const value = (k: string) => suggest.rules.find((r) => r.key === k)?.suggested_value;
                const orderLimit = value("orderLimit");
                const monthBudget = value("monthBudget");
                const { evidence: _evidence, ...smart } = suggest.smart;
                dispatch({
                    type: "PATCH",
                    patch: {
                        suggest,
                        smart,
                        rules: { orderLimit: typeof orderLimit === "number" ? orderLimit : state.rules.orderLimit, monthBudget: typeof monthBudget === "number" ? monthBudget : state.rules.monthBudget },
                    },
                });
            })
            .catch((err) => console.error("suggest failed", err));
        return () => {
            gone = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.coldCustomerId, state.cardCreated]);

    return (
        <Screen
            nav={<NavBar variant="inline" onBack={() => dispatch({ type: "BACK", fallback: "1.2" })} />}
            footer={
                <Button size="lg" color="primary" onClick={() => dispatch({ type: "GO", screen: "1.4" })}>
                    Use these rules
                </Button>
            }
        >
            <StepTitle
                body={
                    cold
                        ? "No purchases on this card yet. We propose rules from your profile and from customers who shop like you. Tap a value to change it."
                        : `We looked at your last ${analysis.windowDays} days on this card and propose rules from it. Tap a value to change it.`
                }
            >
                {cold ? "Rules to start with" : "Rules from your shopping"}
            </StepTitle>
            <AnalysisCard />
            {cold && <ColdStartCard cold={cold} />}
            <GroupedList title="Proposed rules">
                {proposedView(state).map((r) => {
                    const { label } = ruleLabel(r.key, state.rules);
                    const value = ruleValueView(r.key, state) ?? ruleLabel(r.key, state.rules).value;
                    return (
                        <RuleRow
                            key={r.key}
                            mode="review"
                            label={label}
                            value={value}
                            evidence={r.evidence}
                            onPress={r.editable ? () => dispatch({ type: "EDIT_RULE", key: r.key as "orderLimit" | "monthBudget" }) : undefined}
                        />
                    );
                })}
            </GroupedList>
            <GroupedList title="What we tell the agent" footer="This sentence is stored with the card. Every payment is checked against it and against the rules above.">
                <p className="p-4 text-md text-primary">&ldquo;{instructionFromRules(state.rules, state.smart, analysis.categories)}&rdquo;</p>
            </GroupedList>
        </Screen>
    );
};

/** 1.4 Smart settings (more than a budget; all pre-set from history, all with evidence) */
export const SmartSettingsScreen = () => {
    const { state, dispatch } = usePrototype();
    return (
        <Screen
            nav={<NavBar variant="inline" onBack={() => dispatch({ type: "BACK", fallback: "1.3" })} />}
            footer={
                <Button
                    size="lg"
                    color="primary"
                    iconLeading={<FaceIdGlyph className="text-white" />}
                    isDisabled={!!state.taskDraft?.please_check.length}
                    onClick={() => dispatch({ type: "FACE_ID", then: { type: "CREATE_CARD" } })}
                >
                    Create card with Face ID
                </Button>
            }
        >
            <StepTitle body="Pre-set from your shopping. Making a setting stricter is always one tap. Loosening later needs Face ID.">Smart settings</StepTitle>
            <GroupedList>
                {smartSettings.map((s) => (
                    <SettingRow
                        key={s.key}
                        title={s.title}
                        evidence={smartEvidence(state, s.key)}
                        options={s.options}
                        value={state.smart[s.key]}
                        onChange={(v) => dispatch({ type: "SET_SMART", key: s.key, value: v })}
                    />
                ))}
            </GroupedList>
            {isLive && <OwnWords />}
            <GroupedList title="Always on" footer="Built into every Agent Card. These can't be switched off.">
                {alwaysOn.map((label) => (
                    <RuleRow key={label} mode="locked" label={label} />
                ))}
            </GroupedList>
        </Screen>
    );
};

/** 1.4 (live): the task in the customer's own words, any language. Apertus translates, our compiler reads, every number is checked. */
const OwnWords = () => {
    const { state, dispatch } = usePrototype();
    const [text, setText] = useState(state.taskDraft?.original ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const draft = state.taskDraft;
    const read = () => {
        setBusy(true);
        setError(null);
        api.understand(text)
            .then((taskDraft) => dispatch({ type: "PATCH", patch: { taskDraft } }))
            .catch((err: Error) => setError(err.message))
            .finally(() => setBusy(false));
    };
    return (
        <GroupedList title="Anything else? In your own words" footer="Any language: English, Deutsch, Schwiizerdütsch, français, italiano. We translate it, read it with the same rules as above and check that every number stayed the same. The model never decides a payment.">
            <div className="flex flex-col gap-3 p-4">
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={3}
                    placeholder="Chauf mer Laufschue Grössi 41, nöd meh als 150 Franke. Frog mi wenn unsicher."
                    className="w-full resize-none rounded-xl bg-secondary p-3 text-md text-primary outline-focus-ring focus-visible:outline-2"
                />
                <Button size="md" color="secondary" isDisabled={busy || !text.trim()} onClick={read}>
                    {busy ? "Reading…" : "Read my words"}
                </Button>
                {error && <p className="text-sm text-error-primary">{error}</p>}
                {draft && (
                    <div className="flex flex-col gap-2">
                        {draft.translated && (
                            <p className="text-sm text-tertiary">
                                {languageName(draft.language)} · read as: &ldquo;{draft.english}&rdquo;
                            </p>
                        )}
                        {draft.please_check.length > 0 && (
                            <p className="rounded-xl bg-secondary p-3 text-sm text-primary">Please check: {draft.please_check.join(", ")} changed in the translation. Correct your text before creating the card.</p>
                        )}
                        {draft.rules.map((r) => (
                            <RuleRow key={r.key + r.label} mode="review" label={r.label_local} yourWords={r.your_words} />
                        ))}
                        {draft.not_understood.length > 0 && <p className="text-sm text-tertiary">Not understood, so not a rule: {draft.not_understood.join("; ")}</p>}
                    </div>
                )}
            </div>
        </GroupedList>
    );
};
