import { Button } from "@/components/base/buttons/button";
import { NavBar } from "@/components/chrome/nav-bar";
import { GroupedList } from "@/components/shopping-card/grouped-list";
import { analysis, alwaysOn, instructionFromRules, proposedRules, ruleLabel, smartSettings } from "@/features/shopping-card/demo-data";
import { FaceIdGlyph } from "@/features/shopping-card/face-id";
import { usePrototype } from "@/features/shopping-card/prototype-state";
import { RuleRow } from "@/features/shopping-card/rule-row";
import { Screen, StepTitle } from "@/features/shopping-card/screens/screen";
import { SettingRow } from "@/features/shopping-card/setting-row";

const Stat = ({ value, label }: { value: string; label: string }) => (
    <div className="flex flex-col gap-0.5">
        <span className="text-display-xs font-bold text-primary tabular-nums">{value}</span>
        <span className="text-sm text-tertiary">{label}</span>
    </div>
);

/** The analysis card on 1.3: four honest numbers from the last 90 days. */
export const AnalysisCard = () => (
    <div className="grid grid-cols-2 gap-4 rounded-2xl bg-primary p-4">
        <Stat value={String(analysis.purchases)} label={`purchases in ${analysis.windowDays} days`} />
        <Stat value={`CHF ${analysis.typical}`} label="typical payment" />
        <Stat value={`CHF ${analysis.biggest}`} label="biggest payment" />
        <Stat value={`CHF ${analysis.perMonth}`} label="a month, online" />
    </div>
);

/** 1.3 Rules from your shopping (setup without typing; tap a value to change it) */
export const RulesFromShoppingScreen = () => {
    const { state, dispatch } = usePrototype();
    return (
        <Screen
            nav={<NavBar variant="inline" onBack={() => dispatch({ type: "BACK", fallback: "1.2" })} />}
            footer={
                <Button size="lg" color="primary" onClick={() => dispatch({ type: "GO", screen: "1.4" })}>
                    Use these rules
                </Button>
            }
        >
            <StepTitle body={`We looked at your last ${analysis.windowDays} days on this card and propose rules from it. Tap a value to change it.`}>
                Rules from your shopping
            </StepTitle>
            <AnalysisCard />
            <GroupedList title="Proposed rules">
                {proposedRules.map((r) => {
                    const { label, value } = ruleLabel(r.key, state.rules);
                    return (
                        <RuleRow
                            key={r.key}
                            mode="review"
                            label={label}
                            value={value}
                            evidence={r.evidence}
                            onPress={r.editable ? () => dispatch({ type: "EDIT_RULE", key: r.key as "orderLimit" | "monthBudget" }) : undefined}
                        />
                    );
                })}
            </GroupedList>
            <GroupedList title="What we tell the agent" footer="This sentence is stored with the card. Every payment is checked against it and against the rules above.">
                <p className="p-4 text-md text-primary">&ldquo;{instructionFromRules(state.rules, state.smart)}&rdquo;</p>
            </GroupedList>
        </Screen>
    );
};

/** 1.4 Smart settings (more than a budget; all pre-set from history, all with evidence) */
export const SmartSettingsScreen = () => {
    const { state, dispatch } = usePrototype();
    return (
        <Screen
            nav={<NavBar variant="inline" onBack={() => dispatch({ type: "BACK", fallback: "1.3" })} />}
            footer={
                <Button
                    size="lg"
                    color="primary"
                    iconLeading={<FaceIdGlyph className="text-white" />}
                    onClick={() => dispatch({ type: "FACE_ID", then: { type: "CREATE_CARD" } })}
                >
                    Create card with Face ID
                </Button>
            }
        >
            <StepTitle body="Pre-set from your shopping. Making a setting stricter is always one tap. Loosening later needs Face ID.">Smart settings</StepTitle>
            <GroupedList>
                {smartSettings.map((s) => (
                    <SettingRow
                        key={s.key}
                        title={s.title}
                        evidence={s.evidence}
                        options={s.options}
                        value={state.smart[s.key]}
                        onChange={(v) => dispatch({ type: "SET_SMART", key: s.key, value: v })}
                    />
                ))}
            </GroupedList>
            <GroupedList title="Always on" footer="Built into every Agent Card. These can't be switched off.">
                {alwaysOn.map((label) => (
                    <RuleRow key={label} mode="locked" label={label} />
                ))}
            </GroupedList>
        </Screen>
    );
};
