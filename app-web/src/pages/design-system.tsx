import type { ReactNode } from "react";
import { ArrowRight, Moon01, Plus, SearchLg, Sun } from "@untitledui/icons";
import { Tabs } from "@/components/application/tabs/tabs";
import { Avatar } from "@/components/base/avatar/avatar";
import { AvatarLabelGroup } from "@/components/base/avatar/avatar-label-group";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { Toggle } from "@/components/base/toggle/toggle";
import { useTheme } from "@/providers/theme-provider";

/**
 * Living style guide: every token and core component as it renders *in code*.
 * Compare side by side with the Figma file after each /sync-tokens or /restyle.
 * Swatches read CSS variables directly, so they always show the current generated values.
 */

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const BG = [
    "bg-primary",
    "bg-primary_hover",
    "bg-secondary",
    "bg-tertiary",
    "bg-quaternary",
    "bg-primary-solid",
    "bg-brand-primary",
    "bg-brand-secondary",
    "bg-brand-solid",
    "bg-brand-section",
    "bg-error-solid",
    "bg-warning-solid",
    "bg-success-solid",
];
const TEXT = [
    "text-primary",
    "text-secondary",
    "text-tertiary",
    "text-quaternary",
    "text-placeholder",
    "text-brand-primary",
    "text-brand-secondary",
    "text-brand-tertiary",
    "text-error-primary",
    "text-warning-primary",
    "text-success-primary",
];
const BORDER = ["border-primary", "border-secondary", "border-tertiary", "border-brand", "border-error"];
const FG = ["fg-primary", "fg-secondary", "fg-tertiary", "fg-quaternary", "fg-brand-primary", "fg-brand-secondary", "fg-error-primary", "fg-success-primary"];

// Figma radius name → Tailwind class (see design-system/tokens/TOKENS.md). Literal class strings so Tailwind generates them.
const RADII: [string, string, string][] = [
    ["radius-xxs", "rounded-xs", "rounded-xs"],
    ["radius-xs", "rounded-sm", "rounded-sm"],
    ["radius-sm", "rounded-md", "rounded-md"],
    ["radius-md", "rounded-lg", "rounded-lg"],
    ["radius-xl", "rounded-xl", "rounded-xl"],
    ["radius-2xl", "rounded-2xl", "rounded-2xl"],
    ["radius-4xl", "rounded-3xl", "rounded-3xl"],
    ["radius-full", "rounded-full", "rounded-full"],
];

const TYPE: [string, string][] = [
    ["Display lg / Semibold", "text-display-lg font-semibold"],
    ["Display md / Semibold", "text-display-md font-semibold"],
    ["Display sm / Semibold", "text-display-sm font-semibold"],
    ["Display xs / Semibold", "text-display-xs font-semibold"],
    ["Text xl / Semibold", "text-xl font-semibold"],
    ["Text lg / Medium", "text-lg font-medium"],
    ["Text md / Regular", "text-md"],
    ["Text sm / Regular", "text-sm"],
    ["Text xs / Medium", "text-xs font-medium"],
];

const agents = [
    { id: "scout", label: "Scout", supportingText: "Research agent" },
    { id: "clerk", label: "Clerk", supportingText: "Payments agent" },
    { id: "guard", label: "Guard", supportingText: "Policy checker" },
];

const Section = ({ title, figma, children }: { title: string; figma: string; children: ReactNode }) => (
    <section className="flex flex-col gap-4 border-t border-secondary pt-8">
        <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold text-primary">{title}</h2>
            <span className="text-xs text-quaternary">Figma: {figma}</span>
        </div>
        {children}
    </section>
);

const Swatch = ({ cssVar, label, text }: { cssVar: string; label: string; text?: boolean }) => (
    <div className="flex flex-col gap-1.5">
        <div
            className="flex h-12 items-center justify-center rounded-lg ring-1 ring-secondary ring-inset"
            style={text ? { color: `var(--color-${cssVar})` } : { background: `var(--color-${cssVar})` }}
        >
            {text && <span className="text-md font-semibold">Aa</span>}
        </div>
        <code className="truncate text-xs text-tertiary">{label}</code>
    </div>
);

