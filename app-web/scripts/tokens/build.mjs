#!/usr/bin/env node
/**
 * Figma variables → code tokens.
 *
 *   npm run tokens:build   regenerate src/styles/figma-tokens.css, tokens.json, TOKENS.md, code-syntax.json
 *   npm run tokens:check   fail (exit 1) if the generated files are stale or names drifted
 *
 * Source of truth: design-system/tokens/raw/*.tsv (exported from Figma by scripts/figma/export-variables.js).
 * Baseline:        design-system/tokens/baseline/*.tsv (the untouched Untitled UI v8 values).
 *
 * Only values that differ from the baseline are written to figma-tokens.css. src/styles/theme.css stays
 * exactly as Untitled UI ships it, so `npx untitledui add … --overwrite` never clobbers our styling, and
 * figma-tokens.css reads as "everything we changed vs. Untitled UI".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RAW = path.join(ROOT, "design-system/tokens/raw");
const BASE = path.join(ROOT, "design-system/tokens/baseline");
const THEME = path.join(ROOT, "src/styles/theme.css");
const OUT_CSS = path.join(ROOT, "src/styles/figma-tokens.css");
const OUT_JSON = path.join(ROOT, "design-system/tokens/tokens.json");
const OUT_MD = path.join(ROOT, "design-system/tokens/TOKENS.md");
const OUT_SYNTAX = path.join(ROOT, "design-system/tokens/code-syntax.json");
const CHECK = process.argv.includes("--check");

// ---------- parse ----------
function parseDir(dir) {
    const vars = {}; // name -> { collection, type, values: {mode: raw} }
    if (!fs.existsSync(dir)) return vars;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".tsv"))) {
        let collection = null;
        let modes = [];
        for (const line of fs.readFileSync(path.join(dir, file), "utf8").split("\n")) {
            if (!line.trim()) continue;
            if (line.startsWith("#collection ")) {
                const [head, ...m] = line.split("\t");
                collection = head.replace("#collection ", "");
                modes = m;
                continue;
            }
            if (line.startsWith("#")) continue;
            const [name, type, ...values] = line.split("\t");
            vars[name] = { collection, type, values: Object.fromEntries(modes.map((m, i) => [m, values[i]])) };
        }
    }
    return vars;
}

const figma = parseDir(RAW);
const baseline = parseDir(BASE);
const themeCss = fs.readFileSync(THEME, "utf8");
const themeVars = new Set([...themeCss.matchAll(/--([a-z0-9_-]+)\s*:/g)].map((m) => m[1]));
const hasVar = (v) => themeVars.has(v);

// ---------- naming rules (Figma name → CSS custom property) ----------
const slug = (s) =>
    s
        .toLowerCase()
        .replace(/\s*\(alpha\)/, "-alpha")
        .replace(/\s+/g, "-");
const leaf = (name) =>
    name
        .split("/")
        .pop()
        .replace(/\s*\(\d+\)\s*$/, "");

/** Primitive color: "Colors/Brand/600" → "color-brand-600" */
function primitiveCssVar(name) {
    const m = name.match(/^Colors\/(.+)\/([^/]+)$/);
    if (!m) return null;
    if (m[1] === "Base") return { white: "color-white", black: "color-black", transparent: null }[m[2]] ?? null;
    return `color-${slug(m[1])}-${m[2]}`;
}

/** Semantic color (collection "1. Color modes") → css var, tailwind hint, kind */
function semanticInfo(name) {
    const n = leaf(name);
    if (name.startsWith("Component colors/Alpha/")) {
        const [, which, pct] = n.match(/alpha-(white|black)-(\d+)/);
        return { kind: "alpha", css: null, syntax: pct === "100" ? `bg-alpha-${which}` : `bg-alpha-${which}/${pct}` };
    }
    if (name.startsWith("Colors/Effects/Shadows/") || name.startsWith("Colors/Effects/Portfolio")) {
        const s = n.replace(/_0\d$/, "").replace("skeumorphic-inner-border", "skeuomorphic").replace("skeumorphic-inner", "skeuomorphic");
        return { kind: "shadow", css: null, syntax: `shadow-${s.replace(/^shadow-/, "")}` };
    }
    const css = `color-${n}`;
    let syntax = `var(--${css})`;
    if (name.startsWith("Colors/Text/")) syntax = `text-${n.replace(/^text-/, "")}`;
    else if (name.startsWith("Colors/Background/")) syntax = `bg-${n.replace(/^bg-/, "")}`;
    else if (name.startsWith("Colors/Border/")) syntax = `border-${n.replace(/^border-/, "")}`;
    else if (name.startsWith("Colors/Foreground/")) syntax = `text-${n}`;
    else if (name.includes("/Utility/")) syntax = `bg-${n}`;
    return { kind: "semantic", css, syntax };
}

