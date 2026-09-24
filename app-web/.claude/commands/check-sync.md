---
description: Check whether Figma and code are still in sync (tokens + component map) without changing anything
---

Read-only drift check.

1. Export all 4 variable parts from Figma (see `/sync-tokens` step 2) into a temp folder, **not** into `design-system/tokens/raw`. Diff them against `design-system/tokens/raw/*.tsv` and list every changed/added/removed variable.
2. `npm run tokens:check`.
3. For every entry in `design-system/component-map.json`: confirm the Figma node still exists and has the same name (batch it in one `use_figma` call), and that the React import path exists in `src/`.
4. Report: "in sync" or a short list of drifts, each with the command that fixes it (`/sync-tokens`, `/code-to-figma …`, or a map edit).
