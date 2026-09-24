---
description: Pull Figma variables into code (colors, radius, type) and regenerate the token CSS
---

Sync design tokens from Figma to code. Figma is the source of truth for tokens.

1. Read `design-system/figma.config.json` for the library `fileKey` (variables live in the library, not the design file). Load the `figma-use` skill.
2. For each PART in `primitives`, `colors-core`, `colors-utility`, `dimensions`:
   - Take `scripts/figma/export-variables.js`, replace `__PART__` with the part name, run it with the Figma MCP `use_figma` tool (read-only).
   - Save the returned text **verbatim** to `design-system/tokens/raw/<PART>.tsv` (add a trailing newline). If a response looks truncated (last line incomplete, or much shorter than the existing file), stop and report — never guess missing lines.
3. Run `npm run tokens:build` and show me:
   - `git diff --stat design-system/tokens/raw` and the full `git diff src/styles/figma-tokens.css`
   - every ⚠ warning the script printed, explained in one line each (e.g. "radius-lg has no Tailwind slot").
4. If new variables appeared in Figma, re-run `scripts/figma/apply-code-syntax.js` via `use_figma` so they get their React name in Code syntax, and check the returned sample against `design-system/tokens/code-syntax.json`.
5. If a font family changed, make sure the font is actually loaded (add it to `index.html` via Google Fonts or install `@fontsource-variable/<font>` and import it in `src/main.tsx`).
6. Run `npm run build`. Summarise what visibly changes in the app (e.g. "primary buttons go from purple to teal, all corners 8→6px").

Do not edit `src/styles/theme.css` or `src/styles/figma-tokens.css` by hand.
