// Pitch figures from the numbers in docs/HACKATHON.md, one SVG per claim.
//   npm run figures   -> docs/pitch/*.svg
// Every number is a constant below with the file it was measured into next to it, so a figure changes only when
// someone re-measures and edits the constant. Style follows docs/pitch/comparison.svg: light surface, thin marks,
// the dataviz palette (blue #2a78d6, orange #eb6834, aqua #1baf7a), text in ink, never in a series colour.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "pitch");
const FONT = "Inter, Segoe UI, Helvetica, Arial, sans-serif";
const INK = "#0b0b0b", INK2 = "#52514e", MUTED = "#898781", GRID = "#e1e0d9", SURFACE = "#fcfcfb";
const BLUE = "#2a78d6", ORANGE = "#eb6834", AQUA = "#1baf7a";
const GOOD = "#0ca30c", WARN = "#fab219";
const W = 1200;

// ---------- the data ----------

// docs/pitch/live-figures-asks-declined.md (top bar) and live-figures-asks-approved.md (bottom bar), 25 September.
// The seven scenarios both passes ran. [approved, asked, declined] per pass.
const LIVE = [
  { name: "Connection check", no: [0, 1, 1], yes: [0, 1, 1] },
  { name: "Cross-border purchase", no: [0, 6, 4], yes: [2, 4, 4] },
  { name: "Session integrity", no: [0, 11, 1], yes: [0, 11, 1] },
  { name: "Weeknight meal delivery", no: [0, 9, 3], yes: [5, 3, 4] },
  { name: "Category exclusions", no: [0, 6, 7], yes: [2, 4, 7] },
  { name: "Manipulated agent", no: [0, 10, 3], yes: [7, 3, 3] },
  { name: "Household budget", no: [0, 9, 3], yes: [4, 2, 6] },
];

// docs/pitch/comparison.md, 24 September. [kind, risky purchases, a plain limit catches, our engine catches]
const KINDS = [
  ["Over the limit or the budget", 8, 6, 8],
  ["Wrong item or unrequested extras", 6, 0, 6],
  ["Someone else driving the session", 5, 0, 5],
  ["Wrong, unknown or imitated seller", 4, 0, 4],
  ["Return terms not met or not stated", 3, 0, 3],
  ["Repeated order or text aimed at the agent", 2, 0, 2],
];

// docs/pitch/comparison.md: risky amount paid unchecked, CHF.
const MONEY = [
  ["No control", 5899.28, MUTED],
  ["Plain spending limit", 4173.28, ORANGE],
  ["Our engine", 0, BLUE],
];

// docs/HACKATHON.md section 3, milliseconds. Engine rows: npm run replay and performance.test.ts.
// Live rows: docs/pitch/live-figures-*.md, request event to decision event on Viseca's clock, network both ways.
const LATENCY = [
  ["Engine alone, median of 45", 0.04],
  ["Engine alone, slowest of 45", 2],
  ["Engine under load, p99 of 2,000", 0.7],
  ["Engine under load, worst case", 7],
  ["On Viseca's server, median of 74", 268],
  ["On Viseca's server, slowest of 185", 664],
];
const DEADLINE = 8000;

// docs/pitch/live-figures-asks-approved.md, why the engine asked, 28 questions.
const ASKED = [
  ["First purchase at this shop", 16],
  ["Shop page missing a fact", 5],
  ["Over the per-order limit", 2],
  ["Item outside the task", 2],
  ["Shop text aimed at the agent", 1],
  ["Looks like a split order", 1],
  ["Over the budget for the period", 1],
];

