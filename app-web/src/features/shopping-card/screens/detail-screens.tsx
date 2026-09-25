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
    learnedRuleFor,
    ruleLabel,
    shopQuote,
    smartSettings,
    statusSentence,
} from "@/features/shopping-card/demo-data";
import { api } from "@/features/shopping-card/api/client";
import { cardLast4, freesUpLabel, isLive, knownShopsView, languageName, proposedView, ruleValueView, smartEvidence, taskView } from "@/features/shopping-card/live-view";
import { formatChf } from "@/features/shopping-card/format";
import { usePrototype } from "@/features/shopping-card/prototype-state";
import { RuleRow } from "@/features/shopping-card/rule-row";
import { monthCaption } from "@/features/shopping-card/screens/everyday-screens";
import { Hero, InfoCard, Screen } from "@/features/shopping-card/screens/screen";
import { SettingRow } from "@/features/shopping-card/setting-row";
import { ShopTextBox } from "@/features/shopping-card/shop-text-box";
import { ShoppingCard } from "@/features/shopping-card/shopping-card";
import type { CheckFamily, Decision } from "@/types/decision";

const MIX: { key: keyof NonNullable<Decision["evidence_mix"]>; label: string; className: string }[] = [
    { key: "your_rules", label: "Your rules", className: "bg-utility-brand-600" },
    { key: "your_history", label: "Your history", className: "bg-utility-brand-400" },
    { key: "taught_by_you", label: "Taught by you", className: "bg-utility-success-500" },
    { key: "customers_like_you", label: "Customers like you", className: "bg-utility-warning-400" },
    { key: "unknown", label: "Couldn't know", className: "bg-utility-gray-300" },
];

