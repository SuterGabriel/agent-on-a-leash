import type { ReactNode } from "react";
import { Check, ChevronRight, Lock01, XClose } from "@untitledui/icons";
import { Button as AriaButton } from "react-aria-components";
import type { CheckResult } from "@/types/decision";
import { cx } from "@/utils/cx";

export type RuleRowMode = "review" | "settings" | "result" | "locked";

interface RuleRowProps {
    mode: RuleRowMode;
    label: ReactNode;
    /** Value pill (review / settings), e.g. "CHF 120". */
    value?: string;
    /** The user's own words, shown in quotes. */
    yourWords?: string | null;
    /** Why we suggest this value ("Your biggest online payment was CHF 266"). Grey line, no quotes. */
    evidence?: ReactNode;
    /** Result mode: what we found ("CHF 299.00"). Settings mode: status line ("CHF 255.50 left"). */
    fact?: ReactNode;
    result?: CheckResult;
    onPress?: () => void;
    /** Custom element on the right (e.g. "Remove"). */
    accessory?: ReactNode;
    className?: string;
}

const resultWord: Record<CheckResult, string> = { pass: "Pass", fail: "Fail", unsure: "Not sure" };

/** Monochrome result mark: grey check (pass), grey question (not sure), black filled circle with white x (fail). */
export const ResultMark = ({ result }: { result: CheckResult }) => {
    if (result === "fail") {
        return (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-solid text-white">
                <XClose className="size-4" strokeWidth={2.5} />
            </span>
        );
    }
    return (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-tertiary text-secondary">
            {result === "pass" ? <Check className="size-4" strokeWidth={2.5} /> : <span className="text-sm font-bold">?</span>}
        </span>
    );
};

/** Spending rule row. Modes: review (setup), settings (change rules), result (checks), locked (always on). */
export const RuleRow = ({ mode, label, value, yourWords, evidence, fact, result, onPress, accessory, className }: RuleRowProps) => {
    const lead =
        mode === "result" && result ? (
            <span className="pt-3">
                <ResultMark result={result} />
            </span>
        ) : mode === "locked" ? (
            <span className="pt-3.5 text-fg-quaternary">
                <Lock01 className="size-5" />
            </span>
        ) : null;

    const content = (
        <>
            {lead}
            <div className="flex min-w-0 flex-1 items-start gap-3 border-b border-secondary py-3 pr-4 group-last/row:border-b-0">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={cx("text-lg text-primary", mode === "locked" ? "font-normal" : "font-semibold")}>{label}</span>
                    {yourWords && <span className="text-sm text-secondary">&ldquo;{yourWords}&rdquo;</span>}
                    {evidence && <span className="text-sm text-tertiary">{evidence}</span>}
                    {mode === "result" && result && fact && (
                        <span className="text-sm font-medium text-primary">
                            {resultWord[result]} · {fact}
                        </span>
                    )}
                    {mode === "settings" && fact && <span className="text-sm font-medium text-secondary">{fact}</span>}
                </div>
                {value && (
                    <span className="mt-0.5 inline-flex h-7 shrink-0 items-center rounded-full bg-tertiary px-3 text-md font-semibold text-primary tabular-nums">{value}</span>
                )}
                {accessory}
                {onPress && <ChevronRight aria-hidden className="mt-1 -mr-1 size-5 shrink-0 text-fg-quaternary" />}
            </div>
        </>
    );

    const root = "group/row flex w-full items-start gap-3 pl-4 text-left";

    if (onPress) {
        return (
            <AriaButton
                onPress={onPress}
                className={cx(root, "cursor-pointer outline-focus-ring pressed:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2", className)}
            >
                {content}
            </AriaButton>
        );
    }
    return <div className={cx(root, className)}>{content}</div>;
};
