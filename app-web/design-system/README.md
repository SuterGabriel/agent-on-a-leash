# Design system: how Figma and React stay in sync

**Figma library:** Untitled UI PRO v8, Kim's copy (variables + components). **Figma design file:** HackZurich 2026 — Agent on a Leash (screens), which uses the library. Keys for both are in `figma.config.json`.
**Code:** Untitled UI React v8, in this repo (you own the component code, installed through the `untitledui` CLI)

Both sides already use the same Untitled UI names, so most of the work is keeping that true.

```
                     tokens (color · radius · type)
   FIGMA VARIABLES  ───────────── /sync-tokens ───────────▶  src/styles/figma-tokens.css
   (Kim edits here)                                           (generated, never hand-edited)

                     screens / flows
   FIGMA FRAMES     ───────────── /figma-to-code ─────────▶  src/pages · src/features
                                   uses component-map.json

                     component API & behavior
   FIGMA COMPONENTS ◀──────────── /code-to-figma ─────────  src/components/**
   (descriptions show the React import)
```

## Who owns what

| Layer | Owner (source of truth) | Mirror |
|---|---|---|
| Colors, radius, typography, spacing | Figma variables | `src/styles/figma-tokens.css` (generated) |
| Component props, states, accessibility | React components | Figma component sets + `component-map.json` |
| Screens | Figma **design file**, pages *UI — mobile* / *UI — judge/debug web view* | `src/pages`, `src/features` |
| Product components | Library page **🧩 Agent on a Leash — Components** first, then React | `component-map.json` → `custom` |

## What's in the Figma file

- **Code syntax:** each of the 680 variables has its React/Tailwind name in *Code syntax → Web*. Inspect a layer and you see `bg-brand-solid`, `text-tertiary`, `rounded-lg`, `gap-4 · p-4`, not only the Figma name.
- **Component descriptions:** 23 core component sets (Button, Badge, Input, Select, Checkbox, Toggle, Tabs, Modal, Table, Navigation…) have a `⟨code⟩ React` block in their description with the import path, a prop mapping and an example. Any text a designer writes above that block is kept when it's regenerated.
- **Product components page** sits at the top of the library file. The pages below the separator are left as stock Untitled UI.
- **Publish the library once** (Assets panel → Libraries → Publish), then turn it on in the design file. After a `/restyle`, publish again and accept the updates in the design file.

## Files in this folder

| File | What it is |
|---|---|
| `figma.config.json` | File key, page IDs, what each variable collection is |
| `component-map.json` | Figma component set → React import + prop translation. **Update it whenever a component changes.** |
| `tokens/raw/*.tsv` | The latest Figma variable export (commit it, so diffs show every design change) |
| `tokens/baseline/*.tsv` | Stock Untitled UI values. `figma-tokens.css` only contains the differences from these. |
| `tokens/TOKENS.md` | Generated lookup table: Figma variable → CSS variable → Tailwind class |
| `tokens/code-syntax.json` | Generated: the Code syntax written into Figma |

## Things that trip people up

1. **Radius names are shifted.** Figma `radius-md` (8px) = Tailwind `rounded-lg`, and Figma `radius-xs` (4px) = `rounded-sm`. Figma `radius-lg` (10px) and `radius-3xl` (20px) have no Tailwind equivalent. Check `tokens/TOKENS.md`.
2. **Some radii are hard-coded in Untitled UI components** (for example `before:rounded-[7px]` on the Button's inner border). A radius restyle needs those edited too. `npm run tokens:build` lists them.
3. **Spacing uses a 4px grid on both sides.** Figma `spacing-xl` = 16px = Tailwind `4` (`gap-4`, `p-4`).
4. **Disabled isn't a color.** In v8, disabled means `opacity-50` in code. The Figma *State=Disabled* variant looks the same way.
5. **Font changes need two steps:** change the variable in Figma, and load the font in code (`index.html` currently loads Inter from Google Fonts).

## Setup on a new machine (developer)

```bash
git clone <repo> && cd hackzurich-app
npm install
npm run dev                           # http://localhost:5173 · style guide at /design-system
claude                                # approve the project MCP servers (figma, untitledui), then /mcp to log in
```

