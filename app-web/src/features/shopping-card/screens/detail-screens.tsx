import { useState } from "react";
import { Phone01, ShoppingBag02 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { NavBar } from "@/components/chrome/nav-bar";
import { GroupedList } from "@/components/shopping-card/grouped-list";
import { ListRow } from "@/components/shopping-card/list-row";
import type { StatusPillStatus } from "@/components/shopping-card/status-pill";
import { StatusPill } from "@/components/shopping-card/status-pill";
import { BudgetMeter } from "@/features/shopping-card/budget-meter";
import {
    alwaysOn,
    checksFor,
    customer,
    getDecision,
    knownShops,
    learnedRuleFor,
    proposedRules,
    ruleLabel,
    shopQuote,
    smartSettings,
    statusSentence,
    task,
} from "@/features/shopping-card/demo-data";
import { formatChf } from "@/features/shopping-card/format";
import { usePrototype } from "@/features/shopping-card/prototype-state";
import { RuleRow } from "@/features/shopping-card/rule-row";
import { monthCaption } from "@/features/shopping-card/screens/everyday-screens";
import { Hero, InfoCard, Screen } from "@/features/shopping-card/screens/screen";
import { SettingRow } from "@/features/shopping-card/setting-row";
import { ShopTextBox } from "@/features/shopping-card/shop-text-box";
import { ShoppingCard } from "@/features/shopping-card/shopping-card";

/** 5.2 Payment details: headline, because, checklist (failing first, your words on the failing rule), details, actions. */
export const PaymentDetailsScreen = () => {
    const { state, dispatch } = usePrototype();
    const d = getDecision(state.paymentId);
    const row = state.activity.find((a) => a.decisionId === d.id);
    const status: StatusPillStatus = row?.status ?? (d.decision === "approve" ? "approved" : d.decision === "step_up" ? "waiting" : "declined");
    const isStruck = status === "declined" || status === "you-declined" || status === "times-up";
    const checks = checksFor(d.id);
    const quote = d.reason_codes.includes("shop_text_manipulation") ? shopQuote(d) : null;
    const suggested = d.reason_codes.map((r) => learnedRuleFor[r]).find(Boolean);
    const back = () => dispatch({ type: "BACK", fallback: "3.1" });

    return (
        <Screen nav={<NavBar variant="inline" title="Payment" onBack={back} />}>
            <div className="flex flex-col items-center gap-2 pt-2 text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-tertiary text-primary">
                    <ShoppingBag02 className="size-7" />
                </span>
                <span className="text-xl font-semibold text-primary">{d.merchant.name}</span>
                <span className={isStruck ? "text-display-xs font-bold text-tertiary tabular-nums line-through" : "text-display-xs font-bold text-primary tabular-nums"}>
                    {formatChf(d.amount.chf)}
                </span>
                <StatusPill status={status} />
            </div>

            <InfoCard>{statusSentence(d, status)}</InfoCard>

            {quote && <ShopTextBox surface="primary" quote={quote} />}

            <GroupedList title="Checked against your rules">
                {checks.map((c) => (
                    <RuleRow key={c.key} mode="result" result={c.result} label={c.label} fact={c.fact} yourWords={c.result === "fail" ? c.yourWords : null} />
                ))}
            </GroupedList>

            <GroupedList>
                <ListRow plainTitle title="Item" value={d.items[0]?.name} />
                <ListRow plainTitle title="Card" value={`${customer.cardName} •• ${customer.cardLast4}`} />
                <ListRow plainTitle title="Time" value={row?.time ?? `Today ${d.created_at.slice(11, 16)}`} />
            </GroupedList>

            <div className="flex flex-col gap-2">
                <Button size="lg" color="primary" onClick={back}>
                    OK
                </Button>
                {isStruck && suggested && !state.learned.some((l) => l.text === suggested) && (
                    <Button size="lg" color="secondary" onClick={() => dispatch({ type: "ACCEPT_SUGGESTION", text: suggested })}>
                        {suggested}
                    </Button>
                )}
            </div>
        </Screen>
    );
};

/** 6.1 Rules (control centre): budget, card rules, smart settings, the task, learned, always on, pause / turn off. */
export const RulesScreen = () => {
    const { state, dispatch } = usePrototype();
    return (
        <Screen nav={<NavBar variant="inline" title="Rules" onBack={() => dispatch({ type: "BACK", fallback: "3.1" })} />}>
            <BudgetMeter label="This month" total={state.rules.monthBudget} spent={state.monthSpent} caption={monthCaption(state.monthSpent)} />

            <GroupedList title="From your shopping" footer="Tap a value to change it. Stricter applies at once, looser needs Face ID.">
                {proposedRules.map((r) => {
                    const { label, value } = ruleLabel(r.key, state.rules);
                    return (
                        <RuleRow
                            key={r.key}
                            mode="settings"
                            label={label}
                            value={value}
                            evidence={r.evidence}
                            onPress={
                                r.editable
                                    ? () => dispatch({ type: "EDIT_RULE", key: r.key as "orderLimit" | "monthBudget" })
                                    : r.key === "knownShops"
                                      ? () => dispatch({ type: "GO", screen: "6.3" })
                                      : undefined
                            }
                        />
                    );
                })}
            </GroupedList>

            <GroupedList title="Smart settings">
                {smartSettings.map((s) => (
                    <SettingRow
                        key={s.key}
                        title={s.title}
                        evidence={s.evidence}
                        options={s.options}
                        value={state.smart[s.key]}
                        onChange={(v) =>
                            v === s.stricter || state.smart[s.key] === s.stricter
                                ? v === s.stricter
                                    ? dispatch({ type: "SET_SMART", key: s.key, value: v })
                                    : dispatch({ type: "FACE_ID", then: { type: "SET_SMART", key: s.key, value: v } })
                                : dispatch({ type: "SET_SMART", key: s.key, value: v })
                        }
                    />
                ))}
            </GroupedList>

            {state.taskActive && (
                <GroupedList title="What your agent was asked to buy" footer="Sent by your agent with its first payment. Checked on every payment, next to your card rules.">
                    <p className="px-4 pt-4 pb-2 text-md text-primary">&ldquo;{task.instruction}&rdquo;</p>
                    {task.rules.map((r) => (
                        <RuleRow key={r.key} mode="review" label={r.label} yourWords={r.yourWords} />
                    ))}
                </GroupedList>
            )}

            {state.learned.length > 0 && (
                <GroupedList title="Learned from your answers">
                    {state.learned.map((l) => (
                        <ListRow
                            key={l.text}
                            title={l.text}
                            subtitle={l.added}
                            accessory={
                                <Button size="sm" color="secondary" onClick={() => dispatch({ type: "REMOVE_LEARNED", text: l.text })}>
                                    Remove
                                </Button>
                            }
                        />
                    ))}
                </GroupedList>
            )}

            <GroupedList title="Always on">
                {alwaysOn.map((label) => (
                    <RuleRow key={label} mode="locked" label={label} />
                ))}
            </GroupedList>

            <div className="flex flex-col gap-1">
                <Button size="lg" color="secondary" onClick={() => dispatch({ type: "SHEET", sheet: "freeze" })}>
                    Pause for 24 hours
                </Button>
                <Button size="lg" color="tertiary-destructive" onClick={() => dispatch({ type: "SHEET", sheet: "turn-off" })}>
                    Turn off Agent Card
                </Button>
            </div>
        </Screen>
    );
};

/** 6.3 Card details and known shops */
export const CardDetailsScreen = () => {
    const { dispatch } = usePrototype();
    const [declines, setDeclines] = useState(true);
    const [summary, setSummary] = useState(true);
    const [blocked, setBlocked] = useState<string[]>([]);

    return (
        <Screen nav={<NavBar variant="inline" title="Details" onBack={() => dispatch({ type: "BACK", fallback: "3.1" })} />}>
            <GroupedList title="Card">
                <ListRow plainTitle title="Number" value={`•••• ${customer.cardLast4}`} />
                <ListRow plainTitle title="Linked to" value={`${customer.mainCard} •• ${customer.mainLast4}`} />
                <ListRow plainTitle title="Online only" trailing="toggle" toggle={{ isSelected: true, isDisabled: true }} />
            </GroupedList>
            <GroupedList title="Shops you know" footer="Shops you bought from with this card or your main card. Block one and your agent can't pay there.">
                {knownShops.map((shop) => {
                    const isBlocked = blocked.includes(shop.name);
                    return (
                        <ListRow
                            key={shop.name}
                            icon={ShoppingBag02}
                            title={shop.name}
                            subtitle={isBlocked ? "Blocked" : shop.used}
                            accessory={
                                <Button size="sm" color="secondary" onClick={() => setBlocked(isBlocked ? blocked.filter((b) => b !== shop.name) : [...blocked, shop.name])}>
                                    {isBlocked ? "Unblock" : "Block"}
                                </Button>
                            }
                        />
                    );
                })}
            </GroupedList>
            <GroupedList title="Notifications" footer="Questions always come through. Limits and budget declines never send a push.">
                <ListRow plainTitle title="Questions" trailing="toggle" toggle={{ isSelected: true, isDisabled: true }} />
                <ListRow plainTitle title="Risky stops" subtitle="Lookalike shops, shop text, unusual sessions" trailing="toggle" toggle={{ isSelected: declines, onChange: setDeclines }} />
                <ListRow plainTitle title="Morning summary" subtitle="What happened overnight, in one message" trailing="toggle" toggle={{ isSelected: summary, onChange: setSummary }} />
            </GroupedList>
        </Screen>
    );
};

/** 7.3 Not me */
export const NotMeScreen = () => {
    const { dispatch } = usePrototype();
    return (
        <Screen
            centered
            footer={
                <>
                    <Button size="lg" color="primary" onClick={() => dispatch({ type: "GO", screen: "3.1", patch: { frozen: false } })}>
                        Get a new card number
                    </Button>
                    <Button size="lg" color="tertiary" onClick={() => dispatch({ type: "GO", screen: "3.1" })}>
                        Later
                    </Button>
                </>
            }
        >
            <div className="px-8">
                <ShoppingCard variant="frozen" />
            </div>
            <Hero title="Your Agent Card is frozen" />
            <InfoCard>Your main card keeps working. •• {customer.mainLast4} is not affected.</InfoCard>
        </Screen>
    );
};

/** 7.3b Yes it was me */
export const YesMeScreen = () => {
    const { dispatch } = usePrototype();
    return (
        <Screen
            centered
            footer={
                <Button size="lg" color="primary" onClick={() => dispatch({ type: "GO", screen: "3.1" })}>
                    Done
                </Button>
            }
        >
            <Hero title="OK. We'll remember this phone." body="We'll still ask when a new phone shops at night.">
                <span className="flex size-16 items-center justify-center rounded-full bg-tertiary text-primary">
                    <Phone01 className="size-8" />
                </span>
            </Hero>
        </Screen>
    );
};