/** 5.2 (live): what this decision rests on, counted over its checks. No black box. */
const EvidenceMix = ({ mix }: { mix: NonNullable<Decision["evidence_mix"]> }) => {
    const total = MIX.reduce((n, m) => n + mix[m.key], 0);
    if (!total) return null;
    const parts = MIX.filter((m) => mix[m.key] > 0);
    return (
        <GroupedList title="What this decision rests on">
            <div className="flex flex-col gap-3 p-4">
                <div className="flex h-3 overflow-hidden rounded-full">
                    {parts.map((m) => (
                        <span key={m.key} className={m.className} style={{ width: `${(mix[m.key] / total) * 100}%` }} />
                    ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {parts.map((m) => (
                        <span key={m.key} className="flex items-center gap-1.5 text-sm text-secondary">
                            <span aria-hidden className={`size-2 rounded-full ${m.className}`} />
                            {m.label} · {mix[m.key]}
                        </span>
                    ))}
                </div>
            </div>
        </GroupedList>
    );
};

const FAMILY_ORDER: CheckFamily[] = ["money", "item", "shop", "session", "manipulation"];
// Kim: these five titles are placeholder wording from the backend side; change them here, nothing else depends on them.
const FAMILY_TITLE: Record<CheckFamily, string> = { money: "Money", item: "Item and terms", shop: "Shop", session: "Looks like you", manipulation: "Repeats and manipulation" };

/** Live decisions carry a family per check: one list per family, in a fixed order. Prototype data has none: one list. */
function checkFamilies<T extends { family?: CheckFamily }>(checks: T[]): [CheckFamily | "all", T[]][] {
    if (!checks.some((c) => c.family)) return checks.length ? [["all", checks]] : [];
    return FAMILY_ORDER.map((f) => [f, checks.filter((c) => c.family === f)] as [CheckFamily, T[]]).filter(([, rows]) => rows.length > 0);
}

/** 5.2 Payment details: headline, because, checklist (failing first, your words on the failing rule), details, actions. */
export const PaymentDetailsScreen = () => {
    const { state, dispatch } = usePrototype();
    const d = getDecision(state.paymentId);
    const row = state.activity.find((a) => a.decisionId === d.id);
    const status: StatusPillStatus = row?.status ?? (d.decision === "approve" ? "approved" : d.decision === "step_up" ? "waiting" : "declined");
    const isStruck = status === "declined" || status === "you-declined" || status === "times-up";
    const checks = checksFor(d.id);
    const quote = d.reason_codes.includes("shop_text_manipulation") ? shopQuote(d) : null;
    // Live: only what the backend offered (nothing when learning is off). Mock: the prototype's table.
    const suggested = isLive ? d.suggestion?.text : d.reason_codes.map((r) => learnedRuleFor[r]).find(Boolean);
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

            {d.evidence_mix && <EvidenceMix mix={d.evidence_mix} />}

            {checkFamilies(checks).map(([family, rows]) => (
                <GroupedList key={family} title={family === "all" ? "Checked against your rules" : FAMILY_TITLE[family]}>
                    {rows.map((c) => (
                        <RuleRow key={c.key} mode="result" result={c.result} label={c.label} fact={c.fact} yourWords={c.result === "fail" ? c.yourWords : null} />
                    ))}
                </GroupedList>
            ))}

            <GroupedList>
                <ListRow plainTitle title="Item" value={d.items[0]?.name} />
                <ListRow plainTitle title="Card" value={`${customer.cardName} •• ${cardLast4(state)}`} />
                <ListRow plainTitle title="Time" value={row?.time ?? `Today ${d.created_at.slice(11, 16)}`} />
            </GroupedList>

            <div className="flex flex-col gap-2">
                <Button size="lg" color="primary" onClick={back}>
                    OK
                </Button>
                {isStruck && suggested && !state.learned.some((l) => l.text === suggested) && (
                    <Button size="lg" color="secondary" onClick={() => dispatch({ type: "ACCEPT_SUGGESTION", text: suggested, decisionId: d.id })}>
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
    const task = taskView(state);
    return (
        <Screen nav={<NavBar variant="inline" title="Rules" onBack={() => dispatch({ type: "BACK", fallback: "3.1" })} />}>
            <BudgetMeter label="This month" total={state.rules.monthBudget} spent={state.monthSpent} caption={monthCaption(state.monthSpent, freesUpLabel(state))} />

            <GroupedList title="From your shopping" footer="Tap a value to change it. Stricter applies at once, looser needs Face ID.">
                {proposedView(state).map((r) => {
                    const { label } = ruleLabel(r.key, state.rules);
                    const value = ruleValueView(r.key, state) ?? ruleLabel(r.key, state.rules).value;
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
                        evidence={smartEvidence(state, s.key)}
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

            {state.taskActive && task && (
                <GroupedList title="What your agent was asked to buy" footer="Sent by your agent with its first payment. Checked on every payment, next to your card rules.">
                    {task.original && (
                        <p className="px-4 pt-4 text-md text-primary">
                            &ldquo;{task.original.text}&rdquo; <span className="text-sm text-tertiary">· your words, {languageName(task.original.language)}</span>
                        </p>
                    )}
                    <p className={task.original ? "px-4 pt-1 pb-2 text-sm text-tertiary" : "px-4 pt-4 pb-2 text-md text-primary"}>&ldquo;{task.instruction}&rdquo;</p>
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
                                // Live: a learned rule is part of the Viseca mandate, which can't drop a rule; it goes when the card is turned off.
                                isLive ? undefined : (
                                    <Button size="sm" color="secondary" onClick={() => dispatch({ type: "REMOVE_LEARNED", text: l.text })}>
                                        Remove
                                    </Button>
                                )
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
    const { state, dispatch } = usePrototype();
    const [declines, setDeclines] = useState(true);
    const [summary, setSummary] = useState(true);
    const memoryBlocked = new Set((state.memory?.blocked_shops ?? []).map((b) => b.merchant_id));
    const isBlocked = (id: string) => state.blocked.includes(id) || memoryBlocked.has(id);
    const shops = knownShopsView(state);
    const devices = state.memory?.devices ?? [];
    const forgetDevice = (id: string) =>
        api.forgetDevice(id)
            .then(() => api.memory())
            .then((memory) => dispatch({ type: "PATCH", patch: { memory } }))
            .catch((err) => console.error("forget device failed", err));

    return (
        <Screen nav={<NavBar variant="inline" title="Details" onBack={() => dispatch({ type: "BACK", fallback: "3.1" })} />}>
            <GroupedList title="Card">
                <ListRow plainTitle title="Number" value={`•••• ${cardLast4(state)}`} />
                <ListRow plainTitle title="Linked to" value={`${customer.mainCard} •• ${customer.mainLast4}`} />
                <ListRow plainTitle title="Online only" trailing="toggle" toggle={{ isSelected: true, isDisabled: true }} />
            </GroupedList>
            <GroupedList
                title="Shops you know"
                footer="Shops you bought from with this card, plus the ones you said yes to. Block one and your agent can't pay there. Unblocking needs Face ID."
            >
                {shops.length === 0 && <p className="p-4 text-md text-secondary">No shops yet. Every yes you give adds one here.</p>}
                {shops.map((shop) => {
                    const blocked = isBlocked(shop.id);
                    return (
                        <ListRow
                            key={shop.id}
                            icon={ShoppingBag02}
                            title={shop.name}
                            subtitle={blocked ? "Blocked" : shop.used}
                            accessory={
                                <Button
                                    size="sm"
                                    color="secondary"
                                    onClick={() =>
                                        blocked
                                            ? dispatch({ type: "FACE_ID", then: { type: "UNBLOCK_SHOP", merchantId: shop.id } })
                                            : dispatch({ type: "BLOCK_SHOP", merchantId: shop.id })
                                    }
                                >
                                    {blocked ? "Unblock" : "Block"}
                                </Button>
                            }
                        />
                    );
                })}
            </GroupedList>
            {isLive && devices.length > 0 && (
                <GroupedList title="Phones we know" footer="Learned from your answers. Forget one and its next payment asks you again.">
                    {devices.map((d) => (
                        <ListRow
                            key={d.device_id}
                            icon={Phone01}
                            title={d.device_id}
                            subtitle={d.trusted ? `Trusted · ${d.times} payment${d.times === 1 ? "" : "s"}` : "You said it wasn't you. Always declined"}
                            accessory={
                                <Button size="sm" color="secondary" onClick={() => forgetDevice(d.device_id)}>
                                    Forget
                                </Button>
                            }
                        />
                    ))}
                </GroupedList>
            )}
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
                    {isLive ? (
                        <Button size="lg" color="primary" onClick={() => dispatch({ type: "GO", screen: "3.1" })}>
                            OK
                        </Button>
                    ) : (
                        <Button size="lg" color="primary" onClick={() => dispatch({ type: "GO", screen: "3.1", patch: { frozen: false } })}>
                            Get a new card number
                        </Button>
                    )}
                    <Button size="lg" color="tertiary" onClick={() => dispatch({ type: "GO", screen: "3.1" })}>
                        Later
                    </Button>
                </>
            }
        >
            <div className="px-8">
                <ShoppingCard variant="frozen" />
            </div>
            <Hero title="Your Agent Card is frozen" body={isLive ? "We won't trust that phone again. Unfreeze with Face ID on the card when you're ready." : undefined} />
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
