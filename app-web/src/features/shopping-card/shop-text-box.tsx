import { AlertTriangle } from "@untitledui/icons";
import { cx } from "@/utils/cx";

interface ShopTextBoxProps {
    quote: string;
    note?: string;
    /** Grey box inside a white card/sheet (default) or white box on the grey screen. */
    surface?: "secondary" | "primary";
    className?: string;
}

/** Untrusted text from the shop page, quarantined in a grey box. */
export const ShopTextBox = ({ quote, note = "We ignored this.", surface = "secondary", className }: ShopTextBoxProps) => (
    <figure className={cx("flex flex-col gap-1.5 rounded-2xl p-4", surface === "secondary" ? "bg-secondary" : "bg-primary", className)}>
        <figcaption className="flex items-center gap-1.5 text-sm font-medium text-secondary">
            <AlertTriangle aria-hidden className="size-4" />
            From the shop page · not trusted
        </figcaption>
        <blockquote className="text-md text-primary">&ldquo;{quote}&rdquo;</blockquote>
        <p className="text-sm text-tertiary">{note}</p>
    </figure>
);