// docs/HACKATHON.md section 10, checked against the code on 25 September. "|" breaks a label into two lines.
const LIST = [
  ["Frontend", [["Clear, executable|permissions", "built"], ["Spending limits", "built"], ["Merchant|requirements", "partial"], ["Time windows", "partial"], ["Rules for uncertain|cases", "built"], ["Tighten, update|or revoke", "built"]]],
  ["Backend", [["Approve, decline or|step up, every time", "built"], ["Explain in plain|language", "built"], ["Customer's final|approve or reject", "built"], ["Track state: limits,|retries, duplicates", "built"], ["Merchant text is|untrusted", "built"]]],
  ["Technical", [["UI decoupled from|the engine", "built"], ["Small, fast models,|predictable fallback", "not"], ["No hard-coding to|scenarios or ids", "built"]]],
  ["Demo", [["Ordinary purchase,|little friction", "built"], ["Unsafe purchase,|useful intervention", "built"], ["Approve, reject or|revoke path", "built"], ["Judges see evidence|and why", "partial"]]],
  ["Surprise", [["A separate card for|online shopping", "built"]]],
];

// packages/engine/src/decide.ts wires 21 guards. Labels and families as the app shows them,
// packages/backend/src/engine/leashEngine.ts CHECKS and FAMILY. Destination has no label there yet; worded here.
const GUARDS = [
  ["Money", ["Per-order limit", "Spending budget|over time", "No orders split to|stay under the limit", "Price per item,|night or unit", "How many orders|per period", "Card limit per|purchase"]],
  ["Item and terms", ["Only the categories|you allowed", "Only the item|you asked for", "No extras you|did not ask for", "Return policy", "Things you excluded", "Refundable only"]],
  ["Shop", ["Type of shop", "Only shops you|have used", "Real shop, not|a lookalike", "Hotel in the city|you named"]],
  ["Looks like you", ["Looks like you", "Days you allowed"]],
  ["Repeats and|manipulation", ["Shop text is|never obeyed", "No duplicate orders", "No new price|after a decline"]],
];

// docs/HACKATHON.md section 2.
const NUMBERS = [
  ["45 of 45", "decisions match Viseca's|reference on the public set"],
  ["28 of 28", "risky purchases stopped or|asked; a plain limit catches 6"],
  ["0 of 185", "live decisions after|the 8 s deadline"],
  ["268 ms", "median decision on Viseca's|server, network included"],
  ["0.04 ms", "median engine time|per decision"],
  ["21", "checks in five families,|from your words and built in"],
  ["262", "tests, all green,|in 22 files"],
  ["2", "learned rules enforced|after one decline"],
];

// ---------- drawing helpers ----------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tw = (s, size) => s.length * size * 0.52; // rough text width, for placing labels
const text = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size ?? 22}"${o.weight ? ` font-weight="${o.weight}"` : ""} fill="${o.fill ?? INK}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}>${esc(s)}</text>`;
const lines = (x, y, s, lh, o = {}) => s.split("|").map((l, i) => text(x, y + i * lh, l, o)).join("");
const rect = (x, y, w, h, fill, o = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 0}" fill="${fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"` : ""}>${o.title ? `<title>${esc(o.title)}</title>` : ""}</rect>`;
/** Horizontal bar growing right: 4px rounded data end, square at the baseline. */
const hbar = (x, y, w, h, fill, title, r = 4) => {
  if (w <= 0) return "";
  const d = w <= r ? `M${x},${y}h${w}v${h}h${-w}z` : `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}z`;
  return `<path d="${d}" fill="${fill}">${title ? `<title>${esc(title)}</title>` : ""}</path>`;
};
const hline = (x1, x2, y, stroke = GRID, sw = 1) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${stroke}" stroke-width="${sw}"/>`;
const vline = (x, y1, y2, stroke = GRID, sw = 1) => `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"/>`;

