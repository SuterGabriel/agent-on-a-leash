import { useState } from "react";
import { Bell01, Copy01, CreditCard02, Lock01, Passcode, Power01, RefreshCw01, Shield01, Sliders02, Wallet02, XClose } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { NavBar, NavBarButton } from "@/components/chrome/nav-bar";
import { TabBar } from "@/components/chrome/tab-bar";
import { GroupedList } from "@/components/shopping-card/grouped-list";
import { ListRow } from "@/components/shopping-card/list-row";
import { customer } from "@/features/shopping-card/demo-data";
import { usePrototype } from "@/features/shopping-card/prototype-state";
import { QuickAction } from "@/features/shopping-card/quick-action";
import { Hero, Screen } from "@/features/shopping-card/screens/screen";
import { ShoppingCard } from "@/features/shopping-card/shopping-card";

/** 1.1 Card tab · banner (entry point inside Viseca one) */
export const CardTabScreen = () => {
    const { state, dispatch } = usePrototype();
    return (
        <Screen nav={<NavBar title="Card" />} floating={<TabBar active="card" />}>
            <ShoppingCard card="main" />
            <div className="flex justify-around">
                <QuickAction icon={Lock01} label="Lock" />
                <QuickAction icon={Passcode} label="PIN" />
                <QuickAction icon={RefreshCw01} label="Replace" />
            </div>

            {state.cardCreated ? (
                <GroupedList title="Agent Card">
                    <ListRow
                        leading={
                            <span className="flex size-10 items-center justify-center">
                                <ShoppingCard variant="small" />
                            </span>
                        }
                        title={customer.cardName}
                        subtitle={`•• ${customer.cardLast4} · for your shopping agent`}
                        pill={state.frozen ? "paused" : "active"}
                        trailing="chevron"
                        onPress={() => dispatch({ type: "GO", screen: "3.1" })}
                    />
                </GroupedList>
            ) : (
                <div className="flex flex-col items-start gap-3 rounded-2xl bg-primary p-4">
                    <div className="flex flex-col gap-1">
                        <span className="flex items-center gap-2 text-lg font-semibold text-primary">
                            <span aria-hidden className="size-2 rounded-full bg-utility-brand-500" />
                            Let an AI agent shop for you, safely
                        </span>
                        <p className="text-md text-secondary">An Agent Card with its own number and your rules. Your main card stays private.</p>
                    </div>
                    <Button size="sm" color="secondary" onClick={() => dispatch({ type: "GO", screen: "1.2" })}>
                        Get started
                    </Button>
                </div>
            )}

            <GroupedList title="Card settings">
                <ListRow icon={Bell01} title="Push notifications" trailing="chevron" />
                <ListRow icon={Shield01} title="Security" trailing="chevron" />
                <ListRow icon={Wallet02} title="Apple Pay" trailing="chevron" />
            </GroupedList>
        </Screen>
    );
};

const howItWorks = [
    { icon: CreditCard02, title: "Your agent gets its own card", body: "A separate number, linked to your card. Your real card number is never shared." },
    { icon: Sliders02, title: "Your rules travel with it", body: "Limits, shops and when to ask you. Set from how you already shop, in under a minute." },
    { icon: Power01, title: "You stay in control", body: "Every payment is checked and explained. Tighten or switch off in one tap." },
];

/** 1.2 How it works (one screen, three rows) */
export const HowItWorksScreen = () => {
    const { dispatch } = usePrototype();
    return (
        <Screen
            nav={<NavBar variant="inline" leading={<NavBarButton icon={XClose} label="Close" className="ml-2" onPress={() => dispatch({ type: "BACK", fallback: "1.1" })} />} />}
            footer={
                <Button size="lg" color="primary" onClick={() => dispatch({ type: "GO", screen: "1.3" })}>
                    Continue
                </Button>
            }
        >
            <div className="px-8 pt-2">
                <ShoppingCard />
            </div>
            <Hero title="An Agent Card" body="For the AI shopping agent you already use. It carries your rules, not your money." />
            <GroupedList>
                {howItWorks.map((row) => (
                    <ListRow key={row.title} icon={row.icon} title={row.title} subtitle={row.body} />
                ))}
            </GroupedList>
        </Screen>
    );
};

/** 1.5 Your Agent Card is ready (the token, shown as a card the customer can hand over) */
export const CardReadyScreen = () => {
    const { dispatch } = usePrototype();
    const [shown, setShown] = useState(false);
    const [copied, setCopied] = useState(false);

    return (
        <Screen
            footer={
                <Button size="lg" color="primary" onClick={() => dispatch({ type: "GO", screen: "3.1" })}>
                    Done
                </Button>
            }
        >
            <div className="px-8 pt-2">
                <ShoppingCard />
            </div>
            <Hero
                title="Your Agent Card is ready"
                body={`Its own number, linked to your card •• ${customer.mainLast4}. Every payment with it is checked against your rules first.`}
            />
            <GroupedList title="Give this card to your agent" footer="Paste the details into your shopping agent's payment settings. Your main card number is never shared.">
                <ListRow
                    plainTitle
                    title="Card number"
                    value={<span className="tabular-nums">{shown ? "5310 0042 8871 7310" : `•••• •••• •••• ${customer.cardLast4}`}</span>}
                    accessory={
                        <Button size="sm" color="secondary" onClick={() => setShown(!shown)}>
                            {shown ? "Hide" : "Show"}
                        </Button>
                    }
                />
                <ListRow plainTitle title="Expiry" value={customer.cardExpiry} />
                <ListRow
                    icon={Copy01}
                    title={copied ? "Copied" : "Copy card details"}
                    subtitle="Number, expiry and security code"
                    trailing="chevron"
                    onPress={() => setCopied(true)}
                />
            </GroupedList>
            <GroupedList>
                <ListRow icon={Wallet02} title="Add to Apple Wallet" subtitle="Optional" trailing="chevron" />
            </GroupedList>
        </Screen>
    );
};
