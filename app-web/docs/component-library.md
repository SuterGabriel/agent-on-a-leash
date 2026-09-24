# Using the Agent Card component library

For anyone on the team who needs another screen, a judge view, or a quick internal page that looks like the app. Everything below is already in `app/web` and matches the Figma library. Rules from `CLAUDE.md` still apply: semantic classes only, no hex, no ad-hoc styles, reuse before building.

## Start a new screen in 5 lines

```tsx
import { Screen, StepTitle } from "@/features/shopping-card/screens/screen";
import { GroupedList } from "@/components/shopping-card/grouped-list";
import { ListRow } from "@/components/shopping-card/list-row";

export const MyScreen = () => (
    <Screen nav={<NavBar variant="inline" title="Title" onBack={...} />} footer={<Button size="lg" color="primary">Continue</Button>}>
        <StepTitle body="One sentence under the title.">Screen title</StepTitle>
        <GroupedList title="Section">
            <ListRow title="Row" subtitle="Grey line" value="CHF 12.00" trailing="chevron" onPress={...} />
        </GroupedList>
    </Screen>
);
```

Register it in `src/features/shopping-card/screens/index.tsx` (screen id → component) and add the id to `ScreenId` and `frames` in `prototype-state.tsx`. It then appears in "Jump to screen" and as `/prototype?screen=<id>`.

## Building blocks

| Component | Import | Use for | Key props |
|---|---|---|---|
| `Screen` | `features/shopping-card/screens/screen` | One phone frame: status bar, nav, scroll area, pinned footer | `nav`, `footer`, `floating`, `centered` |
| `Hero`, `StepTitle`, `InfoCard` | same | Big title block, setup title, white text card | |
| `NavBar` | `components/chrome/nav-bar` | Large title or inline (back chevron + centred title) | `variant="inline"`, `title`, `backLabel`, `onBack`, `leading` |
| `TabBar` | `components/chrome/tab-bar` | Floating Viseca one tab bar | `active="card"` |
| `GroupedList` | `components/shopping-card/grouped-list` | iOS inset grouped card with header and footer text | `title`, `footer`, `surface="secondary"` inside sheets |
| `ListRow` | `components/shopping-card/list-row` | Any row: icon or leading, title, subtitle, value, pill, toggle, chevron, check | `trailing`, `value`, `valueStruck`, `pill`, `accessory`, `toggle`, `plainTitle` |
| `RuleRow` | `features/shopping-card/rule-row` | **The one rule row.** `review` (setup, value pill + evidence), `settings` (tap to tighten), `result` (pass/fail/unsure + fact), `locked` (always on) | `mode`, `label`, `value`, `evidence`, `yourWords`, `fact`, `result`, `onPress` |
| `SettingRow` | `features/shopping-card/setting-row` | Smart setting: title, evidence, segmented control | `options`, `value`, `onChange` |
| `SegmentedControl` | `features/shopping-card/segmented-control` | Two or three choices | |
| `BudgetMeter` | `features/shopping-card/budget-meter` | "CHF 1'211 left of CHF 1'500", black bar shows spent | `total`, `spent`, `caption` |
| `StatusPill` | `components/shopping-card/status-pill` | approved · declined · waiting (black) · active · paused · off · you-declined · times-up | `status` |
| `BottomSheet` | `components/shopping-card/bottom-sheet` | iOS sheet with grabber, title, two equal buttons | `isOpen`, `title`, `description`, `actions` |
| `PushBanner` | `components/shopping-card/push-banner` | iOS notification banner | `title`, `body`, `onPress` |
| `CountdownRing` | `features/shopping-card/countdown-ring` | 2:00 ring for asks | `secondsLeft` |
| `ShopTextBox` | `features/shopping-card/shop-text-box` | Untrusted shop text, grey quarantine box | `quote` |
| `ShoppingCard` | `features/shopping-card/shopping-card` | Card artwork: default, frozen (with `badge`), small thumbnail; `card="main"` for the gold card | `variant`, `badge`, `name`, `last4` |
| `QuickAction` | `features/shopping-card/quick-action` | Round icon button with label (Freeze · Rules · Details) | `icon`, `label` |
| `ChipGroup` | `components/shopping-card/chip` | Grey pill chips, black when selected | |
| `OptionCardGroup` | `features/shopping-card/option-card` | Single choice as cards or rows | `layout`, `surface` |
| `FaceIdGlyph`, `FaceIdOverlay` | `features/shopping-card/face-id` | Button glyph and the fake scan overlay | dispatch `FACE_ID` with a `then` action |
| `Button` | `components/base/buttons/button` | Untitled UI button, pill. `primary` black, `secondary` grey, `tertiary` text, `*-destructive` red text | `size="lg"` for screen actions |

Icons: `@untitledui/icons` (`ShoppingBag02`, `Sliders02`, `Snowflake01`, `Lock01`, `Moon01`, `Phone01` ...). Pass the component, not JSX, to `ListRow icon`.

## Tokens you will use (Tailwind class → meaning)

`bg-secondary` screen · `bg-primary` card · `bg-tertiary` grey pill / track · `bg-brand-solid` black pill and bar · `text-primary` / `text-secondary` / `text-tertiary` · `text-fg-quaternary` chevrons · `text-error-primary` destructive text · `bg-utility-brand-500` **only** the orange agent dot · `rounded-2xl` cards · `px-4` screen margin · `gap-6` between groups. Type: `text-display-sm font-bold` large title · `text-lg font-semibold` row title · `text-md` body · `text-sm text-tertiary` meta · `tabular-nums` on every amount.

Full table: `04_design/prototype-spec.md` §1 and `design-system/tokens/TOKENS.md`.

## State and data

- `usePrototype()` gives `{ state, dispatch, secondsLeft }`. All navigation is `dispatch({ type: "GO", screen })`, sheets are `dispatch({ type: "SHEET", sheet })`.
- A new decision, from anywhere: `dispatch({ type: "INGEST", decision })`. That's what the live stream and the demo buttons do.
- Copy and evidence live in `features/shopping-card/demo-data.ts`. Change words there, not in the screens.
- Money: `formatChf(44.5)` → "CHF 44.50"; `formatChf(1500, { cents: false })` → "CHF 1'500". Time: `formatClock(114)` → "1:54".

## Rules of the house (short)

1. One primary action per screen. Approve and Decline same size; only Approve gets the Face ID glyph.
2. Status is a grey pill with black text. Black pill only for "Waiting for you". No green, red, yellow.
3. Orange only on the agent dot. Never on a button or bar.
4. Every number a customer sees has a "because" line next to it.
5. No agent brand names inside the phone. "Your agent".
6. Don't invent a component. Ask Kim, she adds it to Figma and here in the same step.