// Figma radius → Tailwind radius scale used by the React components (verified: Button md = radius-md = rounded-lg = 8px)
const RADIUS = {
    "radius-none": { tw: null, syntax: "rounded-none" },
    "radius-xxs": { tw: ["radius-xs"], syntax: "rounded-xs" },
    "radius-xs": { tw: ["radius-sm", "radius"], syntax: "rounded-sm" },
    "radius-sm": { tw: ["radius-md"], syntax: "rounded-md" },
    "radius-md": { tw: ["radius-lg"], syntax: "rounded-lg" },
    "radius-lg": { tw: null, syntax: "rounded-[10px]" },
    "radius-xl": { tw: ["radius-xl"], syntax: "rounded-xl" },
    "radius-2xl": { tw: ["radius-2xl"], syntax: "rounded-2xl" },
    "radius-3xl": { tw: null, syntax: "rounded-[20px]" },
    "radius-4xl": { tw: ["radius-3xl"], syntax: "rounded-3xl" },
    "radius-full": { tw: null, syntax: "rounded-full" },
};
const FONT_WEIGHT = { regular: 400, medium: 500, semibold: 600, bold: 700 };

// ---------- value conversion ----------
function hexToRgb(hex) {
    const h = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    if (h.length === 8) {
        const a = Math.round((parseInt(h.slice(6, 8), 16) / 255) * 100) / 100;
        return `rgb(${r} ${g} ${b} / ${a})`;
    }
    return `rgb(${r} ${g} ${b})`;
}
function colorValue(raw, warn) {
    if (raw === undefined) return null;
    if (raw.startsWith("#")) return hexToRgb(raw);
    if (raw.startsWith("@")) {
        const target = raw.slice(1);
        if (target === "Colors/Base/transparent") return "transparent";
        const p = primitiveCssVar(target);
        if (p && !/^Colors\/(Text|Border|Foreground|Background|Effects)\//.test(target)) return `var(--${p})`;
        const s = semanticInfo(target);
        if (s.css) return `var(--${s.css})`;
        warn(`Cannot resolve alias ${raw}`);
        return null;
    }
    warn(`Unknown color value ${raw}`);
    return null;
}
const px = (n) => `${Number(n) / 16}rem`;

// ---------- build ----------
const warnings = [];
const warn = (m) => warnings.push(m);
const tokens = { primitives: {}, semantic: {}, radius: {}, spacing: {}, typography: {} };
const syntax = {}; // figma variable name -> WEB code syntax
const themeLight = [];
const themeDark = [];
const md = [];

const isColorModes = (v) => v.collection === "1. Color modes";
const modeNames = (v) => Object.keys(v.values);

for (const [name, v] of Object.entries(figma)) {
    const b = baseline[name];
    const changed = (mode) => !b || b.values[mode] !== v.values[mode];

    if (v.collection === "_Primitives" && name.startsWith("Colors/")) {
        const css = primitiveCssVar(name);
        if (name.includes("(alpha)")) continue; // Neutral (alpha) — Figma-only helper
        syntax[name] = css ? css.replace(/^color-/, "") : "transparent";
        tokens.primitives[name] = { css, value: v.values.Style };
        // Written only when edited in Figma (brand lives in theme.css, Tailwind palettes in Tailwind itself).
        if (css && changed("Style")) themeLight.push(`    --${css}: ${hexToRgb(v.values.Style)};`);
        continue;
    }
    if (v.collection === "_Primitives" && name.startsWith("Spacing/")) {
        const step = name.match(/^Spacing\/([\d․.]+)/)[1].replace("․", ".");
        syntax[name] = step;
        tokens.spacing[name] = { tailwind: step, px: Number(v.values.Style) };
        if (Number(v.values.Style) !== Number(step) * 4)
            warn(`Spacing primitive ${name} is ${v.values.Style}px — Tailwind step ${step} is ${Number(step) * 4}px. Not synced (Tailwind uses a 4px grid).`);
        continue;
    }

    if (isColorModes(v)) {
        const info = semanticInfo(name);
        syntax[name] = info.syntax;
        const [lightMode, darkMode] = modeNames(v);
        tokens.semantic[name] = { ...info, light: v.values[lightMode], dark: v.values[darkMode] };
        if (info.kind !== "semantic") continue;
        if (!hasVar(info.css)) {
            warn(`Figma variable "${name}" → --${info.css} does not exist in theme.css (new token?). It will still be emitted.`);
        }
        md.push(`| \`${name}\` | \`--${info.css}\` | \`${info.syntax}\` | ${v.values[lightMode]} | ${v.values[darkMode]} |`);
        if (changed(lightMode) || !hasVar(info.css)) {
            const val = colorValue(v.values[lightMode], warn);
            if (val) themeLight.push(`    --${info.css}: ${val};`);
        }
        if (changed(darkMode) || !hasVar(info.css)) {
            const val = colorValue(v.values[darkMode], warn);
            if (val) themeDark.push(`        --${info.css}: ${val};`);
        }
        continue;
    }

    if (v.collection === "2. Radius") {
        const r = RADIUS[name];
        if (!r) {
            warn(`Radius "${name}" has no Tailwind mapping — add it to RADIUS in scripts/tokens/build.mjs`);
            continue;
        }
        syntax[name] = r.syntax;
        tokens.radius[name] = { px: Number(v.values["Mode 1"]), tailwind: r.syntax };
        if (r.tw && changed("Mode 1")) for (const t of r.tw) themeLight.push(`    --${t}: ${px(v.values["Mode 1"])};`);
        else if (!r.tw && changed("Mode 1")) warn(`Radius ${name} changed but has no Tailwind slot; components using ${r.syntax} must be edited by hand.`);
        continue;
    }

    if (v.collection === "3. Spacing" || v.collection === "4. Widths" || v.collection === "5. Containers") {
        const val = Object.values(v.values)[0];
        const target = val.startsWith("@") ? val.slice(1) : null;
        const step = target ? target.match(/^Spacing\/([\d․.]+)/)?.[1].replace("․", ".") : String(Number(val) / 4);
        if (v.collection === "3. Spacing") syntax[name] = `gap-${step} · p-${step}`;
        else if (name === "container-max-width-desktop") syntax[name] = "max-w-container";
        else if (name.startsWith("container-padding")) syntax[name] = `px-${step}`;
        else syntax[name] = `max-w-${step}`;
        tokens.spacing[name] = { tailwind: step, alias: target };
        if (baseline[name] && baseline[name].values[Object.keys(v.values)[0]] !== val)
            warn(`${name} changed in Figma (${val}). Spacing is layout — update usages in code by hand or ask Claude to sweep.`);
        continue;
    }

    if (v.collection === "6. Typography") {
        const val = v.values.Value;
        const b0 = b?.values.Value;
        tokens.typography[name] = val;
        if (name.startsWith("Font family/")) {
            const which = name.endsWith("display") ? "display" : "body";
            syntax[name] = `font-${which}`;
            if (b0 !== val) themeLight.push(`    --font-${which}: "${val}", -apple-system, "Segoe UI", Roboto, Arial, sans-serif;`);
        } else if (name.startsWith("Font weight/")) {
            const w = name.split("/")[1];
            syntax[name] = w.includes("italic") ? `font-${w.replace("-italic", "")} italic` : `font-${w}`;
        } else if (name.startsWith("Font size/")) {
            // Figma names body sizes "text-xs"; Tailwind's slot is --text-xs (class `text-xs`), not --text-text-xs.
            const k = name.split("/")[1].replace(/^text-/, "");
            syntax[name] = `text-${k}`;
            if (b0 !== val) themeLight.push(`    --text-${k}: ${px(val)};`);
        } else if (name.startsWith("Line height/")) {
            const k = name.split("/")[1].replace(/^text-/, "");
            syntax[name] = `text-${k} (line-height ${val}px)`;
            if (b0 !== val) themeLight.push(`    --text-${k}--line-height: ${px(val)};`);
        }
        continue;
    }
}

// ---------- baseline sanity: every baseline semantic var must resolve to what theme.css ships ----------
const baselineDrift = [];
for (const [name, v] of Object.entries(baseline)) {
    if (!isColorModes(v)) continue;
    const info = semanticInfo(name);
    if (info.kind !== "semantic" || !hasVar(info.css)) continue;
    const [lightMode] = modeNames(v);
    const expected = colorValue(v.values[lightMode], () => {});
    const actual = themeCss.match(new RegExp(`\\n\\s*--${info.css.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*:\\s*([^;]+);`))?.[1].trim();
    if (actual && expected && actual.replace(/\s/g, "") !== expected.replace(/\s/g, ""))
        baselineDrift.push(`--${info.css}: Figma ${expected} vs theme.css ${actual}`);
}

// ---------- write ----------
const header = `/*
 * AUTO-GENERATED by scripts/tokens/build.mjs — do not edit by hand.
 * Source: Figma variables (design-system/tokens/raw/*.tsv).
 * Contains ONLY the values that differ from stock Untitled UI (design-system/tokens/baseline).
 * To change styling: edit the variables in Figma → run /sync-tokens in Claude Code.
 */
`;
const css =
    header +
    (themeLight.length
        ? `\n@theme {\n${themeLight.join("\n")}\n}\n`
        : "\n/* No light-mode / primitive overrides yet — the app looks exactly like stock Untitled UI. */\n") +
    (themeDark.length ? `\n@layer base {\n    .dark-mode {\n${themeDark.join("\n")}\n    }\n}\n` : "");

const mdOut = `# Token reference (generated)

Figma variable → CSS custom property → Tailwind class used in React. Regenerated by \`npm run tokens:build\`.

- Color tokens live in the Figma collection **1. Color modes** (Light / Dark) and alias the **_Primitives** palettes.
- In React you **never** use primitives (\`bg-brand-600\`) for UI — always the semantic class in the 3rd column.
- Radius: Figma and Tailwind use different size names. Figma \`radius-md\` (8px) = Tailwind \`rounded-lg\`.

## Radius

| Figma | px | Tailwind |
|---|---|---|
${Object.entries(tokens.radius)
    .map(([n, r]) => `| \`${n}\` | ${r.px} | \`${r.tailwind}\` |`)
    .join("\n")}

