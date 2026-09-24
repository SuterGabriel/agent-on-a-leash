import type { ReactNode } from "react";
import { Check } from "@untitledui/icons";
import { Radio, RadioGroup } from "react-aria-components";
import { cx } from "@/utils/cx";

interface OptionCardGroupProps {
    ariaLabel: string;
    value: string;
    onChange: (value: string) => void;
    options: { id: string; title: ReactNode; description?: ReactNode; leading?: ReactNode }[];
    /** `stack` = one white card per option · `list` = rows inside one white card */
    layout?: "stack" | "list";
    /** White cards on the grey screen (default) or grey inside a white sheet. */
    surface?: "primary" | "secondary";
    className?: string;
}

const Mark = ({ selected }: { selected: boolean }) => (
    <span
        aria-hidden
        className={cx(
            "flex size-6 shrink-0 items-center justify-center rounded-full",
            selected ? "bg-brand-solid text-white" : "border-2 border-fg-quaternary",
        )}
    >
        {selected && <Check className="size-4" strokeWidth={2.5} />}
    </span>
);

/** Single choice as white option cards with a round check on the right. */
export const OptionCardGroup = ({ ariaLabel, value, onChange, options, layout = "stack", surface = "primary", className }: OptionCardGroupProps) => (
    <RadioGroup
        aria-label={ariaLabel}
        value={value}
        onChange={onChange}
        className={cx("flex flex-col", layout === "stack" ? "gap-3" : cx("overflow-hidden rounded-2xl", surface === "primary" ? "bg-primary" : "bg-secondary"), className)}
    >
        {options.map((option) => (
            <Radio
                key={option.id}
                value={option.id}
                className={cx(
                    "group/row flex cursor-pointer items-center gap-3 outline-focus-ring focus-visible:outline-2 focus-visible:-outline-offset-2",
                    layout === "stack" ? cx("rounded-2xl p-4", surface === "primary" ? "bg-primary" : "bg-secondary") : "pl-4",
                )}
            >
                {({ isSelected }) => (
                    <>
                        {option.leading}
                        <span
                            className={cx(
                                "flex min-w-0 flex-1 items-center gap-3",
                                layout === "list" && "min-h-14 border-b border-secondary py-3 pr-4 group-last/row:border-b-0",
                            )}
                        >
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="text-lg font-semibold text-primary">{option.title}</span>
                                {option.description && <span className="text-sm text-secondary">{option.description}</span>}
                            </span>
                            <Mark selected={isSelected} />
                        </span>
                    </>
                )}
            </Radio>
        ))}
    </RadioGroup>
);
