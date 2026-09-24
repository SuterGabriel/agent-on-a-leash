// Offline review of live decisions: groups what we answered live by reason, and re-decides every purchase with the
// CURRENT engine, from the copy saved by npm run api-atlas (data/live/atlas/). Makes no request at all.
//   npm run live-review -- <runId> [<runId> ...]      (no ids: every run in the saved copy)
// Customer answers are replayed as they happened live: an answered ask was declined (--answer decline),
// an unanswered one expired. Writes reports/live-review.md (git-ignored).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "csv-parse/sync";
import type { AuthorizationEvent, EngineVerdict } from "@leash/shared";
import { loadConfig } from "../config.js";
import { LeashEngine } from "../engine/leashEngine.js";
import { LeashBus, type StoredDecision } from "../store.js";
import { buildBaselines } from "../../../shared/src/baselines.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

const cfg = loadConfig({ mode: "live" });
const atlas = resolve(cfg.dataDir, "live", "atlas");
if (!existsSync(join(atlas, "reference-data.json"))) throw new Error("No saved copy: run npm run api-atlas first (GET only).");
const read = (f: string) => JSON.parse(readFileSync(join(atlas, f), "utf8"));
const pages = (prefix: string) => readdirSync(atlas).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort();
const events: Rec[] = pages("events-page-").flatMap((f) => read(f).events ?? []);
const auths: Rec[] = pages("authorizations-page-").flatMap((f) => read(f));
const tables = read("reference-data.json").tables;
const history = parse(readFileSync(join(atlas, "authorization-history.csv"), "utf8"), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
const strRows = (rows: Rec[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? "" : String(v)])));
const baselines = buildBaselines(history, new Map(strRows(tables.merchants).map((m) => [m.merchant_id ?? "", m])), {
  cards: strRows(tables.cards),
  accounts: strRows(tables.accounts),
});

const allRuns = [...new Set(events.map((e) => e.run_id).filter(Boolean))] as string[];
const argRuns = process.argv.slice(2).filter((a) => a.startsWith("run_"));
const runIds = argRuns.length ? argRuns : allRuns;

// What we answered live (first team decision per purchase) and how it ended.
const live = new Map<string, Rec>();
for (const e of events) if (e.type === "authorization.decision" && e.data?.decision_source === "team" && !live.has(e.authorization_id)) live.set(e.authorization_id, e.data);
const final = new Map(auths.map((a) => [a.authorization_id, a]));

// Re-decide, run by run, in delivery order, with a fresh engine per run.
interface Row { scenario: string; source: string; shop: string; items: string; chf: number; old: Rec | undefined; now: EngineVerdict }
const rows: Row[] = [];
for (const runId of runIds) {
  const bus = new LeashBus();
  const engine = new LeashEngine(bus, baselines);
  for (const e of events.filter((x) => x.run_id === runId && x.type === "authorization.request")) {
    const ev = e.data as AuthorizationEvent;
    const a = ev.authorization;
    const now = engine.decide(ev, { runId, currentMandate: null });
    rows.push({
      scenario: a.scenario_id,
      source: a.source_authorization_id,
      shop: `${a.merchant.merchant_name} (${a.merchant.merchant_city}, ${a.merchant.merchant_country})`,
      items: a.items.map((i) => `${i.item_name} ×${i.quantity} (${i.item_category})`).join("; "),
      chf: a.billing_amount_chf,
      old: live.get(a.authorization_id),
      now,
    });
    if (now.decision === "step_up") {
      // Replay the live answer: answered asks were declined; unanswered ones expired.
      const f = final.get(a.authorization_id);
      const stub = { id: a.authorization_id, run_id: runId, status: "declined_by_you" } as StoredDecision;
      if (f?.decision_source === "timeout") bus.emit("ask_expired", stub);
      else bus.emit("decision", stub);
    }
  }
}

// ---- report
const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const reasons = (v: unknown) => (Array.isArray(v) ? v.join(", ") : "");
const tally = (rs: Row[], pick: (r: Row) => string | undefined) => {
  const c: Record<string, number> = { approve: 0, step_up: 0, decline: 0 };
  for (const r of rs) {
    const d = pick(r);
    if (d) c[d] = (c[d] ?? 0) + 1;
  }
  return `${c.approve} aprobadas · ${c.step_up} preguntadas · ${c.decline} rechazadas`;
};
const onlyHistory = (r: Row) => r.old?.decision === "step_up" && Array.isArray(r.old.reason_codes) && r.old.reason_codes.length === 1 && r.old.reason_codes[0] === "no_shop_history";

