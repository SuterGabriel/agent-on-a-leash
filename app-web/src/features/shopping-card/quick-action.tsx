import type { FC } from "react";
import { Button as AriaButton } from "react-aria-components";
import { cx } from "@/utils/cx";

interface QuickActionProps {
    icon: FC<{ className?: string }>;
    label: string;
    onPress?: () => void;
    className?: string;
}

/** 48 white circle + 24 icon, 13 label below. */
export const QuickAction = ({ icon: Icon, label, onPress, className }: QuickActionProps) => (
    <AriaButton
        onPress={onPress}
        className={cx("group flex w-18 cursor-pointer flex-col items-center gap-1.5 rounded-xl outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2", className)}
    >
        <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary transition duration-100 ease-linear group-pressed:bg-tertiary">
            <Icon className="size-6" />
        </span>
        <span className="text-sm text-primary">{label}</span>
    </AriaButton>
);
