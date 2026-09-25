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
import { MemoryStore } from "../memory/memoryStore.js";
import { PeerIndex } from "../coldstart/peers.js";

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

// Customers like you (cold start) from the same saved reference data.
const peers = new PeerIndex({ customers: tables.customers ?? [], accounts: tables.accounts ?? [], cards: tables.cards ?? [], history });

// An ask the customer would plausibly say yes to: it asked only because we had no history (nothing broke a rule).
const HISTORY_ONLY = new Set(["no_shop_history", "no_session_history", "missing_info"]);
const onlyHistoryAsk = (v: EngineVerdict) => v.decision === "step_up" && v.reason_codes.length > 0 && v.reason_codes.every((r) => HISTORY_ONLY.has(r)) && !v.checks.some((c) => c.result === "fail");

// Re-decide, run by run, in delivery order, with a fresh engine per run and one memory for the whole review.
// "live": answers as they happened live. "learn": the customer says yes to asks that were only about missing history
// (and no to everything else), and the card learns from each yes (memory), like the backend does.
interface Row { scenario: string; source: string; shop: string; items: string; chf: number; old: Rec | undefined; now: EngineVerdict }
function pass(mode: "live" | "learn"): Row[] {
  const out: Row[] = [];
  const memory = new MemoryStore();
  for (const runId of runIds) {
    const bus = new LeashBus();
    const engine = new LeashEngine(bus, baselines);
    engine.useMemory(memory.lookup);
    engine.usePeers(peers.lookup);
    for (const e of events.filter((x) => x.run_id === runId && x.type === "authorization.request")) {
      const ev = e.data as AuthorizationEvent;
      const a = ev.authorization;
      const now = engine.decide(ev, { runId, currentMandate: null });
      out.push({
        scenario: a.scenario_id,
        source: a.source_authorization_id,
        shop: `${a.merchant.merchant_name} (${a.merchant.merchant_city}, ${a.merchant.merchant_country})`,
        items: a.items.map((i) => `${i.item_name} ×${i.quantity} (${i.item_category})`).join("; "),
        chf: a.billing_amount_chf,
        old: live.get(a.authorization_id),
        now,
      });
      if (now.decision !== "step_up") continue;
      const stub = { id: a.authorization_id, run_id: runId, status: "declined_by_you" } as StoredDecision;
      if (mode === "learn" && onlyHistoryAsk(now)) {
        bus.emit("decision", { ...stub, status: "approved_by_you" } as StoredDecision);
        memory.learnFromApproval({ id: a.authorization_id, customer_id: ev.mandate.customer_id, card_id: a.card_id, device_id: a.customer_device_id, merchant: { id: a.merchant.merchant_id, name: a.merchant.merchant_name, country: a.merchant.merchant_country }, purchased_at: a.timestamp });
      } else if (mode === "live" && final.get(a.authorization_id)?.decision_source === "timeout") bus.emit("ask_expired", stub);
      else bus.emit("decision", stub);
    }
  }
  return out;
}
const rows = pass("live");
const learnRows = pass("learn");

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

L.push("", "## Con aprendizaje: el cliente dice sí a lo que solo preguntaba por falta de historial", "");
L.push("Mismas compras, mismo engine. «Hoy (respuestas en vivo)» = las preguntas se contestan como en vivo. «Hoy (aprendiendo)» = el cliente aprueba las preguntas que eran solo por falta de historial (ninguna regla rota) y la tarjeta aprende de cada sí (memoria), como hace el backend. Las demás se rechazan.", "");
L.push("| Escenario | Compras | Preguntadas en vivo | Preguntadas hoy (respuestas en vivo) | Preguntadas hoy (aprendiendo) | Aprobadas hoy (aprendiendo) | Rechazadas hoy (aprendiendo) |", "| --- | --- | --- | --- | --- | --- | --- |");
const scen = [...new Set(rows.map((r) => r.scenario))];
const cnt = (rs: Row[], f: (r: Row) => boolean) => rs.filter(f).length;
for (const sc of [...scen, "TOTAL"]) {
  const a = sc === "TOTAL" ? rows : rows.filter((r) => r.scenario === sc);
  const b = sc === "TOTAL" ? learnRows : learnRows.filter((r) => r.scenario === sc);
  L.push(`| ${sc === "TOTAL" ? "**TOTAL**" : sc} | ${a.length} | ${cnt(a, (r) => r.old?.decision === "step_up")} | ${cnt(a, (r) => r.now.decision === "step_up")} | ${cnt(b, (r) => r.now.decision === "step_up")} | ${cnt(b, (r) => r.now.decision === "approve")} | ${cnt(b, (r) => r.now.decision === "decline")} |`);
}
const flipped = learnRows.filter((r, i) => rows[i] && rows[i]!.now.decision !== "approve" && r.now.decision === "approve");
L.push("", `Compras que pasan a aprobarse gracias a lo aprendido: **${flipped.length}**. Ninguna pasa de rechazo a aprobación sin una respuesta del cliente de por medio.`);
const wrongFlip = learnRows.filter((r, i) => rows[i]?.now.decision === "decline" && r.now.decision === "approve");
L.push(`Rechazos que pasan a aprobación: **${wrongFlip.length}** (debe ser 0).`, "");
// Why the remaining asks still ask (learning mode): first time at a shop, or a real rule.
const why = new Map<string, number>();
for (const r of learnRows.filter((x) => x.now.decision === "step_up")) why.set(r.now.reason_codes.join(" + "), (why.get(r.now.reason_codes.join(" + ")) ?? 0) + 1);
L.push("### Por qué siguen preguntando (aprendiendo)", "", "| Motivos | Compras |", "| --- | --- |");
for (const [k, n] of [...why.entries()].sort((a, b) => b[1] - a[1])) L.push(`| ${esc(k)} | ${n} |`);
L.push("");
const out = resolve(cfg.dataDir, "..", "reports", "live-review.md");
mkdirSync(resolve(out, ".."), { recursive: true });
writeFileSync(out, L.join("\n") + "\n");
console.log(`${rows.length} purchases · changed ${changed.length} · only-history asks ${rows.filter(onlyHistory).length} · asks now ${rows.filter((r) => r.now.decision === "step_up").length} → with learning ${learnRows.filter((r) => r.now.decision === "step_up").length}\nreport: ${out}`);
