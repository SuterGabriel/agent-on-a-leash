import type { ReactNode } from "react";
import { useRef } from "react";
import { InfoCircle, Minus, Moon01, Phone01, Plus, ShoppingBag02 } from "@untitledui/icons";
import { Button as AriaButton } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { BottomSheet } from "@/components/shopping-card/bottom-sheet";
import { GroupedList } from "@/components/shopping-card/grouped-list";
import { ListRow } from "@/components/shopping-card/list-row";
import { CountdownRing } from "@/features/shopping-card/countdown-ring";
import { checksFor, customer, getDecision, proposedRules, ruleLabel, shopQuote } from "@/features/shopping-card/demo-data";
import { SIGNAL_COPY, cardLast4, isLive } from "@/features/shopping-card/live-view";
import { FaceIdGlyph } from "@/features/shopping-card/face-id";
import { formatChf } from "@/features/shopping-card/format";
import { burstDecisions, pendingSuggestion, usePrototype } from "@/features/shopping-card/prototype-state";
import { RuleRow } from "@/features/shopping-card/rule-row";
import { ShopTextBox } from "@/features/shopping-card/shop-text-box";
import { VoiceStatus } from "@/features/voice/voice-status";

const DetailLine = ({ label, value }: { label: string; value: string }) => (
    <div className="group/row flex items-center pl-4">
        <div className="flex flex-1 items-baseline justify-between gap-3 border-b border-secondary py-3 pr-4 group-last/row:border-b-0">
            <span className="text-md text-secondary">{label}</span>
            <span className="text-right text-md font-semibold text-primary tabular-nums">{value}</span>
        </div>
    </div>
);

/** 4.1 Ask me sheet · 4.2 See checks (sibling of the Viseca one 3-D Secure sheet). */
const QuestionContent = () => {
    const { state, dispatch, secondsLeft } = usePrototype();
    const id = state.waiting?.decisionId ?? "AU0040";
    const d = getDecision(id);
    const checks = checksFor(id);
    const unsure = checks.find((c) => c.result === "unsure");
    const quote = shopQuote(d);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 pt-2">
                <CountdownRing secondsLeft={state.waiting ? secondsLeft : 0} />
                <h2 className="text-xl font-semibold text-primary">Your agent wants to pay</h2>
                <VoiceStatus />
            </div>
            <div className="flex flex-col overflow-hidden rounded-2xl bg-secondary">
                <DetailLine label="Shop" value={d.merchant.name} />
                <DetailLine label="Item" value={d.items[0]?.name ?? ""} />
                <DetailLine label="Amount" value={formatChf(d.amount.chf)} />
                <DetailLine label="Card" value={`${customer.cardName} •• ${cardLast4(state)}`} />
            </div>
            <div className="flex items-start gap-3 rounded-2xl bg-secondary px-4 py-3.5">
                <InfoCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="flex flex-col gap-0.5">
                    <span className="text-md font-semibold text-primary">Why we ask</span>
                    <p className="text-md text-secondary">{d.because}</p>
                </div>
            </div>
            <Button
                size="md"
                color="tertiary"
                className="self-center"
                aria-expanded={state.questionExpanded}
                onClick={() => dispatch({ type: "PATCH", patch: { questionExpanded: !state.questionExpanded } })}
            >
                {state.questionExpanded ? "Hide checks" : "See checks"}
            </Button>
            {state.questionExpanded && (
                <>
                    <GroupedList surface="secondary" title="Checked against your rules">
                        {checks.map((c) => (
                            <RuleRow key={c.key} mode="result" result={c.result} label={c.label} fact={c.fact} yourWords={c === unsure ? c.yourWords : null} />
                        ))}
                    </GroupedList>
                    {quote && <ShopTextBox quote={quote} />}
                </>
            )}
        </div>
    );
};

/** 4.4 You declined: the learned-rule offer (F6). */
const DeclinedContent = () => {
    const { state, dispatch } = usePrototype();
    const suggestion = pendingSuggestion(state);
    const close = () => dispatch({ type: "SHEET", sheet: null });
    if (!suggestion) {
        return (
            <Button size="lg" color="primary" onClick={close}>
                Done
            </Button>
        );
    }
    return (
        <div className="flex flex-col gap-4 rounded-2xl bg-secondary p-4">
            <div className="flex flex-col gap-1">
                <p className="text-lg font-semibold text-primary">{suggestion}?</p>
                <p className="text-sm text-secondary">Your answer becomes a rule. You can remove it any time under Rules.</p>
            </div>
            <div className="flex gap-3 *:flex-1">
                <Button size="lg" color="secondary" onClick={close}>
                    Just this time
                </Button>
                <Button size="lg" color="primary" onClick={() => dispatch({ type: "ACCEPT_SUGGESTION", text: suggestion })}>
                    Yes, always
                </Button>
            </div>
        </div>
    );
};