## Spacing (semantic)

| Figma | Tailwind step |
|---|---|
${Object.entries(tokens.spacing)
    .filter(([n]) => !n.startsWith("Spacing/"))
    .map(([n, s]) => `| \`${n}\` | \`${syntax[n]}\` |`)
    .join("\n")}

## Semantic colors

| Figma variable | CSS var | Tailwind | Light | Dark |
|---|---|---|---|---|
${md.join("\n")}
`;

const outputs = [
    [OUT_CSS, css],
    [OUT_JSON, JSON.stringify(tokens, null, 2) + "\n"],
    [OUT_MD, mdOut],
    [OUT_SYNTAX, JSON.stringify(syntax, null, 2) + "\n"],
];

let stale = false;
for (const [file, content] of outputs) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (CHECK) {
        if (current !== content) {
            stale = true;
            console.error(`✗ ${path.relative(ROOT, file)} is out of date — run npm run tokens:build`);
        }
    } else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
}

// Hard-coded values in components that bypass tokens (they won't follow a restyle).
const hardcoded = [];
const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.(tsx|ts)$/.test(f.name)) {
            const src = fs.readFileSync(p, "utf8");
            const hits = src.match(/\b(rounded(?:-[a-z]+)?-\[\d+px\]|(?:bg|text|border|ring)-\[#[0-9a-fA-F]{3,8}\])/g);
            if (hits) hardcoded.push(`${path.relative(ROOT, p)}: ${[...new Set(hits)].join(", ")}`);
        }
    }
};
walk(path.join(ROOT, "src"));

const counts = `${Object.keys(figma).length} Figma variables · ${themeLight.length} light/primitive overrides · ${themeDark.length} dark overrides`;
console.log(`${CHECK ? "Checked" : "Built"} tokens: ${counts}`);
if (baselineDrift.length)
    console.log(
        `\nℹ Stock Untitled UI already differs between Figma and theme.css for ${baselineDrift.length} tokens (not our doing):\n  ${baselineDrift.join("\n  ")}`,
    );
if (warnings.length) console.log(`\n⚠ ${warnings.length} warning(s):\n  ${warnings.join("\n  ")}`);
if (hardcoded.length)
    console.log(
        `\nℹ Hard-coded values that ignore tokens (${hardcoded.length} files) — check these after a restyle:\n  ${hardcoded.slice(0, 15).join("\n  ")}${hardcoded.length > 15 ? `\n  …and ${hardcoded.length - 15} more` : ""}`,
    );
if (CHECK && stale) process.exit(1);
if (CHECK) console.log("✓ Code tokens match the last Figma export.");
