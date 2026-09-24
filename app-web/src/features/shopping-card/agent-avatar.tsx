import { cx } from "@/utils/cx";

interface AgentAvatarProps {
    name: string;
    size?: "md" | "lg";
    className?: string;
}

/** Agent initial on a grey circle + the orange agent dot (8). */
export const AgentAvatar = ({ name, size = "md", className }: AgentAvatarProps) => (
    <span aria-hidden className={cx("relative flex shrink-0 items-center justify-center rounded-full bg-tertiary font-semibold text-primary", size === "md" ? "size-10 text-lg" : "size-16 text-display-xs", className)}>
        {name.charAt(0)}
        <span className={cx("absolute right-0 bottom-0 rounded-full border-2 border-bg-primary bg-utility-brand-500", size === "md" ? "size-3" : "size-4")} />
    </span>
);
