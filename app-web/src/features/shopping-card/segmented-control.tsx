import type { Key } from "react-aria-components";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { cx } from "@/utils/cx";

interface SegmentedControlProps {
    ariaLabel: string;
    items: { id: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

/** iOS segmented control: grey track, white selected segment (flat, no shadow). */
export const SegmentedControl = ({ ariaLabel, items, value, onChange, className }: SegmentedControlProps) => (
    <ToggleButtonGroup
        aria-label={ariaLabel}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[value]}
        onSelectionChange={(keys: Set<Key>) => {
            const next = [...keys][0];
            if (next !== undefined) onChange(String(next));
        }}
        className={cx("flex rounded-full bg-tertiary p-0.5", className)}
    >
        {items.map((item) => (
            <ToggleButton
                key={item.id}
                id={item.id}
                className={({ isSelected }) =>
                    cx(
                        "h-8 flex-1 cursor-pointer rounded-full text-md font-semibold outline-focus-ring transition duration-100 ease-linear focus-visible:outline-2",
                        isSelected ? "bg-primary text-primary" : "text-secondary",
                    )
                }
            >
                {item.label}
            </ToggleButton>
        ))}
    </ToggleButtonGroup>
);