function header(titleLines, subLines) {
  let y = 52;
  const out = [];
  for (const t of titleLines) { out.push(text(40, y, t, { size: 32, weight: 700 })); y += 40; }
  y -= 6;
  for (const s of subLines) { out.push(text(40, y, s, { size: 19, fill: INK2 })); y += 26; }
  return { svg: out.join("\n"), bottom: y };
}
function legend(x, y, items) {
  let cx = x;
  const out = [];
  for (const it of items) {
    out.push(rect(cx, y - 13, 16, 16, it.fill, { rx: 3 }));
    out.push(text(cx + 24, y, it.label, { size: 18, fill: INK2 }));
    cx += 24 + tw(it.label, 18) + 36;
  }
  return out.join("\n");
}
const wrap = (H, body) =>
  [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`, rect(0, 0, W, H, SURFACE), body, `</svg>`].join("\n");
const chf = (n) => `CHF ${Math.round(n).toLocaleString("en-US")}`;

// ---------- figure 1: live before and after ----------

function liveBeforeAfter() {
  const sum = (k, i) => LIVE.reduce((a, s) => a + s[k][i], 0);
  const total = LIVE.reduce((a, s) => a + s.no.reduce((x, y) => x + y, 0), 0);
  const h = header(
    ["Say yes once and the shop is known:", `${sum("no", 1)} questions become ${sum("yes", 1)} on the same ${total} purchases`],
    ["Seven live scenarios on Viseca's server, run twice. Top bar: every question answered no, nothing learned.",
     "Bottom bar: every question answered yes, so a shop approved once is known for the rest of the run."],
  );
  const parts = [h.svg];
  const legendY = h.bottom + 22;
  parts.push(legend(400, legendY, [{ fill: AQUA, label: "Approved" }, { fill: ORANGE, label: "Asked" }, { fill: BLUE, label: "Declined" }]));
  const x0 = 400, unit = 46, barH = 24, pairGap = 8, groupGap = 26;
  let y = legendY + 30;
  const fills = [AQUA, ORANGE, BLUE], names = ["approved", "asked", "declined"];
  const stack = (counts, y, passLabel) => {
    const out = [text(x0 - 130, y + barH / 2 + 6, passLabel, { size: 16, fill: INK2 })];
    let x = x0;
    const n = counts.reduce((a, b) => a + b, 0);
    counts.forEach((c, i) => {
      if (!c) return;
      const w = c * unit - 2;
      const last = counts.slice(i + 1).every((v) => v === 0);
      const title = `${c} of ${n} ${names[i]}`;
      out.push(last ? hbar(x, y, w, barH, fills[i], title) : rect(x, y, w, barH, fills[i], { title }));
      out.push(text(x + w / 2, y + barH / 2 + 5, String(c), { size: 15, weight: 600, fill: i === 2 ? "#ffffff" : INK, anchor: "middle" }));
      x += c * unit;
    });
    out.push(text(x0 + n * unit + 12, y + barH / 2 + 6, `${counts[1]} of ${n} asked`, { size: 18, fill: INK2 }));
    return out.join("");
  };
  for (const s of LIVE) {
    parts.push(text(x0 - 150, y + barH + pairGap / 2 + 7, s.name, { size: 21, weight: 600, anchor: "end" }));
    parts.push(stack(s.no, y, "Answered no"));
    parts.push(stack(s.yes, y + barH + pairGap, "Answered yes"));
    y += barH * 2 + pairGap + groupGap;
  }
  parts.push(vline(x0 - 1, legendY + 20, y - groupGap + 6, "#d9d8d3", 2));
  const pct = (k) => Math.round((sum(k, 1) / total) * 100);
  parts.push(text(40, y + 10, `All seven: ${sum("no", 1)} of ${total} asked (${pct("no")} %) when every question was answered no, ${sum("yes", 1)} of ${total} (${pct("yes")} %) when answered yes. Approved rose from ${sum("no", 0)} to ${sum("yes", 0)}.`, { size: 19, fill: INK2 }));
  return wrap(y + 46, parts.join("\n"));
}

// ---------- figure 2: what a plain limit misses, by kind of risk ----------

function limitVsEngineByKind() {
  const h = header(
    ["A spending limit sees only the amount.", "The engine catches all six kinds of risk; the limit, one."],
    ["The 28 risky purchases in Viseca's five public scenarios, grouped by why the reference refuses or asks."],
  );
  const parts = [h.svg];
  const legendY = h.bottom + 22;
  parts.push(legend(530, legendY, [{ fill: ORANGE, label: "Plain spending limit" }, { fill: BLUE, label: "Our engine" }, { fill: GRID, label: "Risky purchases of that kind" }]));
  const x0 = 530, unit = 56, barH = 20, pairGap = 6, groupGap = 22;
  let y = legendY + 30;
  for (const [kind, risky, limit, ours] of KINDS) {
    const track = risky * unit;
    parts.push(text(x0 - 30, y + barH + pairGap / 2 + 7, kind, { size: 20, weight: 600, anchor: "end" }));
    for (const [i, [n, fill, who]] of [[limit, ORANGE, "A plain limit"], [ours, BLUE, "Our engine"]].entries()) {
      const yy = y + i * (barH + pairGap);
      parts.push(rect(x0, yy, track, barH, GRID, { rx: 4 }));
      parts.push(hbar(x0, yy, n * unit, barH, fill, `${who} catches ${n} of ${risky}: ${kind}`));
      parts.push(text(x0 + track + 14, yy + barH / 2 + 6, `${n} of ${risky}`, { size: 18, fill: INK2 }));
    }
    y += barH * 2 + pairGap + groupGap;
  }
  parts.push(vline(x0 - 1, legendY + 20, y - groupGap + 6, "#d9d8d3", 2));
  return wrap(y + 16, parts.join("\n"));
}

// ---------- figure 3: money paid unchecked ----------

function moneyUnchecked() {
  const h = header(
    [`${chf(MONEY[1][1])} of risky purchases still go through with a plain limit.`, `${chf(MONEY[2][1])} with the engine.`],
    ["Risky amount paid unchecked, across the 28 risky purchases in Viseca's five public scenarios."],
  );
  const parts = [h.svg];
  const x0 = 300, maxW = 640, barH = 24, gap = 30, max = Math.max(...MONEY.map((m) => m[1]));
  let y = h.bottom + 30;
  for (const [name, amount, fill] of MONEY) {
    const w = Math.round((amount / max) * maxW);
    parts.push(text(x0 - 24, y + barH / 2 + 8, name, { size: 24, weight: 600, anchor: "end" }));
    parts.push(hbar(x0, y, w, barH, fill, `${name}: ${chf(amount)} paid unchecked`));
    parts.push(text(x0 + w + 14, y + barH / 2 + 8, chf(amount), { size: 24 }));
    y += barH + gap;
  }
  parts.push(vline(x0 - 1, h.bottom + 18, y - gap + 8, "#d9d8d3", 2));
  return wrap(y + 10, parts.join("\n"));
}

// ---------- figure 4: latency against the deadline, log scale ----------

function latencyVsDeadline() {
  const slowest = Math.max(...LATENCY.map((r) => r[1]));
  const h = header(
    [`The slowest live decision is ${Math.floor(DEADLINE / slowest)} times faster than the deadline.`, `The engine itself takes ${LATENCY[0][1]} ms.`],
    ["Milliseconds on a log scale. Engine rows: the replay and the load test.",
     "Live rows: measured on Viseca's server, request event to decision event, network both ways included."],
  );
  const parts = [h.svg];
  const x0 = 380, decade = 126, minExp = -2, maxExp = 4;
  const xOf = (v) => x0 + (Math.log10(v) - minExp) * decade;
  const top = h.bottom + 40, pitch = 50, bottom = top + LATENCY.length * pitch;
  for (let e = minExp; e <= maxExp; e++) {
    const v = 10 ** e, x = xOf(v);
    parts.push(vline(x, top - 16, bottom, GRID));
    const label = v >= 1000 ? v.toLocaleString("en-US") : String(v);
    parts.push(text(x, bottom + 26, e === minExp || e === maxExp ? `${label} ms` : label, { size: 16, fill: MUTED, anchor: "middle" }));
  }
  const dx = xOf(DEADLINE);
  parts.push(vline(dx, top - 16, bottom, INK2, 2));
  parts.push(text(dx - 10, top - 2, `Viseca's deadline, ${DEADLINE.toLocaleString("en-US")} ms`, { size: 16, weight: 600, fill: INK2, anchor: "end" }));
  LATENCY.forEach(([label, v], i) => {
    const y = top + i * pitch + pitch / 2 + 8, x = xOf(v);
    parts.push(text(x0 - 28, y + 6, label, { size: 20, anchor: "end" }));
    parts.push(hline(x0, x, y, GRID));
    parts.push(`<circle cx="${x}" cy="${y}" r="8" fill="${BLUE}" stroke="${SURFACE}" stroke-width="2"><title>${esc(label)}: ${v} ms</title></circle>`);
    parts.push(text(x + 18, y + 6, `${v} ms`, { size: 18, weight: 600 }));
  });
  return wrap(bottom + 50, parts.join("\n"));
}

