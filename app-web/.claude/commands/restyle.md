---
description: Restyle the design system (brand color, neutrals, radius, font) in Figma and sync it to code
argument-hint: <what should change, e.g. "brand teal, warmer grays, softer corners, font Geist">
---

Restyle request: $ARGUMENTS

The styling lives in Figma variables; code follows via `/sync-tokens`. Work in this order and show me a plan with before/after values before writing anything to Figma:

1. **Brand**: generate an 11-step scale (50–950) around the requested color; check that 600 on white and white on 600 reach ≥ 4.5:1 contrast (primary buttons use `bg-brand-solid` = Brand/600 with white text). Write it to `_Primitives` → `Colors/Brand/*`.
2. **Neutrals**: prefer re-pointing instead of recoloring. Untitled UI semantic tokens alias `Colors/Neutral/*`; to switch to warmer/cooler grays, change the *values* of `Colors/Neutral/*` to one of the provided families (Stone, Taupe, Mauve, Mist, Olive, Zinc, Slate, Gray). Don't edit hundreds of semantic aliases.
3. **Semantic tweaks** only if needed (e.g. `bg-brand-solid` → Brand/700 for more contrast), in both Light and Dark modes.
4. **Radius**: edit `2. Radius`. Warn that `radius-lg` (10px) and `radius-3xl` (20px) have no Tailwind slot, and that some Untitled UI components hard-code inner radii (`before:rounded-[7px]` on buttons); list the files `npm run tokens:build` flags and offer to update them.
5. **Font**: set `6. Typography → Font family/*`; the font must exist in Figma and be loaded in code.
6. Apply with `use_figma` (load `figma-use` first), screenshot the Buttons, Inputs and Badges pages in Light and Dark, then run `/sync-tokens`.