export const DesignSystemPage = () => {
    const { theme, setTheme } = useTheme();
    const isDark = theme === "dark";

    return (
        <main className="min-h-dvh bg-primary">
            <div className="mx-auto flex max-w-container flex-col gap-10 px-4 py-10 md:px-8">
                <header className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex flex-col gap-1">
                        <h1 className="text-display-xs font-semibold text-primary">Design system</h1>
                        <p className="text-md text-tertiary">Tokens and components as rendered in code. Source: Figma variables → /sync-tokens.</p>
                    </div>
                    <ButtonUtility
                        color="secondary"
                        size="sm"
                        tooltip={isDark ? "Light mode" : "Dark mode"}
                        icon={isDark ? Sun : Moon01}
                        onClick={() => setTheme(isDark ? "light" : "dark")}
                    />
                </header>

                <Section title="Brand" figma="_Primitives → Colors/Brand/*">
                    <div className="grid grid-cols-6 gap-3 md:grid-cols-11">
                        {STEPS.map((s) => (
                            <Swatch key={s} cssVar={`brand-${s}`} label={String(s)} />
                        ))}
                    </div>
                </Section>

                <Section title="Neutral" figma="_Primitives → Colors/Neutral/*">
                    <div className="grid grid-cols-6 gap-3 md:grid-cols-11">
                        {STEPS.map((s) => (
                            <Swatch key={s} cssVar={`neutral-${s}`} label={String(s)} />
                        ))}
                    </div>
                </Section>

                <Section title="Backgrounds" figma="1. Color modes → Colors/Background">
                    <div className="grid grid-cols-3 gap-3 md:grid-cols-7">
                        {BG.map((n) => (
                            <Swatch key={n} cssVar={n} label={n} />
                        ))}
                    </div>
                </Section>

                <Section title="Text & foreground" figma="Colors/Text · Colors/Foreground">
                    <div className="grid grid-cols-3 gap-3 md:grid-cols-7">
                        {TEXT.map((n) => (
                            <Swatch key={n} cssVar={n} label={n} text />
                        ))}
                        {FG.map((n) => (
                            <Swatch key={n} cssVar={n} label={`text-${n}`} text />
                        ))}
                    </div>
                </Section>

                <Section title="Borders" figma="Colors/Border">
                    <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
                        {BORDER.map((n) => (
                            <div key={n} className="flex flex-col gap-1.5">
                                <div className="h-12 rounded-lg border-2" style={{ borderColor: `var(--color-${n})` }} />
                                <code className="text-xs text-tertiary">{n}</code>
                            </div>
                        ))}
                    </div>
                </Section>

                <Section title="Radius" figma="2. Radius (names differ from Tailwind!)">
                    <div className="grid grid-cols-4 gap-4 md:grid-cols-8">
                        {RADII.map(([figma, tw, cls]) => (
                            <div key={figma} className="flex flex-col gap-1.5">
                                <div className={`size-16 border border-brand bg-brand-primary ${cls}`} />
                                <code className="text-xs text-secondary">{figma}</code>
                                <code className="text-xs text-quaternary">{tw}</code>
                            </div>
                        ))}
                    </div>
                </Section>

                <Section title="Typography" figma="6. Typography · text styles">
                    <div className="flex flex-col gap-3">
                        {TYPE.map(([label, cls]) => (
                            <div key={label} className="flex items-baseline gap-6">
                                <code className="w-44 shrink-0 text-xs text-quaternary">{label}</code>
                                <span className={`truncate text-primary ${cls}`}>Agent on a leash</span>
                            </div>
                        ))}
                    </div>
                </Section>

                <Section title="Buttons" figma="Buttons/Button (3287:427074)">
                    <div className="flex flex-wrap items-center gap-3">
                        <Button color="primary" iconLeading={Plus}>
                            Primary
                        </Button>
                        <Button color="secondary">Secondary</Button>
                        <Button color="tertiary">Tertiary</Button>
                        <Button color="link-color" iconTrailing={ArrowRight}>
                            Link color
                        </Button>
                        <Button color="link-gray">Link gray</Button>
                        <Button color="primary-destructive">Destructive</Button>
                        <Button isLoading showTextWhileLoading>
                            Loading
                        </Button>
                        <Button isDisabled>Disabled</Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        {(["xs", "sm", "md", "lg", "xl"] as const).map((s) => (
                            <Button key={s} size={s}>
                                Size {s}
                            </Button>
                        ))}
                    </div>
                </Section>

                <Section title="Badges & avatars" figma="Badge (1046:3819) · Avatar (11008:45389)">
                    <div className="flex flex-wrap items-center gap-2">
                        <BadgeWithDot type="pill-color" color="success" size="md">
                            Running
                        </BadgeWithDot>
                        <BadgeWithDot type="pill-color" color="warning" size="md">
                            Needs approval
                        </BadgeWithDot>
                        <BadgeWithDot type="pill-color" color="error" size="md">
                            Blocked
                        </BadgeWithDot>
                        <Badge type="color" color="brand" size="md">
                            Brand
                        </Badge>
                        <Badge type="modern" color="gray" size="md">
                            Modern
                        </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-6">
                        <Avatar initials="KB" size="md" status="online" />
                        <AvatarLabelGroup size="md" initials="KB" title="Kim B." subtitle="Designer" />
                    </div>
                </Section>

                <Section title="Form controls" figma="Input field · Select · Checkbox · Toggle">
                    <div className="grid gap-6 md:grid-cols-2">
                        <Input label="Search agents" placeholder="Search…" icon={SearchLg} hint="Figma: Input field / Size=md / Icon leading" />
                        <Select label="Agent" placeholder="Choose an agent" items={agents}>
                            {(item) => (
                                <Select.Item id={item.id} supportingText={item.supportingText}>
                                    {item.label}
                                </Select.Item>
                            )}
                        </Select>
                        <Checkbox label="Require human approval" hint="Above CHF 100 per transaction" defaultSelected />
                        <Toggle label="Agent enabled" hint="Pauses all actions when off" defaultSelected />
                    </div>
                </Section>

                <Section title="Tabs" figma="Horizontal tabs (1118:69893)">
                    <Tabs>
                        <Tabs.List
                            type="underline"
                            items={[
                                { id: "activity", label: "Activity" },
                                { id: "limits", label: "Limits" },
                                { id: "audit", label: "Audit log", badge: 3 },
                            ]}
                        />
                    </Tabs>
                    <Tabs>
                        <Tabs.List
                            type="button-brand"
                            items={[
                                { id: "activity", label: "Activity" },
                                { id: "limits", label: "Limits" },
                                { id: "audit", label: "Audit log" },
                            ]}
                        />
                    </Tabs>
                </Section>
            </div>
        </main>
    );
};
