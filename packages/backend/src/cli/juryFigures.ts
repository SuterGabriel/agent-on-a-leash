// Jury figures from Viseca's own records (GET only): the latest completed run of every live scenario, or the runs given.
//   npm run jury-figures                       latest run per scenario
//   npm run jury-figures -- run_a run_b        those runs
//   --answered approve|decline   how the operator answered the asks (text only); --out <name>   file name under docs/pitch/
// Writes docs/pitch/live-figures.md (aggregates only, safe to commit) and reports/jury-figures.md (every purchase, git-ignored).
// Timing comes from the platform's event log: authorization.request → our authorization.decision, so it includes the network.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../config.js";

const cfg = loadConfig({ mode: "live" });
if (!cfg.teamApiKey) throw new Error("TEAM_API_KEY is not set (see .env.example)");
const root = resolve(cfg.dataDir, "..");
const get = async (p: string) => {
  const r = await fetch(cfg.baseUrl + p, { method: "GET", headers: { Authorization: `Bearer ${cfg.teamApiKey}` } });
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`);
  return r.json();
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

const argv = process.argv.slice(2);
const wanted = argv.filter((a) => a.startsWith("run_"));
const answered = argv[argv.indexOf("--answered") + 1] === "approve" ? "approve" : "decline";
const outName = argv.indexOf("--out") >= 0 ? argv[argv.indexOf("--out") + 1]! : "live-figures";
const auths: Rec[] = await get("/v1/authorizations");
const events: Rec[] = [];
for (let since = 0; ; ) {
  const page = await get(`/v1/events?since=${since}`);
  events.push(...page.events);
  if (!page.events.length || page.next_cursor === since) break;
  since = page.next_cursor;
}
const catalogue: Rec[] = (await get("/v1/reference-data")).tables.scenario_catalogue;
const scenarioName = new Map(catalogue.map((s) => [s.scenario_id, s.scenario_name]));

// The runs to score: given, or the latest run per scenario that reached scenario.completed.
const completed = new Map<string, string>(); // run_id -> completed_at
for (const e of events) if (e.type === "scenario.completed") completed.set(e.run_id, e.occurred_at);
let runIds: string[];
if (wanted.length) runIds = wanted;
else {
  const latest = new Map<string, { run_id: string; at: string }>();
  for (const a of auths) {
    const at = completed.get(a.run_id);
    if (!at) continue;
    const cur = latest.get(a.scenario_id);
    if (!cur || at > cur.at) latest.set(a.scenario_id, { run_id: a.run_id, at });
  }
  runIds = [...latest.values()].map((l) => l.run_id);
}
const rows = auths.filter((a) => runIds.includes(a.run_id)).sort((a, b) => String(a.scenario_id).localeCompare(b.scenario_id) || a.authorization.replay_order - b.authorization.replay_order);

// Our first decision per purchase and its timing against the request.
const requestAt = new Map<string, { at: number; deadline: number }>();
const ourDecision = new Map<string, { at: number; decision: string; reasons: string[] }>();
for (const e of events) {
  if (e.type === "authorization.request") requestAt.set(e.authorization_id, { at: Date.parse(e.occurred_at), deadline: Date.parse(e.data.deadline_at) });
  if (e.type === "authorization.decision" && e.data?.decision_source === "team" && !ourDecision.has(e.authorization_id)) {
    ourDecision.set(e.authorization_id, { at: Date.parse(e.occurred_at), decision: e.data.decision, reasons: e.data.reason_codes ?? [] });
  }
}

interface Scored { a: Rec; ours: string; reasons: string[]; ms: number | null; missed: boolean; final: string; source: string }
const scored: Scored[] = rows.map((a) => {
  const req = requestAt.get(a.authorization_id);
  const d = ourDecision.get(a.authorization_id);
  const ms = req && d ? d.at - req.at : null;
  const missed = !d || (req ? d.at > req.deadline : false);
  return { a, ours: d?.decision ?? "none", reasons: d?.reasons ?? [], ms, missed, final: a.status, source: a.decision_source };
});

const median = (xs: number[]) => (xs.length ? xs.sort((x, y) => x - y)[Math.floor((xs.length - 1) / 2)]! : null);
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 1000) / 10} %` : "—");
const count = (xs: Scored[], d: string) => xs.filter((s) => s.ours === d).length;
const fmtMs = (ms: number | null) => (ms === null ? "—" : `${Math.round(ms)} ms`);