/** 1.3a / 6.2 Change a value (stepper). Before the card exists any value is fine; afterwards looser needs Face ID. */
const EditRuleContent = () => {
    const { state, dispatch } = usePrototype();
    const editing = state.editing;
    if (!editing) return null;
    const rule = proposedRules.find((r) => r.key === editing.key)!;
    const step = rule.step ?? 50;
    const set = (v: number) => dispatch({ type: "PATCH", patch: { editing: { ...editing, draft: Math.max(rule.min ?? 0, Math.min(rule.max ?? 10_000, v)) } } });
    const stepper =
        "flex size-11 cursor-pointer items-center justify-center rounded-full bg-tertiary text-primary outline-focus-ring pressed:bg-quaternary focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50";
    const looser = state.cardCreated && editing.draft > state.rules[editing.key];
    return (
        <div className="flex flex-col items-center gap-4 pb-2">
            <div className="flex items-center gap-6">
                <AriaButton
                    aria-label={`Lower by CHF ${step}`}
                    className={stepper}
                    isDisabled={editing.draft <= (rule.min ?? 0)}
                    onPress={() => set(editing.draft - step)}
                >
                    <Minus className="size-5" />
                </AriaButton>
                <span aria-live="polite" className="min-w-36 text-center text-display-sm font-bold text-primary tabular-nums">
                    {formatChf(editing.draft, { cents: false })}
                </span>
                <AriaButton
                    aria-label={`Raise by CHF ${step}`}
                    className={stepper}
                    isDisabled={editing.draft >= (rule.max ?? 10_000)}
                    onPress={() => set(editing.draft + step)}
                >
                    <Plus className="size-5" />
                </AriaButton>
            </div>
            <p className="text-lg text-primary">
                {editing.key === "orderLimit" ? "From the next payment: max" : "In any 30 days: max"} {formatChf(editing.draft, { cents: false })}
            </p>
            <p className="text-sm text-tertiary">{rule.evidence}</p>
            {state.cardCreated && <p className="text-sm text-tertiary">{looser ? "Looser needs Face ID." : "Stricter applies at once."}</p>}
        </div>
    );
};

/** 7.2 Was this you sheet */
const WasThisYouContent = () => {
    const { state } = usePrototype();
    const group = burstDecisions(state);
    // Live: what the engine noticed on these payments. Mock: the prototype's three lines.
    const signals = [...new Set(group.flatMap((d) => d.signals ?? []))];
    const device = group.find((d) => d.device_id)?.device_id;
    const icon = (s: string) => (s === "unusual_hour" ? Moon01 : s.includes("device") ? Phone01 : ShoppingBag02);
    return (
        <div className="flex flex-col gap-6">
            <GroupedList surface="secondary">
                {group.map((d) => (
                    <ListRow key={d.id} title={d.merchant.name} subtitle={`Today ${d.created_at.slice(11, 16)}`} value={formatChf(d.amount.chf)} />
                ))}
            </GroupedList>
            {isLive ? (
                signals.length > 0 && (
                    <GroupedList surface="secondary" title="What looked odd">
                        {signals.map((s) => (
                            <ListRow key={s} icon={icon(s)} plainTitle title={SIGNAL_COPY[s] ?? s.replace(/_/g, " ")} subtitle={s === "new_device" && device ? device : undefined} />
                        ))}
                    </GroupedList>
                )
            ) : (
                <GroupedList surface="secondary" title="What looked odd">
                    <ListRow icon={Phone01} plainTitle title="New phone" subtitle="iPhone 15, Zurich" />
                    <ListRow icon={Moon01} plainTitle title="At night" />
                    <ListRow icon={ShoppingBag02} plainTitle title="4 shops you never used" />
                </GroupedList>
            )}
        </div>
    );
};

interface SheetConfig {
    title?: string;
    description?: string;
    ariaLabel?: string;
    children?: ReactNode;
    actions?: ReactNode;
}

