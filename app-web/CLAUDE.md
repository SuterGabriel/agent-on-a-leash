# HackZurich app — Figma ↔ React design system

React 19 + Vite + Tailwind v4 + **Untitled UI React v8**. Design source: Kim's **Untitled UI Figma PRO v8** copy as the *library* (variables + components) and a separate *design file* for screens. Both keys are in `design-system/figma.config.json`. This app lives in `app/web` of the hackathon workspace; the decision engine (`app/engine`) is separate. Both sides use the same Untitled UI naming, and this repo keeps them in sync.

## Sources of truth (read before changing anything visual)

| What | Owned by | Flows to | How |
|---|---|---|---|
| Colors, radius, type, spacing tokens | **Figma variables** | code | `/sync-tokens` → `src/styles/figma-tokens.css` |
| Component API, behavior, a11y | **React** (`src/components/**`) | Figma | `/code-to-figma` when a component is added/changed |
| Screens / flows | **Figma design file** (Kim) | code | `/figma-to-code <figma link>` |
| Figma component ↔ React component + prop names | `design-system/component-map.json` | both | updated with every component change |

Hard rules:
1. **Never hand-edit** `src/styles/theme.css` (stock Untitled UI, updated by the CLI) or `src/styles/figma-tokens.css` (generated). Style changes happen in Figma variables, then `/sync-tokens`.
2. **Only semantic classes** in JSX: `text-primary`, `bg-brand-solid`, `border-secondary`, `text-fg-quaternary`, `bg-utility-brand-50`. Never palette classes (`bg-purple-600`, `text-gray-900`), never hex, never arbitrary values (`rounded-[7px]`, `p-[13px]`) unless you copy them verbatim from an existing Untitled UI component.
3. **Reuse before building.** Order: an existing component in `src/components` → an Untitled UI PRO or free component (search with the `untitledui` MCP, install with `npx untitledui@latest add <name>`) → a new component (only after the Figma component exists; see `/code-to-figma`).
4. **Radius names differ between Figma and Tailwind.** Figma `radius-md` (8px) = `rounded-lg`. Look it up in `design-system/tokens/TOKENS.md`; never guess from the name.
5. Every Figma variable already carries its React name in **Code syntax (Web)**, and every mapped Figma component set carries its React import in its **description** (after the `⟨code⟩` marker). Trust those, then `component-map.json`.

## MCP servers (project `.mcp.json`)
- `figma` — Figma's remote MCP (read designs, variables, screenshots; `use_figma` writes via Plugin API). Load the Figma skills first (`figma-use` before any `use_figma`, `figma-design-to-code` before `get_design_context`).
- `untitledui` — search/install Untitled UI components, page templates and icons (PRO semantic search after OAuth login).

## Turning a Figma frame into code
1. `get_design_context` + `get_screenshot` for the node. Read instance names: each instance's main component name is a key in `component-map.json`.
2. Translate variants with the map's `props` table (Figma value → React prop value; React values are kebab-case of the Figma value; `omit` = visual state handled by CSS/React Aria).
3. Layout: Figma auto-layout gap/padding bound to `spacing-*` → Tailwind step from TOKENS.md (`spacing-xl` = 16px = `gap-4`). Text styles `Text sm/Semibold` → `text-sm font-semibold`.
4. Page components go in `src/pages/<kebab-name>.tsx` (route in `src/main.tsx`); product-specific compositions in `src/features/<feature>/`; generic reusable pieces in the matching Untitled UI folder (`base/`, `application/` …).
5. Report any Figma layer that had no mapping or used a raw value instead of a variable — that's a design-system gap to fix in Figma, not something to paper over in code.

## Naming conventions (Figma ↔ code must match)
- Component: Figma `Agent card` (component set) ↔ file `agent-card.tsx` ↔ export `AgentCard`. Sub-parts: Figma `Agent card/Header` ↔ `AgentCard.Header`.
- Variant property: Figma `Size`, `Hierarchy`, `State`, `Type` ↔ React `size`, `color`, (state → `isDisabled`/`isLoading`/…), `type`. Values: Figma `Link gray` ↔ React `"link-gray"`.
- Boolean property: Figma `⬅️ Icon leading` ↔ React `iconLeading`; instance swap `🔀 Icon swap` ↔ `icon`.
- Files are kebab-case; React Aria imports are prefixed `Aria*` (see reference below).

## Commands
- `npm run dev` · `npm run build`
- `npm run tokens:build` — regenerate CSS + docs from `design-system/tokens/raw/*.tsv`
- `npm run tokens:check` — fails if generated files are stale (runs in CI)
- `npm run figma:descriptions` — print the Plugin API script that writes component descriptions into Figma
- Slash commands in `.claude/commands/`: `/sync-tokens`, `/figma-to-code`, `/code-to-figma`, `/restyle`, `/check-sync`

## Untitled UI reference
@docs/untitledui-reference.md