// ---------- figure 5: why the engine asked ----------

function whyWeAsked() {
  const total = ASKED.reduce((a, r) => a + r[1], 0);
  const h = header(
    [`${ASKED[0][1]} of the ${total} questions were a first purchase at a shop.`, "One yes, and that shop never asks again in the run."],
    ["Why the engine asked: seven live scenarios on Viseca's server, every question answered yes."],
  );
  const parts = [h.svg];
  const x0 = 400, unit = 36, barH = 24, gap = 22;
  let y = h.bottom + 30;
  for (const [reason, n] of ASKED) {
    parts.push(text(x0 - 24, y + barH / 2 + 7, reason, { size: 21, weight: 600, anchor: "end" }));
    parts.push(hbar(x0, y, n * unit, barH, ORANGE, `${reason}: ${n} of ${total} questions`));
    parts.push(text(x0 + n * unit + 14, y + barH / 2 + 7, String(n), { size: 21 }));
    y += barH + gap;
  }
  parts.push(vline(x0 - 1, h.bottom + 18, y - gap + 8, "#d9d8d3", 2));
  return wrap(y + 10, parts.join("\n"));
}

// ---------- figure 6: Viseca's list, built or not ----------

const STATUS = {
  built: { tint: "rgba(12,163,12,0.10)", name: "Built" },
  partial: { tint: "rgba(250,178,25,0.16)", name: "Partial" },
  not: { tint: "#f0efec", name: "Not built" },
};
function statusIcon(cx, cy, status) {
  if (status === "built") return `<circle cx="${cx}" cy="${cy}" r="11" fill="${GOOD}"/><path d="M${cx - 5},${cy}l3.5,3.5l7,-7" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (status === "partial") return `<circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="${WARN}" stroke-width="2.5"/><path d="M${cx},${cy - 10}a10,10 0 0 0 0,20z" fill="${WARN}"/>`;
  return `<circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="${MUTED}" stroke-width="2"/><line x1="${cx - 5}" y1="${cy}" x2="${cx + 5}" y2="${cy}" stroke="${MUTED}" stroke-width="2.5" stroke-linecap="round"/>`;
}
function visecaList() {
  const all = LIST.flatMap(([, rows]) => rows.map((r) => r[1]));
  const count = (s) => all.filter((x) => x === s).length;
  const h = header(
    [`Viseca's list: ${count("built")} of ${all.length} rows built, ${count("partial")} partial, ${count("not")} not built on purpose`],
    ["Checked against the code on 25 September. Built: in the repo with a test or a live run. Partial: works, with a stated limit."],
  );
  const parts = [h.svg];
  const colW = 216, colGap = 12, tileH = 58, tileGap = 8, top = h.bottom + 56;
  LIST.forEach(([group, rows], c) => {
    const x = 40 + c * (colW + colGap);
    parts.push(text(x, top - 16, `${group} · ${rows.length}`, { size: 19, weight: 700 }));
    rows.forEach(([label, status], r) => {
      const y = top + r * (tileH + tileGap);
      parts.push(rect(x, y, colW, tileH, STATUS[status].tint, { rx: 6, title: `${label.replace("|", " ")}: ${STATUS[status].name}` }));
      parts.push(statusIcon(x + 22, y + tileH / 2, status));
      const ls = label.split("|");
      parts.push(lines(x + 42, y + tileH / 2 + (ls.length === 1 ? 5 : -4), label, 18, { size: 15 }));
    });
  });
  const rowsMax = Math.max(...LIST.map(([, rows]) => rows.length));
  const legendY = top + rowsMax * (tileH + tileGap) + 30;
  let lx = 40;
  for (const s of ["built", "partial", "not"]) {
    parts.push(statusIcon(lx + 11, legendY - 6, s));
    const label = `${STATUS[s].name} ${count(s)}`;
    parts.push(text(lx + 32, legendY, label, { size: 18, fill: INK2 }));
    lx += 32 + tw(label, 18) + 40;
  }
  parts.push(text(lx + 10, legendY, "Not built: no model runs in the decision path, and that is said as a strength.", { size: 16, fill: MUTED }));
  return wrap(legendY + 30, parts.join("\n"));
}

