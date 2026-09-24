import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { CreateLeashRequest, TightenRequest } from "@leash/shared";
import { AskError } from "../asks.js";
import { ServiceError, type LeashService } from "../leash/service.js";
import { VisecaError } from "../viseca/api.js";
import type { LeashEvents } from "../store.js";

// App API from the App API contract, plus /api/* demo control. Plain node:http, no framework.

type Params = Record<string, string>;
type Handler = (ctx: { req: IncomingMessage; res: ServerResponse; params: Params; query: URLSearchParams; body: () => Promise<Record<string, unknown>> }) => Promise<unknown> | unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export interface ServerOptions {
  /** Allowed browser origin for Kim's dev server; "*" by default. */
  corsOrigin?: string;
  heartbeatMs?: number;
  /**
   * When set, every write under /app/* needs "Authorization: Bearer <appSecret>". Only the customer's app holds it;
   * the agent only ever holds decision tokens (/demo/tokens/*), which can pay but never approve.
   */
  appSecret?: string | null;
}

const MAX_BODY = 1_000_000;

function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), "([^/]+)"))}$`);
  return { method, pattern, keys, handler };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new ServiceError(413, "body_too_large", "Request body is too large.");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new ServiceError(400, "invalid_json", "Body must be a JSON object.");
  }
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function toError(err: unknown): { status: number; code: string; message: string; details?: unknown } {
  if (err instanceof ServiceError) return { status: err.status, code: err.code, message: err.message };
  if (err instanceof AskError) {
    const status = err.code === "not_found" ? 404 : err.code === "expired" ? 410 : 409;
    return { status, code: err.code, message: err.message };
  }
  if (err instanceof VisecaError) return { status: 502, code: "viseca_error", message: `Viseca answered ${err.status}.`, details: err.body };
  return { status: 500, code: "internal_error", message: (err as Error)?.message ?? "Unexpected error." };
}

export function createLeashServer(service: LeashService, opts: ServerOptions = {}): Server {
  const corsOrigin = opts.corsOrigin ?? "*";
  const heartbeatMs = opts.heartbeatMs ?? 15_000;

  const routes: Route[] = [
    route("GET", "/healthz", () => ({ status: "ok", mode: service.mode })),

    // S1–S3
    route("POST", "/app/leash/parse", async ({ body }) => service.parse(String((await body()).instruction ?? ""))),
    route("POST", "/app/leash", async ({ body }) => service.createLeash((await body()) as unknown as CreateLeashRequest)),
    // S4, S7
    route("GET", "/app/leash", () => service.getLeash()),
    // S8
    route("PATCH", "/app/leash/rules", async ({ body }) => service.tighten((await body()) as unknown as TightenRequest)),
    // S9
    route("DELETE", "/app/leash", () => service.revoke()),
    route("POST", "/app/leash/pause", async ({ body }) => service.pause(Number((await body()).hours ?? 24))),
    route("POST", "/app/leash/resume", () => service.resume()),

    // S4, S5, S6
    route("GET", "/app/feed", ({ query }) => service.feed(query.get("run_id") ?? undefined)),
    route("GET", "/app/decisions/:id", ({ params }) => service.decision(params.id as string)),
    route("GET", "/app/asks", () => service.asks()),
    route("POST", "/app/asks/:id/resolve", async ({ params, body }) => {
      const b = await body();
      return service.resolve(params.id as string, b.decision as "approve" | "decline", b.accept_suggestion === true, b.over_budget_ok === true);
    }),
    route("POST", "/app/suggestions/:id/accept", ({ params }) => service.acceptSuggestion(params.id as string)),
    route("POST", "/app/suggestions/:id/dismiss", ({ params }) => service.dismissSuggestion(params.id as string)),

    // Decision-bound tokens (demo): the agent pays with a token bound to one approved purchase.
    route("GET", "/app/tokens", () => service.listTokens()),
    route("GET", "/app/tokens/:id", ({ params }) => service.token(params.id as string)),
    route("POST", "/demo/tokens/:id/charge", async ({ params, body }) => {
      const b = await body();
      return service.demoCharge(params.id as string, {
        merchant_id: typeof b.merchant_id === "string" ? b.merchant_id : undefined,
        amount_chf: b.amount_chf === undefined ? undefined : Number(b.amount_chf),
        later: b.later === true,
      });
    }),
    route("POST", "/demo/tokens/:id/refund", async ({ params, body }) => {
      const b = await body();
      return service.demoRefund(params.id as string, b.amount_chf === undefined ? undefined : Number(b.amount_chf));
    }),

    // Judge view and demo control
    route("GET", "/judge/decisions", ({ query }) => service.judge(query.get("run_id") ?? undefined)),
    route("GET", "/api/scenarios", () => service.scenarios()),
    route("POST", "/api/runs", async ({ body }) => {
      const b = await body();
      return service.startRun(String(b.scenario_id ?? ""), b.use_current_leash === true);
    }),
    route("GET", "/api/status", () => service.status()),
  ];

  const clients = new Set<ServerResponse>();
  const forward = <K extends keyof LeashEvents>(event: K) => {
    service.bus.on(event, ((payload: LeashEvents[K][0]) => {
      const frame = `event: ${String(event)}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const c of clients) c.write(frame);
    }) as never);
  };
  (["decision", "ask", "ask_expired", "leash_changed", "token"] as const).forEach(forward);
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(": ping\n\n");
  }, heartbeatMs);
  heartbeat.unref();

  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (corsOrigin !== "*") res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");

    // S4–S6 live updates: decision, ask, ask_expired, leash_changed, token.
    if (req.method === "GET" && url.pathname === "/app/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ leash: service.getLeash().status })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    const candidates = routes.filter((r) => r.pattern.test(url.pathname));
    const match = candidates.find((r) => r.method === req.method);
    if (!match) {
      send(res, candidates.length ? 405 : 404, { error: { code: candidates.length ? "method_not_allowed" : "not_found", message: `${req.method} ${url.pathname}` } });
      return;
    }
    if (opts.appSecret && match.method !== "GET" && url.pathname.startsWith("/app/")) {
      const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
      if (!sameSecret(given, opts.appSecret)) {
        send(res, 401, { error: { code: "unauthorized", message: "Only your app can change the leash or answer a purchase." } });
        return;
      }
    }
    const values = url.pathname.match(match.pattern)!.slice(1);
    const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(values[i] ?? "")]));
    try {
      const result = await match.handler({ req, res, params, query: url.searchParams, body: () => readJson(req) });
      send(res, req.method === "POST" && url.pathname === "/api/runs" ? 202 : 200, result);
    } catch (err) {
      const e = toError(err);
      send(res, e.status, { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
    }
  });
  server.on("close", () => {
    clearInterval(heartbeat);
    for (const c of clients) c.end();
  });
  return server;
}