const L: string[] = [];
L.push("# Revisión de las decisiones en vivo", "");
L.push(
  `${rows.length} compras de ${runIds.length} ejecuciones, releídas desde la copia local (\`data/live/atlas/\`, descargada con GET). ` +
    "«Antes» = lo que contestamos en vivo. «Ahora» = lo que decide el engine actual, en modo offline, con los arreglos de lookalike (nombre idéntico = misma marca) y de viajes (destino, noches). " +
    "Las respuestas del cliente se repiten como pasaron en vivo: las preguntas contestadas, rechazadas; las no contestadas, vencidas.",
  "",
);
L.push("| | Aprobadas | Preguntadas | Rechazadas |", "| --- | --- | --- | --- |");
const count = (rs: Row[], pick: (r: Row) => string | undefined, d: string) => rs.filter((r) => pick(r) === d).length;
for (const [label, pick] of [["Antes (en vivo)", (r: Row) => r.old?.decision], ["Ahora (offline)", (r: Row) => r.now.decision]] as const) {
  L.push(`| ${label} | ${count(rows, pick, "approve")} | ${count(rows, pick, "step_up")} | ${count(rows, pick, "decline")} |`);
}
const changed = rows.filter((r) => r.old?.decision !== r.now.decision);
L.push("", `**Cambian de decisión: ${changed.length}.**`, "");
if (changed.length) {
  L.push("| Escenario | Compra | Tienda | CHF | Antes | Ahora | Motivos ahora |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of changed) L.push(`| ${r.scenario} | ${r.source} | ${esc(r.shop)} | ${r.chf.toFixed(2)} | ${r.old?.decision ?? "—"} (${esc(reasons(r.old?.reason_codes))}) | ${r.now.decision} | ${esc(r.now.reason_codes.join(", "))} |`);
}

const section = (title: string, intro: string, rs: Row[]) => {
  L.push("", `## ${title}`, "", intro, "");
  const groups = new Map<string, Row[]>();
  for (const r of rs) {
    const lead = (Array.isArray(r.old?.reason_codes) && r.old?.reason_codes[0]) || "(sin respuesta registrada)";
    groups.set(lead, [...(groups.get(lead) ?? []), r]);
  }
  for (const [lead, g] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    L.push(`### \`${lead}\`: ${g.length} compra(s)`, "");
    L.push(`- **Antes:** ${tally(g, (r) => r.old?.decision)}`);
    L.push(`- **Ahora:** ${tally(g, (r) => r.now.decision)}`);
    L.push("");
    L.push("| Escenario | Compra | Tienda | Artículos | CHF | Antes: mensaje | Ahora |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const r of g.slice(0, 2)) {
      L.push(`| ${r.scenario} | ${r.source} | ${esc(r.shop)} | ${esc(r.items)} | ${r.chf.toFixed(2)} | ${r.old?.decision ?? "—"}: ${esc(r.old?.customer_message)} | **${r.now.decision}** (${esc(r.now.reason_codes.join(", "))}): ${esc(r.now.because)} |`);
    }
    L.push("");
  }
};
section(
  "Preguntan SOLO por falta de historial",
  `En vivo preguntamos únicamente porque el cliente no tiene historial (\`no_shop_history\` era el único motivo). Todo lo demás pasaba. Estas compras se aprobarían si supiéramos que la tienda es conocida.`,
  rows.filter(onlyHistory),
);
section("Todas las demás, agrupadas por motivo principal", "Motivo principal = el primer motivo de nuestra respuesta en vivo (el más estricto).", rows.filter((r) => !onlyHistory(r)));

const out = resolve(cfg.dataDir, "..", "reports", "live-review.md");
mkdirSync(resolve(out, ".."), { recursive: true });
writeFileSync(out, L.join("\n") + "\n");
console.log(`${rows.length} purchases · changed ${changed.length} · only-history asks ${rows.filter(onlyHistory).length}\nreport: ${out}`);
