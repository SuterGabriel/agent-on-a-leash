import { SegmentedControl } from "@/features/shopping-card/segmented-control";

interface SettingRowProps {
    title: string;
    /** Why this default ("Only 4 of your 23 purchases were at night"). */
    evidence?: string;
    options: { id: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
}

/** Smart setting: title, evidence line, segmented control. Used on 1.4 Smart settings and 6.1 Rules. */
export const SettingRow = ({ title, evidence, options, value, onChange }: SettingRowProps) => (
    <div className="group/row flex flex-col gap-3 pl-4">
        <div className="flex flex-col gap-3 border-b border-secondary py-3 pr-4 group-last/row:border-b-0">
            <div className="flex flex-col gap-0.5">
                <span className="text-lg font-semibold text-primary">{title}</span>
                {evidence && <span className="text-sm text-tertiary">{evidence}</span>}
            </div>
            <SegmentedControl ariaLabel={title} items={options} value={value} onChange={onChange} />
        </div>
    </div>
);
