---
description: Mirror a new or changed React component into the Figma library and register it in the component map
argument-hint: <path to component file, or component name>
---

Mirror this React component into Figma: $ARGUMENTS

1. Read the component file and its props (sizes, colors/types, states, booleans, icon slots).
2. Load the `figma-use` and `figma-generate-library` skills. Open the LIBRARY file (`fileKey` in `design-system/figma.config.json`).
3. Check whether a matching component set already exists (`search_design_system` + `component-map.json`). Update it instead of duplicating.
4. Build/update the component set:
   - Name: Title case of the React name with spaces (`AgentCard` → `Agent card`), placed on a page in the matching section (base components → next to similar ones; product components → library page `projectPages.components` in `figma.config.json`).
   - Variant properties mirror React props: `Size` ↔ `size`, `Type`/`Hierarchy` ↔ `type`/`color`, `State` = Default/Hover/Focused/Disabled (+ Loading if supported). Values are Title case of the React values (`link-gray` → `Link gray`).
   - Booleans for optional slots (`⬅️ Icon leading`), instance-swap for icons (`🔀 Icon swap`), text properties for labels.
   - Every fill, stroke, radius, gap and padding **bound to variables** from `1. Color modes`, `2. Radius`, `3. Spacing`; text uses the existing text styles. Zero raw values.
   - Auto layout that matches the Tailwind layout in code.
5. Add/update the entry in `design-system/component-map.json` (`custom` array for product components), then `npm run figma:descriptions` and run the printed script with `use_figma` so the Figma description shows the React import.
6. Screenshot the result and compare it against the running React component. Report differences.