// ---------- figure 7: the 21 checks in five families ----------

function guardsByFamily() {
  const total = GUARDS.reduce((a, [, g]) => a + g.length, 0);
  const h = header(
    [`${total} checks in five families.`, "Every decision lists each one as pass, fail or unsure, with the fact."],
    ["Guards in the engine on 25 September: rules from the customer's words and built-in protections, grouped as the app shows them."],
  );
  const parts = [h.svg];
  const colW = 216, colGap = 12, tileH = 54, tileGap = 8, top = h.bottom + 76;
  GUARDS.forEach(([family, guards], c) => {
    const x = 40 + c * (colW + colGap);
    const fl = family.split("|");
    parts.push(lines(x, top - 40 - (fl.length - 1) * 22, family, 22, { size: 19, weight: 700 }));
    parts.push(text(x, top - 16, `${guards.length} ${guards.length === 1 ? "check" : "checks"}`, { size: 15, fill: INK2 }));
    guards.forEach((label, r) => {
      const y = top + r * (tileH + tileGap);
      parts.push(rect(x, y, colW, tileH, "rgba(42,120,214,0.10)", { rx: 6 }));
      parts.push(rect(x, y + 8, 4, tileH - 16, BLUE, { rx: 2 }));
      const ls = label.split("|");
      parts.push(lines(x + 18, y + tileH / 2 + (ls.length === 1 ? 5 : -4), label, 18, { size: 15 }));
    });
  });
  const rowsMax = Math.max(...GUARDS.map(([, g]) => g.length));
  return wrap(top + rowsMax * (tileH + tileGap) + 24, parts.join("\n"));
}

