import type { Key } from "react-aria-components";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { cx } from "@/utils/cx";

interface ChipGroupProps {
    items: { id: string; label: string }[];
    /** Selected ids. */
    value: string[];
    onChange: (value: string[]) => void;
    selectionMode?: "single" | "multiple";
    /** Keep one chip selected (single choice). */
    disallowEmptySelection?: boolean;
    ariaLabel: string;
    className?: string;
}

/** Grey pill chips, 32 high, Text md/Medium. Selected = black pill, white text. */
export const ChipGroup = ({ items, value, onChange, selectionMode = "single", disallowEmptySelection, ariaLabel, className }: ChipGroupProps) => (
    <ToggleButtonGroup
        aria-label={ariaLabel}
        selectionMode={selectionMode}
        disallowEmptySelection={disallowEmptySelection}
        selectedKeys={value}
        onSelectionChange={(keys: Set<Key>) => onChange([...keys].map(String))}
        className={cx("flex flex-wrap gap-2", className)}
    >
        {items.map((item) => (
            <ToggleButton
                key={item.id}
                id={item.id}
                className={({ isSelected }) =>
                    cx(
                        "flex h-8 cursor-pointer items-center rounded-full px-3.5 text-md font-medium outline-focus-ring transition duration-100 ease-linear focus-visible:outline-2 focus-visible:outline-offset-2",
                        isSelected ? "bg-brand-solid text-white" : "bg-tertiary text-primary pressed:bg-quaternary",
                    )
                }
            >
                {item.label}
            </ToggleButton>
        ))}
    </ToggleButtonGroup>
);
