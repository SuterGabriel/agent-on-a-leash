// Builds reports/live-results.md from the live API (GET only): every purchase of the given runs with our decision,
// reasons and message, and ⚠️ on the debatable ones. reports/ is git-ignored.
//   npm run live-results -- <runId> [<runId> ...]
// Run ids are printed by npm run scenario -- <SCEN> --live, and listed in reports/api-atlas.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../config.js";

const runIds = process.argv.slice(2).filter((a) => a.startsWith("run_"));
if (!runIds.length) throw new Error("usage: npm run live-results -- <runId> [<runId> ...]");
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
const auths: Rec[] = await get("/v1/authorizations");
const events: Rec[] = [];
for (let since = 0; ; ) {
  const page = await get(`/v1/events?since=${since}`);
  events.push(...page.events);
  if (!page.events.length || page.next_cursor === since) break;
  since = page.next_cursor;
}
const ours = new Map<string, Rec>();
for (const e of events) if (e.type === "authorization.decision" && e.data?.decision_source === "team" && !ours.has(e.authorization_id)) ours.set(e.authorization_id, e.data);
const catalogue: Rec[] = (await get("/v1/reference-data")).tables.scenario_catalogue;
const order = catalogue.map((s) => s.scenario_id);

const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const rows = auths
  .filter((a) => runIds.includes(a.run_id))
  .sort((a, b) => order.indexOf(a.scenario_id) - order.indexOf(b.scenario_id) || a.authorization.replay_order - b.authorization.replay_order);

/** Why a decision is debatable. Empty = not flagged. */
function flags(a: Rec, d: Rec | undefined): string[] {
  const out: string[] = [];
  const rc: string[] = d?.reason_codes ?? [];
  const facts = (d?.evidence ?? []).map((e: Rec) => `${e.key} ${e.fact}`).join(" ");
  if (!d) out.push("no hay respuesta nuestra registrada");
  if (rc.includes("no_shop_history")) out.push("sin historial del cliente: no sabemos si conoce la tienda");
  if (rc.includes("missing_info")) out.push("falta un dato de la tienda; preguntamos");
  if (rc.includes("rule_not_applied") || rc.includes("guard_error") || rc.includes("engine_error") || rc.includes("engine_timeout")) out.push("fallo o regla no evaluada");
  if (rc.includes("lookalike_shop") && /established shop/.test(d?.customer_message ?? "")) out.push("imitadora detectada solo por parecido con otra tienda del emisor");
  if (rc.includes("blocked_item") && /item_details/.test(facts)) out.push("bloqueada por una palabra en el texto de la tienda");
  if (rc.includes("over_unit_limit")) out.push("límite por unidad: depende de cómo la tienda reparte las unidades");
  if (rc.includes("session_not_you")) out.push("sesión juzgada con historial escaso o nulo");
  if (rc.includes("item_outside_purpose") && a.authorization.items.every((i: Rec) => ["household", "groceries"].includes(i.item_category))) out.push("categoría límite");
  if (a.decision_source === "timeout") out.push("nadie contestó a tiempo");
  return out;
}

const L: string[] = [];
L.push("# Resultados en vivo", "");
L.push(`Ejecuciones: ${runIds.join(", ")}. Las preguntas al cliente se contestaron como se indicó al correr cada escenario (\`--answer\`); si nadie contestó, Viseca las cerró por timeout.`, "");
const count = (d: string) => rows.filter((a) => ours.get(a.authorization_id)?.decision === d).length;
const flagged = rows.filter((a) => flags(a, ours.get(a.authorization_id)).length);
L.push(`**${rows.length} compras** · aprobadas ${count("approve")} · preguntadas ${count("step_up")} · rechazadas ${count("decline")} · ⚠️ discutibles ${flagged.length}`, "");
L.push("| | Escenario | Compra | Tienda | Artículos | CHF | Decisión | Motivos | Mensaje |");
L.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const a of rows) {
  const d = ours.get(a.authorization_id);
  const au = a.authorization;
  const items = au.items.map((i: Rec) => `${i.item_name} ×${i.quantity} (${i.item_category}, ${i.currency} ${i.unit_price})`).join("; ");
  const f = flags(a, d);
  L.push(`| ${f.length ? "⚠️" : ""} | ${a.scenario_id} | ${au.source_authorization_id} | ${esc(au.merchant.merchant_name)} (${au.merchant.merchant_country}) | ${esc(items)} | ${Number(au.billing_amount_chf).toFixed(2)} | ${d?.decision ?? "—"} | ${esc((d?.reason_codes ?? []).join(", "))} | ${esc(d?.customer_message)} |`);
}
L.push("", "## Por qué están marcadas ⚠️", "");
for (const a of flagged) L.push(`- **${a.authorization.source_authorization_id}** (${a.scenario_id}): ${flags(a, ours.get(a.authorization_id)).join("; ")}.`);
L.push("", "## Por escenario", "");
L.push("| Escenario | Compras | Aprobadas | Preguntadas | Rechazadas | ⚠️ | Deadline perdido |", "| --- | --- | --- | --- | --- | --- | --- |");
for (const s of order) {
  const rs = rows.filter((a) => a.scenario_id === s);
  const c = (d: string) => rs.filter((a) => ours.get(a.authorization_id)?.decision === d).length;
  L.push(`| ${s} | ${rs.length} | ${c("approve")} | ${c("step_up")} | ${c("decline")} | ${rs.filter((a) => flags(a, ours.get(a.authorization_id)).length).length} | ${rs.filter((a) => a.decision?.deadline_missed || a.decision_source === "platform").length} |`);
}
mkdirSync(join(root, "reports"), { recursive: true });
writeFileSync(join(root, "reports/live-results.md"), L.join("\n") + "\n");
console.log(`rows ${rows.length} · flagged ${flagged.length}`);
