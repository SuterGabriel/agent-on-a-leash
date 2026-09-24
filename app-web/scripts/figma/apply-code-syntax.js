// Figma Plugin API script — run through the Figma MCP `use_figma` tool.
// Writes the React/Tailwind name of every variable into its "Code syntax → Web" field, so anyone
// inspecting a layer in Figma (Dev Mode or the variables panel) sees e.g. `bg-brand-solid` or
// `rounded-lg` instead of just the Figma variable name.
//
// The naming rules mirror scripts/tokens/build.mjs (which writes design-system/tokens/code-syntax.json).
// If you change one, change the other, then compare the returned sample against code-syntax.json.

const leaf = (name) =>
    name
        .split("/")
        .pop()
        .replace(/\s*\(\d+\)\s*$/, "");
const slug = (s) =>
    s
        .toLowerCase()
        .replace(/\s*\(alpha\)/, "-alpha")
        .replace(/\s+/g, "-");
const RADIUS = {
    "radius-none": "rounded-none",
    "radius-xxs": "rounded-xs",
    "radius-xs": "rounded-sm",
    "radius-sm": "rounded-md",
    "radius-md": "rounded-lg",
    "radius-lg": "rounded-[10px]",
    "radius-xl": "rounded-xl",
    "radius-2xl": "rounded-2xl",
    "radius-3xl": "rounded-[20px]",
    "radius-4xl": "rounded-3xl",
    "radius-full": "rounded-full",
};

function syntaxFor(v, collectionName, value) {
    const name = v.name;
    if (collectionName === "_Primitives") {
        if (name.includes("(alpha)")) return null;
        let m = name.match(/^Colors\/(.+)\/([^/]+)$/);
        if (m) return m[1] === "Base" ? (m[2] === "transparent" ? "transparent" : m[2]) : `${slug(m[1])}-${m[2]}`;
        m = name.match(/^Spacing\/([\d․.]+)/);
        if (m) return m[1].replace("․", ".");
        return null;
    }
    if (collectionName === "1. Color modes") {
        const n = leaf(name);
        if (name.startsWith("Component colors/Alpha/")) {
            const [, which, pct] = n.match(/alpha-(white|black)-(\d+)/);
            return pct === "100" ? `bg-alpha-${which}` : `bg-alpha-${which}/${pct}`;
        }
        if (name.startsWith("Colors/Effects/Shadows/") || name.startsWith("Colors/Effects/Portfolio")) {
            const s = n.replace(/_0\d$/, "").replace("skeumorphic-inner-border", "skeuomorphic").replace("skeumorphic-inner", "skeuomorphic");
            return `shadow-${s.replace(/^shadow-/, "")}`;
        }
        if (name.startsWith("Colors/Text/")) return `text-${n.replace(/^text-/, "")}`;
        if (name.startsWith("Colors/Background/")) return `bg-${n.replace(/^bg-/, "")}`;
        if (name.startsWith("Colors/Border/")) return `border-${n.replace(/^border-/, "")}`;
        if (name.startsWith("Colors/Foreground/")) return `text-${n}`;
        if (name.includes("/Utility/")) return `bg-${n}`;
        return `var(--color-${n})`;
    }
    if (collectionName === "2. Radius") return RADIUS[name] || null;
    if (["3. Spacing", "4. Widths", "5. Containers"].includes(collectionName)) {
        const step = value && value.type === "VARIABLE_ALIAS" ? value.__targetStep : String(Number(value) / 4);
        if (collectionName === "3. Spacing") return `gap-${step} · p-${step}`;
        if (name === "container-max-width-desktop") return "max-w-container";
        if (name.startsWith("container-padding")) return `px-${step}`;
        return `max-w-${step}`;
    }
    if (collectionName === "6. Typography") {
        const k = name.split("/")[1];
        if (name.startsWith("Font family/")) return name.endsWith("display") ? "font-display" : "font-body";
        if (name.startsWith("Font weight/")) return k.includes("italic") ? `font-${k.replace("-italic", "")} italic` : `font-${k}`;
        if (name.startsWith("Font size/")) return `text-${k}`;
        if (name.startsWith("Line height/")) return `text-${k} (line-height ${value}px)`;
    }
    return null;
}

const all = await figma.variables.getLocalVariablesAsync();
const byId = {};
for (const v of all) byId[v.id] = v;
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const counts = {};
const sample = {};
let i = 0;
for (const c of collections) {
    const mode = c.modes[0].modeId;
    counts[c.name] = 0;
    for (const id of c.variableIds) {
        const v = byId[id];
        let value = v.valuesByMode[mode];
        if (value && value.type === "VARIABLE_ALIAS" && byId[value.id]) {
            const t = byId[value.id].name.match(/^Spacing\/([\d․.]+)/);
            if (t) value = { type: "VARIABLE_ALIAS", __targetStep: t[1].replace("․", ".") };
        }
        const s = syntaxFor(v, c.name, value);
        if (!s) continue;
        if (!v.codeSyntax || v.codeSyntax.WEB !== s) v.setVariableCodeSyntax("WEB", s);
        counts[c.name]++;
        if (i++ % 23 === 0) sample[v.name] = s;
    }
}
return { counts, sample };
