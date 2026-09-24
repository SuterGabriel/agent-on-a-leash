// Figma Plugin API script — run through the Figma MCP `use_figma` tool (Claude does this in /sync-tokens).
// Exports one slice of the file's local variables as tab-separated lines, small enough
// to fit in one MCP response (~20 KB cap). Claude saves the returned text to
// design-system/tokens/raw/<PART>.tsv, then `npm run tokens:build` turns it into CSS.
//
// Before running, replace __PART__ with one of:
//   primitives      → collection "_Primitives"
//   colors-core     → collection "1. Color modes" (everything except Utility)
//   colors-utility  → collection "1. Color modes" (Component colors/Utility/* only)
//   dimensions      → collections "2. Radius", "3. Spacing", "4. Widths", "5. Containers", "6. Typography"
//
// Output format (one variable per line):
//   #collection <name>\t<mode 1>\t<mode 2>…
//   <variable name>\t<type C|F|S|B>\t<value mode 1>\t<value mode 2>…
// Values: colors as #rrggbb[aa], aliases as @<target variable name>, numbers/strings raw.

const PART = "__PART__";

const SLICES = {
    primitives: { collections: ["_Primitives"], filter: () => true },
    "colors-core": { collections: ["1. Color modes"], filter: (n) => !n.includes("/Utility/") },
    "colors-utility": { collections: ["1. Color modes"], filter: (n) => n.includes("/Utility/") },
    dimensions: { collections: ["2. Radius", "3. Spacing", "4. Widths", "5. Containers", "6. Typography"], filter: () => true },
};

const slice = SLICES[PART];
if (!slice) throw new Error("Unknown PART " + PART);

const all = await figma.variables.getLocalVariablesAsync();
const byId = {};
for (const v of all) byId[v.id] = v;

const hex = (c) => {
    const h = (x) =>
        Math.round(x * 255)
            .toString(16)
            .padStart(2, "0");
    return "#" + h(c.r) + h(c.g) + h(c.b) + (c.a !== undefined && c.a < 1 ? h(c.a) : "");
};
const fmt = (val) => {
    if (val && typeof val === "object" && val.type === "VARIABLE_ALIAS") return "@" + (byId[val.id] ? byId[val.id].name : val.id);
    if (val && typeof val === "object" && "r" in val) return hex(val);
    return String(val);
};

const collections = await figma.variables.getLocalVariableCollectionsAsync();
const lines = [];
for (const name of slice.collections) {
    const c = collections.find((x) => x.name === name);
    if (!c) {
        lines.push("#missing " + name);
        continue;
    }
    lines.push(["#collection " + c.name, ...c.modes.map((m) => m.name)].join("\t"));
    for (const id of c.variableIds) {
        const v = byId[id];
        if (!slice.filter(v.name)) continue;
        lines.push([v.name, v.resolvedType[0], ...c.modes.map((m) => fmt(v.valuesByMode[m.modeId]))].join("\t"));
    }
}
return lines.join("\n");
