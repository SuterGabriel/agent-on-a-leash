// Turns what npm run api-atlas downloaded into reports/api-atlas.md, written for a non-technical reader.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "csv-parse/sync";

export interface CallRecord {
  path: string;
  status: number;
  bytes: number;
  file: string;
}

export interface Atlas {
  fetchedAt: string;
  baseUrl: string;
  calls: CallRecord[];
  healthz: unknown;
  bootstrap: unknown;
  referenceData: unknown;
  historyCsv: string;
  authorizations: Record<string, unknown>[];
  events: Record<string, unknown>[];
  runs: Record<string, unknown>[];
  mandates: Record<string, unknown>[];
}

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);
const str = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const cell = (v: unknown): string => str(v).replace(/\|/g, "\\|").replace(/\n/g, " ") || "—";
const fieldsOf = (rows: Rec[]): string[] => [...new Set(rows.flatMap((r) => Object.keys(r)))];
const table = (head: string[], rows: unknown[][]): string =>
  [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");

/** One sentence per endpoint, in plain words. */
const WHAT: Record<string, string> = {
  "/healthz": "Si el servidor de Viseca está encendido, y qué versión de datos usa.",
  "/v1/bootstrap": "La presentación del equipo: límites de tiempo, la lista de escenarios en vivo y un perfil de cliente de ejemplo.",
  "/v1/reference-data": "Los catálogos fijos: clientes, cuentas, tarjetas, tiendas, artículos, tipos de cambio y escenarios.",
  "/v1/reference-data/authorization-history.csv": "El historial de compras pasadas (quién compró qué, dónde y cuándo), en una tabla.",
  "/v1/authorizations": "Todas las compras que nuestras ejecuciones ya generaron, con la decisión final de cada una.",
  "/v1/events": "El diario de todo lo que pasó con nuestra llave: compras pedidas, decisiones y ejecuciones terminadas.",
  "/v1/scenario-runs/{id}": "El resumen de una ejecución: qué escenario, qué mandato, qué cliente y cuántas compras.",
  "/v1/mandates/{id}": "Un mandato (las reglas del cliente) tal como Viseca lo guardó.",
  "/docs": "Documentación interactiva, si existiera.",
  "/openapi.json": "La descripción técnica completa de la API, si existiera.",
  "/v1": "Una página índice de la API, si existiera.",
  "/v1/mandates": "¿Se pueden listar todos los mandatos?",
  "/v1/scenario-runs": "¿Se pueden listar todas las ejecuciones?",
};

function genericPath(path: string): string {
  const p = path.split("?")[0] ?? path;
  if (p.startsWith("/v1/scenario-runs/")) return "/v1/scenario-runs/{id}";
  if (p.startsWith("/v1/mandates/")) return "/v1/mandates/{id}";
  return p;
}

function readLocalIds(dataDir: string, file: string, key: string): Set<string> {
  const path = join(dataDir, file);
  if (!existsSync(path)) return new Set();
  return new Set((parse(readFileSync(path, "utf8"), { columns: true, skip_empty_lines: true }) as Rec[]).map((r) => str(r[key])));
}

export function writeAtlasReport(a: Atlas, reportPath: string, dataDir = join(dirname(reportPath), "..", "data")): void {
  const rd = obj(a.referenceData);
  const t = obj(rd.tables);
  const customers = arr(t.customers);
  const accounts = arr(t.accounts);
  const cards = arr(t.cards);
  const merchants = arr(t.merchants);
  const items = arr(t.items);
  const scenarios = arr(t.scenario_catalogue);
  const history = parse(a.historyCsv, { columns: true, skip_empty_lines: true }) as Rec[];
  const boot = obj(a.bootstrap);

  const inHistory = (key: string) => new Set(history.map((r) => str(r[key])));
  const histCustomers = inHistory("customer_id");
  const histCards = inHistory("card_id");
  const histAccounts = inHistory("account_id");
  const histMerchants = inHistory("merchant_id");
  const localItems = readLocalIds(dataDir, "items.csv", "item_id");

  const split = (rows: Rec[], key: string, known: Set<string>) => ({
    old: rows.filter((r) => known.has(str(r[key]))),
    new: rows.filter((r) => !known.has(str(r[key]))),
  });
  const cust = split(customers, "customer_id", histCustomers);
  const acc = split(accounts, "account_id", histAccounts);
  const crd = split(cards, "card_id", histCards);
  const mer = split(merchants, "merchant_id", histMerchants);
  const itm = split(items, "item_id", localItems);

  // Who each live scenario is about: the bootstrap profile, and fixture_profiles of every run we can see.
  const profileOf = new Map<string, { customer: string; card: string; source: string }>();
  const bp = obj(boot.profile);
  const bpc = obj(bp.profile_context);
  if (bp.scenario_id) profileOf.set(str(bp.scenario_id), { customer: str(bpc.customer_id), card: str(bpc.card_id), source: "bootstrap" });
  for (const r of [...a.runs, ...a.events.filter((e) => e.type === "scenario.completed").map((e) => obj(e.data))]) {
    const fp = arr(r.fixture_profiles)[0];
    if (fp && r.scenario_id && !profileOf.has(str(r.scenario_id))) {
      profileOf.set(str(r.scenario_id), { customer: str(fp.customer_id), card: str(fp.card_id), source: "ejecución" });
    }
  }

  // Shops seen in live purchases.
  const liveShops = new Map<string, Rec>();
  for (const e of a.events) {
    const m = obj(obj(obj(e.data).authorization).merchant);
    if (m.merchant_id) liveShops.set(str(m.merchant_id), m);
  }
  for (const au of a.authorizations) {
    const m = obj(obj(au.authorization).merchant);
    if (m.merchant_id) liveShops.set(str(m.merchant_id), m);
  }

  const L: string[] = [];
  const h = (s: string) => L.push("", s, "");
  L.push("# Atlas de la API de Viseca");
  L.push("");
  L.push(`Todo lo que la API deja leer con la llave de nuestro equipo, descargado el ${a.fetchedAt.replace("T", " ").slice(0, 16)} UTC.`);
  L.push(
    `Versión de los datos: **${cell(obj(a.healthz).pack_version)}** · versión de la API: ${cell(obj(a.healthz).api_version)} · equipo: ${cell(boot.team_id)}. ` +
      "Solo se hicieron lecturas: no se creó ningún mandato, no se inició ninguna ejecución y no se borró nada. Los archivos originales están en `data/live/atlas/`.",
  );

  // ---- Map
  h("## 1. Mapa de la API");
  L.push("Cada dirección que consultamos, qué devuelve, cuántos registros trae y qué campos tiene.");
  L.push("");
  const byGeneric = new Map<string, CallRecord[]>();
  for (const c of a.calls) byGeneric.set(genericPath(c.path), [...(byGeneric.get(genericPath(c.path)) ?? []), c]);
  const countAndFields = (g: string): [string, string] => {
    switch (g) {
      case "/healthz":
        return ["1", Object.keys(obj(a.healthz)).join(", ")];
      case "/v1/bootstrap":
        return [`${arr(boot.scenarios).length} escenarios, 1 perfil`, Object.keys(boot).join(", ")];
      case "/v1/reference-data":
        return [Object.entries(t).map(([k, v]) => `${k}: ${arr(v).length}`).join(", "), Object.keys(rd).join(", ")];
      case "/v1/reference-data/authorization-history.csv":
        return [`${history.length} filas`, fieldsOf(history.slice(0, 1)).join(", ")];
      case "/v1/authorizations":
        return [`${a.authorizations.length}`, fieldsOf(a.authorizations).join(", ")];
      case "/v1/events":
        return [`${a.events.length}`, fieldsOf(a.events).join(", ")];
      case "/v1/scenario-runs/{id}":
        return [`${a.runs.length}`, fieldsOf(a.runs).join(", ")];
      case "/v1/mandates/{id}":
        return [`${a.mandates.length}`, fieldsOf(a.mandates).join(", ")];
      default:
        return ["—", "—"];
    }
  };
  L.push(
    table(
      ["Dirección", "Qué devuelve", "Respuesta", "Registros", "Campos"],
      [...byGeneric.entries()].map(([g, cs]) => {
        const statuses = [...new Set(cs.map((c) => c.status))];
        const ok = statuses.includes(200);
        const note = ok ? "200 (sí existe)" : statuses.includes(405) ? `${statuses.join(", ")} (existe, pero no deja listar)` : `${statuses.join(", ")} (no existe)`;
        const [n, f] = ok ? countAndFields(g) : ["—", "—"];
        return [`\`${g}\``, WHAT[g] ?? "", `${note}${cs.length > 1 ? ` · ${cs.length} llamadas` : ""}`, n, f];
      }),
    ),
  );
  L.push("");
  L.push(
    "No consultada a propósito: `GET /v1/decision-requests/next`. Es una lectura, pero entrega la siguiente compra de una ejecución en curso; leerla se la quitaría al programa que la está decidiendo. " +
      "Las demás direcciones de la API (crear y confirmar mandatos, iniciar ejecuciones, responder compras, reset) escriben, así que no se tocaron.",
  );

  // ---- Catalogues
  h("## 2. Catálogos");
  L.push("«Antiguos» = aparecen en el historial de compras. «Nuevos» = están en los catálogos pero no tienen ni una compra en el historial. Los artículos se comparan con el paquete público (`data/items.csv`), porque el historial no lista artículos.");
  L.push("");
  L.push(
    table(
      ["Catálogo", "Total", "Antiguos", "Nuevos"],
      [
        ["Clientes", customers.length, cust.old.length, cust.new.length],
        ["Cuentas", accounts.length, acc.old.length, acc.new.length],
        ["Tarjetas", cards.length, crd.old.length, crd.new.length],
        ["Tiendas", merchants.length, mer.old.length, mer.new.length],
        ["Artículos", items.length, itm.old.length, `${itm.new.length} (no están en el paquete público)`],
      ],
    ),
  );

  h("### Los clientes nuevos, uno por uno");
  for (const c of cust.new) {
    const cid = str(c.customer_id);
    L.push(`#### ${cell(c.persona_name)} (${cid})`);
    L.push("");
    for (const [k, v] of Object.entries(c)) if (k !== "customer_id" && k !== "persona_name") L.push(`- **${k}**: ${cell(v)}`);
    const theirAccounts = accounts.filter((x) => str(x.customer_id) === cid);
    const theirCards = cards.filter((x) => theirAccounts.some((ac) => str(ac.account_id) === str(x.account_id)));
    const scen = [...profileOf.entries()].filter(([, p]) => p.customer === cid).map(([s]) => s);
    L.push(`- **escenario en vivo**: ${scen.length ? scen.join(", ") : "todavía no se sabe (se ve al ejecutar su escenario)"}`);
    L.push(`- **compras en el historial**: ${history.filter((r) => str(r.customer_id) === cid).length}`);
    L.push("");
    L.push(table(["Cuenta", "Tipo", "Uso", "Moneda", "Límite por compra (CHF)", "Límite mensual (CHF)", "Estado"], theirAccounts.map((x) => [x.account_id, x.account_type, x.account_purpose, x.base_currency, x.per_transaction_limit_chf, x.monthly_limit_chf, x.status])));
    L.push("");
    L.push(table(["Tarjeta", "Cuenta", "Tipo", "Uso", "Estado", "Primer uso", "Online", "Internacional", "Virtual"], theirCards.map((x) => [x.card_id, x.account_id, x.card_type, x.card_purpose, x.status, x.first_used_on, x.online_enabled, x.international_enabled, x.virtual_card])));
    L.push("");
  }

  // ---- New shops
  h("## 3. Tiendas nuevas");
  const liveNew = [...liveShops.values()].filter((m) => !histMerchants.has(str(m.merchant_id)));
  L.push(`Tiendas que ya aparecieron en compras en vivo: **${liveShops.size}**. De ellas, sin ninguna compra en el historial: **${liveNew.length}**.`);
  L.push("");
  if (liveShops.size) {
    L.push(table(["Tienda", "Nombre", "Tipo", "País", "Ciudad", "¿En el historial?"], [...liveShops.values()].map((m) => [m.merchant_id, m.merchant_name, m.merchant_category, m.merchant_country, m.merchant_city, histMerchants.has(str(m.merchant_id)) ? "sí" : "**no**"])));
    L.push("");
  }
  L.push(`Tiendas del catálogo que no tienen ni una compra en el historial (candidatas a aparecer en los escenarios en vivo): **${mer.new.length}**.`);
  L.push("");
  L.push(table(["Tienda", "Nombre", "Tipo", "País", "Ciudad", "Online/tienda"], mer.new.map((m) => [m.merchant_id, m.merchant_name, m.merchant_category, m.merchant_country, m.merchant_city, m.availability])));

  // ---- Live scenarios
  h("## 4. Escenarios en vivo");
  const total = scenarios.reduce((s, x) => s + Number(x.event_count ?? 0), 0);
  L.push(
    table(
      ["Escenario", "Nombre", "Compras", "Cliente", "Tarjeta", "Instrucción"],
      [
        ...scenarios.map((s) => {
          const p = profileOf.get(str(s.scenario_id));
          return [s.scenario_id, s.scenario_name, s.event_count, p ? `${p.customer} (${p.source})` : "se sabe al ejecutarlo", p ? p.card : "—", s.cardholder_instruction];
        }),
        ["**TOTAL**", "", `**${total}**`, "", "", ""],
      ],
    ),
  );

  // ---- What we did
  h("## 5. Lo que ya hicimos en Viseca");
  L.push(`Ejecuciones que la API muestra: **${a.runs.length}** · mandatos que aparecen en ellas: **${a.mandates.length}** · compras decididas: **${a.authorizations.length}**.`);
  L.push("");
  L.push("### Ejecuciones");
  L.push("");
  L.push(
    table(
      ["Ejecución", "Escenario", "Mandato", "Estado", "Cliente / tarjeta", "Generadas", "Entregadas", "Finalizadas", "Rechazadas por la plataforma"],
      a.runs.map((r) => {
        const fp = arr(r.fixture_profiles)[0];
        return [r.run_id, r.scenario_id, r.mandate_id, r.status, fp ? `${str(fp.customer_id)} / ${str(fp.card_id)}` : "—", r.generated_event_count, r.delivered_event_count, r.finalized_event_count, r.platform_rejected_count];
      }),
    ),
  );
  L.push("");
  L.push("### Mandatos");
  L.push("");
  L.push(
    table(
      ["Mandato", "Estado", "Creado", "Reglas", "Si hay duda", "Instrucción"],
      a.mandates.map((m) => [m.mandate_id, m.status, str(m.created_at).replace("T", " ").slice(0, 19), arr(m.hard_rules).length, m.uncertainty_policy, m.instruction]),
    ),
  );
  L.push("");
  L.push("«superseded» = otro mandato más nuevo para el mismo cliente lo reemplazó.");
  L.push("");
  // Our own answer is the first authorization.decision event sent by the team; the authorization holds the final outcome.
  const ours = new Map<string, Rec>();
  for (const e of a.events) {
    const d = obj(e.data);
    if (e.type === "authorization.decision" && d.decision_source === "team" && !ours.has(str(e.authorization_id))) ours.set(str(e.authorization_id), d);
  }
  L.push("### Compras decididas");
  L.push("");
  L.push(
    table(
      ["Compra", "Escenario", "Ejecución", "Tienda", "CHF", "Nuestra respuesta", "Nuestros motivos", "Resultado final", "Motivo final", "Quién cerró"],
      a.authorizations.map((x) => {
        const au = obj(x.authorization);
        const fin = obj(x.decision);
        const our = ours.get(str(x.authorization_id));
        const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(str).join(", ") : str(v));
        return [x.authorization_id, x.scenario_id, x.run_id, obj(au.merchant).merchant_name, au.billing_amount_chf, our ? our.decision : "—", our ? list(our.reason_codes) : "—", x.status, list(x.reason_codes ?? fin.reason_codes), x.decision_source];
      }),
    ),
  );
  L.push("");
  L.push("«Nuestra respuesta» = lo que contestó nuestro programa. «Resultado final» = cómo terminó la compra en Viseca. «Quién cerró» = `team` si el cierre fue nuestro, `timeout` si nadie contestó a tiempo y Viseca la cerró sola (una pregunta sin respuesta termina como rechazo).");

  // ---- What we cannot get
  h("## 6. Lo que NO se puede obtener");
  const newWithHistory = cust.new.filter((c) => history.some((r) => str(r.customer_id) === str(c.customer_id))).length;
  const unknownScen = scenarios.filter((s) => !profileOf.has(str(s.scenario_id))).map((s) => str(s.scenario_id));
  const statusOf = (p: string) => a.calls.find((c) => c.path === p)?.status;
  const lines: string[] = [
    `**El historial de los ${cust.new.length} clientes nuevos.** Ninguno tiene compras en el historial (${newWithHistory} de ${cust.new.length} con al menos una fila). El historial solo cubre a los ${cust.old.length} clientes antiguos (${history.length} filas). Sus tarjetas sí figuran en el catálogo, con fecha de primer uso, pero sus compras no están publicadas en ninguna dirección que la API deje leer.`,
    `**Qué cliente y qué tarjeta usa cada escenario, antes de ejecutarlo.** Se conoce para ${profileOf.size} de ${scenarios.length} escenarios; faltan ${unknownScen.join(", ") || "ninguno"}. El \`bootstrap\` muestra un solo perfil y el resto solo aparece al terminar una ejecución.`,
    "**Las compras de cada escenario (tiendas, artículos, importes) antes de ejecutarlo.** La API dice: «Delivered one at a time by scenario runs».",
    "**La respuesta esperada de los escenarios en vivo.** En el paquete público había un archivo de decisiones de referencia; en vivo no existe.",
    `**Una lista de todos los mandatos o de todas las ejecuciones.** \`/v1/mandates\` respondió ${statusOf("/v1/mandates") ?? "—"} y \`/v1/scenario-runs\` ${statusOf("/v1/scenario-runs") ?? "—"}: solo se pueden leer uno por uno, sabiendo su identificador. Los mandatos que se crearon sin llegar a usarse en una ejecución no aparecen en ningún lado.`,
    `**Documentación de la API.** \`/docs\` respondió ${statusOf("/docs") ?? "—"}, \`/openapi.json\` ${statusOf("/openapi.json") ?? "—"} y \`/v1\` ${statusOf("/v1") ?? "—"}.`,
  ];
  for (const l of lines) L.push(`- ${l}`);
  L.push("");

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, L.join("\n"));
}