/** All bottom sheets of the prototype, driven by `state.sheet`. */
export const SheetHost = () => {
    const { state, dispatch } = usePrototype();
    const close = () => dispatch({ type: "SHEET", sheet: null });
    const sheet = state.sheet;
    const answered = state.lastAnswered ? getDecision(state.lastAnswered) : null;
    const editing = state.editing;
    const looser = !!editing && state.cardCreated && editing.draft > state.rules[editing.key];

    const config = ((): SheetConfig | null => {
        switch (sheet) {
            case "question":
                return {
                    ariaLabel: "Your agent wants to pay",
                    children: <QuestionContent />,
                    actions: (
                        <>
                            <Button size="lg" color="secondary" onClick={() => dispatch({ type: "RESOLVE_ASK", outcome: "declined" })}>
                                Decline
                            </Button>
                            <Button
                                size="lg"
                                color="primary"
                                iconLeading={<FaceIdGlyph className="text-white" />}
                                onClick={() => dispatch({ type: "FACE_ID", then: { type: "RESOLVE_ASK", outcome: "approved" } })}
                            >
                                Approve
                            </Button>
                        </>
                    ),
                };
            case "approved":
                return {
                    title: answered ? `Paid ${formatChf(answered.amount.chf)} at ${answered.merchant.name}` : "Paid",
                    description: "Your agent was told to go ahead. It counts toward this month's budget.",
                    actions: (
                        <Button size="lg" color="primary" onClick={close}>
                            Done
                        </Button>
                    ),
                };
            case "declined":
                return { title: "You declined. Nothing was bought.", description: "Your agent was told why.", children: <DeclinedContent /> };
            case "timesup":
                return {
                    ariaLabel: "Time's up",
                    children: (
                        <div className="flex flex-col items-center gap-3 pt-2 pb-2 text-center">
                            <CountdownRing secondsLeft={0} />
                            <h2 className="text-xl font-semibold text-primary">Time's up</h2>
                            <p className="text-lg text-secondary">Nothing was bought. Your agent was told why.</p>
                        </div>
                    ),
                    actions: (
                        <Button size="lg" color="primary" onClick={close}>
                            OK
                        </Button>
                    ),
                };
            case "edit-rule":
                return {
                    title: editing ? ruleLabel(editing.key, state.rules).label : "Change",
                    children: <EditRuleContent />,
                    actions: (
                        <>
                            <Button size="lg" color="secondary" onClick={() => dispatch({ type: "SHEET", sheet: null, patch: { editing: null } })}>
                                Cancel
                            </Button>
                            {looser ? (
                                <Button
                                    size="lg"
                                    color="primary"
                                    iconLeading={<FaceIdGlyph className="text-white" />}
                                    onClick={() => dispatch({ type: "FACE_ID", then: { type: "SAVE_RULE" } })}
                                >
                                    Save with Face ID
                                </Button>
                            ) : (
                                <Button size="lg" color="primary" onClick={() => dispatch({ type: "SAVE_RULE" })}>
                                    Save
                                </Button>
                            )}
                        </>
                    ),
                };
            case "was-this-you":
                return {
                    title: "Was this you?",
                    children: <WasThisYouContent />,
                    actions: (
                        <>
                            <Button size="lg" color="secondary" onClick={() => dispatch({ type: "WAS_ME", answer: "no" })}>
                                No, it wasn't me
                            </Button>
                            <Button
                                size="lg"
                                color="primary"
                                iconLeading={<FaceIdGlyph className="text-white" />}
                                onClick={() => dispatch({ type: "FACE_ID", then: { type: "WAS_ME", answer: "yes" } })}
                            >
                                Yes, it was me
                            </Button>
                        </>
                    ),
                };
            case "freeze":
                return {
                    title: "Pause the Agent Card?",
                    description: "No agent can pay with it for 24 hours. Waiting questions are cancelled. Your rules stay. Your main card is not affected.",
                    actions: (
                        <>
                            <Button size="lg" color="secondary" onClick={close}>
                                Cancel
                            </Button>
                            <Button size="lg" color="primary" onClick={() => dispatch({ type: "SHEET", sheet: null, patch: { frozen: true, waiting: null } })}>
                                Pause
                            </Button>
                        </>
                    ),
                };
            case "turn-off":
                return {
                    title: "Turn off the Agent Card?",
                    description: "The card number stops working and your agent can't pay anymore. Waiting questions are cancelled. Your history stays.",
                    actions: (
                        <>
                            <Button size="lg" color="secondary" onClick={close}>
                                Cancel
                            </Button>
                            <Button
                                size="lg"
                                color="primary-destructive"
                                iconLeading={<FaceIdGlyph className="text-white" />}
                                onClick={() => dispatch({ type: "FACE_ID", then: { type: "TURN_OFF" } })}
                            >
                                Turn off
                            </Button>
                        </>
                    ),
                };
            default:
                return null;
        }
    })();

    // Keep the last content while the sheet animates out.
    const last = useRef<SheetConfig | null>(null);
    if (config) last.current = config;
    const shown = config ?? last.current;

    return (
        <BottomSheet
            isOpen={!!config}
            onClose={close}
            contentKey={sheet ?? undefined}
            title={shown?.title}
            description={shown?.description}
            ariaLabel={shown?.ariaLabel}
            actions={shown?.actions}
        >
            {shown?.children}
        </BottomSheet>
    );
};