function summary(xs: Scored[]) {
  const ms = xs.flatMap((s) => (s.ms === null ? [] : [s.ms]));
  return {
    purchases: xs.length,
    approve: count(xs, "approve"),
    step_up: count(xs, "step_up"),
    decline: count(xs, "decline"),
    missed: xs.filter((s) => s.missed).length,
    median_ms: median(ms),
    max_ms: ms.length ? Math.max(...ms) : null,
    timeouts: xs.filter((s) => s.source === "timeout").length,
  };
}

const all = summary(scored);
const day = new Date().toLocaleDateString("en-CA");
const scenarios = [...new Set(scored.map((s) => s.a.scenario_id as string))];

const agg: string[] = [
  "# Live figures from Viseca's server",
  "",
  `Generated by \`npm run jury-figures\` on ${day} from \`GET /v1/authorizations\` and \`GET /v1/events\`. The runs listed at the end, one per scenario. Timing is request event to our decision event on the platform's clock, so it includes the network both ways. Every question was answered by the operator with **${answered}**${answered === "approve" ? ", so a shop approved once is known for the rest of the run" : ", so the engine never learns a shop within the run"}; a question nobody answered would expire on the platform after 120 s.`,
  "",
  "| Figure | Value |",
  "|---|---|",
  `| Scenarios · purchases | ${scenarios.length} · ${all.purchases} |`,
  `| Approved · asked · declined | ${all.approve} · ${all.step_up} · ${all.decline} |`,
  `| Share asked | ${pct(all.step_up, all.purchases)} |`,
  `| Decisions after the 8 s deadline | ${all.missed} |`,
  `| Median request → decision, including network | ${fmtMs(all.median_ms)} |`,
  `| Slowest | ${fmtMs(all.max_ms)} |`,
  "",
  "Whether a decision matched Viseca's expected one is on the jury screen only; the API does not return it.",
  "",
  "## Per scenario",
  "",
  "| Scenario | Purchases | Approved | Asked | Declined | Missed deadline | Median |",
  "|---|---|---|---|---|---|---|",
  ...scenarios.map((id) => {
    const s = summary(scored.filter((x) => x.a.scenario_id === id));
    return `| ${id} ${scenarioName.get(id) ?? ""} | ${s.purchases} | ${s.approve} | ${s.step_up} | ${s.decline} | ${s.missed} | ${fmtMs(s.median_ms)} |`;
  }),
  "",
  "## Why we asked",
  "",
  "| Reason | Questions |",
  "|---|---|",
  ...Object.entries(
    scored.filter((s) => s.ours === "step_up").reduce<Record<string, number>>((m, s) => ((m[s.reasons[0] ?? "?"] = (m[s.reasons[0] ?? "?"] ?? 0) + 1), m), {}),
  )
    .sort((x, y) => y[1] - x[1])
    .map(([r, n]) => `| ${r} | ${n} |`),
  "",
  `Runs: ${runIds.join(", ")}`,
  "",
];

const full: string[] = [
  ...agg,
  "## Every purchase",
  "",
  "| Scenario | # | Shop | CHF | Ours | Reasons | Final on the platform | ms |",
  "|---|---|---|---|---|---|---|---|",
  ...scored.map(({ a, ours, reasons, final, ms }) => `| ${a.scenario_id} | ${a.authorization.replay_order} | ${String(a.authorization.merchant.merchant_name).replace(/\|/g, "/")} | ${Number(a.authorization.billing_amount_chf).toFixed(2)} | ${ours} | ${reasons.join(", ")} | ${final} | ${fmtMs(ms)} |`),
  "",
];

mkdirSync(join(root, "docs", "pitch"), { recursive: true });
mkdirSync(join(root, "reports"), { recursive: true });
writeFileSync(join(root, "docs", "pitch", `${outName}.md`), agg.join("\n"));
writeFileSync(join(root, "reports", `${outName}-full.md`), full.join("\n"));
console.log(`${scenarios.length} scenarios · ${all.purchases} purchases · approve ${all.approve} · ask ${all.step_up} · decline ${all.decline} · missed ${all.missed} · median ${fmtMs(all.median_ms)}`);
console.log(`written: docs/pitch/${outName}.md and reports/${outName}-full.md`);