// ---------- figure 8: the numbers ----------

function numbers() {
  const h = header(["The numbers, measured 24 and 25 September"], ["Each one re-runs with a command: npm run replay, npm run compare, npm run jury-figures, npm test."]);
  const parts = [h.svg];
  const cols = 4, gap = 16, tileW = (W - 80 - (cols - 1) * gap) / cols, tileH = 132, top = h.bottom + 26;
  NUMBERS.forEach(([value, label], i) => {
    const x = 40 + (i % cols) * (tileW + gap), y = top + Math.floor(i / cols) * (tileH + gap);
    parts.push(rect(x, y, tileW, tileH, "#f9f9f7", { rx: 8, stroke: "rgba(11,11,11,0.10)" }));
    parts.push(text(x + 20, y + 58, value, { size: 44, weight: 600 }));
    parts.push(lines(x + 20, y + 90, label, 22, { size: 16, fill: INK2 }));
  });
  const rows = Math.ceil(NUMBERS.length / cols);
  return wrap(top + rows * (tileH + gap) + 16, parts.join("\n"));
}

// ---------- write ----------

const FIGURES = {
  "live-before-after.svg": liveBeforeAfter,
  "limit-vs-engine-by-kind.svg": limitVsEngineByKind,
  "money-unchecked.svg": moneyUnchecked,
  "latency-vs-deadline.svg": latencyVsDeadline,
  "why-we-asked.svg": whyWeAsked,
  "viseca-list-status.svg": visecaList,
  "guards-by-family.svg": guardsByFamily,
  "numbers.svg": numbers,
};
mkdirSync(OUT, { recursive: true });
for (const [name, fn] of Object.entries(FIGURES)) {
  writeFileSync(path.join(OUT, name), fn());
  console.log(`written: docs/pitch/${name}`);
}
