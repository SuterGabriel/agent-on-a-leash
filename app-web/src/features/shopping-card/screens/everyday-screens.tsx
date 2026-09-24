import { File06, InfoCircle, ShoppingBag02, Sliders02, Snowflake01 } from "@untitledui/icons";
import { NavBar } from "@/components/chrome/nav-bar";
import { GroupedList } from "@/components/shopping-card/grouped-list";
import { ListRow } from "@/components/shopping-card/list-row";
import { StatusPill } from "@/components/shopping-card/status-pill";
import { BudgetMeter } from "@/features/shopping-card/budget-meter";
import type { ActivityItem } from "@/features/shopping-card/demo-data";
import { customer, getDecision, task } from "@/features/shopping-card/demo-data";
import { formatChf, formatClock } from "@/features/shopping-card/format";
import { usePrototype } from "@/features/shopping-card/prototype-state";
import { QuickAction } from "@/features/shopping-card/quick-action";
import { InfoCard, Screen } from "@/features/shopping-card/screens/screen";
import { ShoppingCard } from "@/features/shopping-card/shopping-card";

const struck = (status: ActivityItem["status"]) => status === "declined" || status === "you-declined" || status === "times-up";

/** Activity row = Grouped list row, Trailing = Value. */
export const ActivityRow = ({ item, onPress }: { item: ActivityItem; onPress?: () => void }) => (
    <ListRow
        icon={ShoppingBag02}
        title={item.shop}
        subtitle={`${item.subtitle} · ${item.time}`}
        value={formatChf(item.amount)}
        valueStruck={struck(item.status)}
        trailing={onPress ? "chevron" : "none"}
        onPress={onPress}
    />
);

export const monthCaption = (spent: number) => (spent > 0 ? `Rolling 30 days · ${formatChf(spent)} frees up 11 Sep` : "Rolling 30 days");

/** 3.1 Agent Card home (3.1b no payments yet, 3.1c offline are states of this screen). */
export const HomeScreen = () => {
    const { state, dispatch, secondsLeft } = usePrototype();
    const waiting = state.waiting ? getDecision(state.waiting.decisionId) : null;

    return (
        <Screen nav={<NavBar variant="inline" backLabel="Card" title={customer.cardName} onBack={() => dispatch({ type: "GO", screen: "1.1" })} />}>
            {state.offline && <InfoCard icon={<InfoCircle className="size-5" />}>Payments paused. Nothing will be bought until we're back.</InfoCard>}

            <div className="flex flex-col gap-5">
                <div className="px-6">
                    <ShoppingCard variant={state.frozen ? "frozen" : "default"} />
                </div>
                <div className="flex justify-center gap-6">
                    <QuickAction
                        icon={Snowflake01}
                        label={state.frozen ? "Unfreeze" : "Freeze"}
                        onPress={() => (state.frozen ? dispatch({ type: "PATCH", patch: { frozen: false } }) : dispatch({ type: "SHEET", sheet: "freeze" }))}
                    />
                    <QuickAction icon={Sliders02} label="Rules" onPress={() => dispatch({ type: "GO", screen: "6.1" })} />
                    <QuickAction icon={File06} label="Details" onPress={() => dispatch({ type: "GO", screen: "6.3" })} />
                </div>
            </div>

            <BudgetMeter label="This month" total={state.rules.monthBudget} spent={state.monthSpent} caption={monthCaption(state.monthSpent)} />

            {waiting && (
                <GroupedList title="Waiting for you">
                    <ListRow
                        icon={ShoppingBag02}
                        title={waiting.merchant.name}
                        subtitle={
                            <span className="flex flex-col items-start gap-1.5">
                                <span className="tabular-nums">{waiting.items[0]?.name} · {formatClock(secondsLeft)} left</span>
                                <StatusPill status="waiting" />
                            </span>
                        }
                        value={formatChf(waiting.amount.chf)}
                        trailing="chevron"
                        onPress={() => dispatch({ type: "SHEET", sheet: "question" })}
                    />
                </GroupedList>
            )}

            {state.taskActive && (
                <GroupedList title="What your agent was asked to buy" footer={`${task.rules.length} rules from this task are checked on every payment, next to your card rules.`}>
                    <ListRow title={<span className="font-normal">&ldquo;{task.instruction}&rdquo;</span>} trailing="chevron" onPress={() => dispatch({ type: "GO", screen: "6.1" })} />
                </GroupedList>
            )}

            <GroupedList title="Activity">
                {state.activity.length === 0 ? (
                    <p className="p-4 text-center text-md text-secondary">No payments yet. When your agent pays, you'll see it here.</p>
                ) : (
                    state.activity.map((item) => (
                        <ActivityRow key={item.rowId} item={item} onPress={() => dispatch({ type: "GO", screen: "5.2", patch: { paymentId: item.decisionId } })} />
                    ))
                )}
            </GroupedList>
        </Screen>
    );
};
