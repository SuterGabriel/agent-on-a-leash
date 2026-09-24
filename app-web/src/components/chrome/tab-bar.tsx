import type { FC } from "react";
import { BarChart10, CreditCard02, Home03, Receipt, Stars02 } from "@untitledui/icons";
import { Button as AriaButton } from "react-aria-components";
import { cx } from "@/utils/cx";

export type TabBarItem = "cockpit" | "analytics" | "surprize" | "bills" | "card";

const items: { id: TabBarItem; label: string; icon: FC<{ className?: string }> }[] = [
    { id: "cockpit", label: "Cockpit", icon: Home03 },
    { id: "analytics", label: "Analytics", icon: BarChart10 },
    { id: "surprize", label: "12'720", icon: Stars02 },
    { id: "bills", label: "Bills", icon: Receipt },
    { id: "card", label: "Card", icon: CreditCard02 },
];

interface TabBarProps {
    active: TabBarItem;
    onChange?: (item: TabBarItem) => void;
    className?: string;
}

/** Floating 346 × 64 pill tab bar. Active item sits in a grey pill. */
export const TabBar = ({ active, onChange, className }: TabBarProps) => (
    <nav aria-label="Main" className={cx("mx-auto flex h-16 w-86.5 items-center justify-between rounded-full bg-primary px-1.5", className)}>
        {items.map(({ id, label, icon: Icon }) => {
            const isActive = id === active;
            return (
                <AriaButton
                    key={id}
                    onPress={() => onChange?.(id)}
                    aria-current={isActive ? "page" : undefined}
                    className={cx(
                        "flex h-13 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-full text-primary outline-focus-ring focus-visible:outline-2",
                        isActive && "bg-tertiary",
                    )}
                >
                    <Icon className="size-5" />
                    <span className="text-xs font-medium">{label}</span>
                </AriaButton>
            );
        })}
    </nav>
);
