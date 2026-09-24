// Reads everything the Viseca API lets our team key read, stores it raw in data/live/atlas/, and writes
// reports/api-atlas.md for a non-technical reader.
//   npm run api-atlas
// GET requests only: it never creates mandates, starts runs, resets, or polls the decision queue
// (GET /v1/decision-requests/next hands out purchases, so reading it would take one from a live run).
// The team key is only sent as a header; it is never printed or written to a file.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "../config.js";
import { writeAtlasReport, type Atlas, type CallRecord } from "../atlas/report.js";

const cfg = loadConfig({ mode: "live" });
if (!cfg.teamApiKey) throw new Error("TEAM_API_KEY is not set (see .env.example)");
const atlasDir = resolve(cfg.dataDir, "live", "atlas");
const reportPath = resolve(cfg.dataDir, "..", "reports", "api-atlas.md");

rmSync(atlasDir, { recursive: true, force: true });
mkdirSync(atlasDir, { recursive: true });

const calls: CallRecord[] = [];

async function get(path: string, file: string, auth = true): Promise<{ status: number; body: unknown; text: string }> {
  const headers: Record<string, string> = auth ? { Authorization: `Bearer ${cfg.teamApiKey}` } : {};
  let status = 0;
  let text = "";
  try {
    const res = await fetch(cfg.baseUrl + path, { method: "GET", headers, signal: AbortSignal.timeout(30_000) });
    status = res.status;
    text = await res.text();
  } catch (err) {
    text = JSON.stringify({ error: (err as Error).message });
  }
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // CSV or plain text: keep as text
  }
  const out = join(atlasDir, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  calls.push({ path, status, bytes: Buffer.byteLength(text), file });
  console.log(`GET ${path} -> ${status} (${Buffer.byteLength(text)} bytes)`);
  return { status, body, text };
}

const asArray = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// 1. Fixed documents.
const healthz = (await get("/healthz", "healthz.json", false)).body;
const bootstrap = (await get("/v1/bootstrap", "bootstrap.json")).body;
const referenceData = (await get("/v1/reference-data", "reference-data.json")).body;
const historyCsv = (await get("/v1/reference-data/authorization-history.csv", "authorization-history.csv")).text;

// 2. Authorizations and events, following next_cursor to the end.
async function paged(base: string, cursorParam: string, start: number | string, prefix: string, listKey: string) {
  const items: Record<string, unknown>[] = [];
  let cursor: number | string | null = start;
  for (let page = 0; cursor !== null && page < 1000; page++) {
    const sep = base.includes("?") ? "&" : "?";
    const { status, body } = await get(`${base}${sep}${cursorParam}=${encodeURIComponent(String(cursor))}`, `${prefix}-page-${String(page).padStart(3, "0")}.json`);
    if (status !== 200) break;
    const list = Array.isArray(body) ? asArray(body) : asArray(obj(body)[listKey]);
    items.push(...list);
    const next = Array.isArray(body) ? null : (obj(body).next_cursor as number | string | null | undefined) ?? null;
    if (!list.length || next === null || next === cursor) break;
    cursor = next;
  }
  return items;
}
const authorizations = await paged("/v1/authorizations", "cursor", 0, "authorizations", "authorizations");
const events = await paged("/v1/events", "since", 0, "events", "events");

// 3. Every run and mandate that appears in that data.
const runIds = new Set<string>();
const mandateIds = new Set<string>();
for (const a of authorizations) {
  if (typeof a.run_id === "string") runIds.add(a.run_id);
  const m = obj(a.authorization).mandate_id;
  if (typeof m === "string") mandateIds.add(m);
}
for (const e of events) {
  if (typeof e.run_id === "string") runIds.add(e.run_id);
  const d = obj(e.data);
  for (const m of [d.mandate_id, obj(d.mandate).mandate_id, obj(d.authorization).mandate_id]) if (typeof m === "string") mandateIds.add(m);
}
const runs: Record<string, unknown>[] = [];
for (const id of [...runIds].sort()) {
  const { status, body } = await get(`/v1/scenario-runs/${encodeURIComponent(id)}`, `runs/${id}.json`);
  if (status === 200) {
    runs.push(obj(body));
    const m = obj(body).mandate_id;
    if (typeof m === "string") mandateIds.add(m);
  }
}
const mandates: Record<string, unknown>[] = [];
for (const id of [...mandateIds].sort()) {
  const { status, body } = await get(`/v1/mandates/${encodeURIComponent(id)}`, `mandates/${id}.json`);
  if (status === 200) mandates.push(obj(body));
}

// 4. Hidden documentation? And can mandates / runs be listed?
for (const [path, file] of [
  ["/docs", "probes/docs.txt"],
  ["/openapi.json", "probes/openapi.json"],
  ["/v1", "probes/v1.txt"],
  ["/v1/mandates", "probes/v1-mandates-list.txt"],
  ["/v1/scenario-runs", "probes/v1-scenario-runs-list.txt"],
] as const) {
  await get(path, file, path !== "/docs" && path !== "/openapi.json");
}

const atlas: Atlas = { fetchedAt: new Date().toISOString(), baseUrl: cfg.baseUrl, calls, healthz, bootstrap, referenceData, historyCsv, authorizations, events, runs, mandates };
writeFileSync(join(atlasDir, "index.json"), JSON.stringify({ fetchedAt: atlas.fetchedAt, calls }, null, 2));
writeAtlasReport(atlas, reportPath);
console.log(`\nraw data: ${atlasDir}\nreport:   ${reportPath}`);
