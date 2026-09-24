---
description: Build a Figma frame (screen, section or component) as React using the Untitled UI components
argument-hint: <figma link to a frame>
---

Build this Figma node in React: $ARGUMENTS

1. Load the `figma-design-to-code` skill. Parse fileKey + node-id from the link.
2. `get_screenshot` and `get_design_context` for the node. If it's large, call `get_metadata` first and work section by section.
3. For every instance, look up its main component in `design-system/component-map.json` (also visible in the Figma component description after `⟨code⟩`). Use that React component and translate variant values with the map's `props` table. For components not in the map, search `src/components` and then the `untitledui` MCP (`search_components`) before writing anything new; install with `npx untitledui@latest add <name>`.
4. Styling: semantic classes only (the variable's Code syntax in Figma is the class to use). Spacing/radius/type via `design-system/tokens/TOKENS.md`. No hex, no palette classes, no arbitrary values.
5. Placement: pages → `src/pages/<kebab-name>.tsx` + route in `src/main.tsx`; product-specific sections → `src/features/<feature>/<kebab-name>.tsx`. Name files and exports after the Figma frame name (kebab-case file, PascalCase export).
6. Use realistic data from the design; put mock data in a `*.data.ts` file next to the component.
7. `npm run build` must pass. Then list:
   - components used (Figma name → React import),
   - anything that had no mapping or used a raw (unbound) value in Figma — these are design-system gaps for Kim to fix in Figma, not in code,
   - any new component you had to create (and remind to run `/code-to-figma` for it).
