import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Apertus (swiss-ai/Apertus, the open Swiss model) on Swisscom's AI Platform, OpenAI-compatible chat completions.
// Used only where it adds something rules can't: reading a new customer's profile text, and understanding a leash
// written in German, French, Italian or Swiss German. It NEVER decides a purchase: nothing in the engine calls it,
// and every answer is validated, cached and replaced by a deterministic fallback when anything goes wrong.
// Config (.env): APERTUS_BASE_URL, APERTUS_MODEL, APERTUS_API_KEY. Missing = off, fallbacks only.
// The platform rate-limits (HTTP 429): calls go out one at a time with a minimum gap, and a 429 is retried.

export interface LlmCall {
  used: boolean; // the model answered (fresh or from cache)
  cached: boolean;
  fallback: boolean; // the deterministic fallback was used instead
  latency_ms: number;
  model: string | null;
  error?: string;
}

export interface ApertusOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  /** Budget per call, retries included. Calls happen when a leash or a profile is set up, never inside a decision. */
  timeoutMs?: number;
  /** data/live/llm-cache.json; null = no disk cache. */
  cacheFile?: string | null;
  /** After this many failures in a row the breaker opens for `coolDownMs` and every call falls back at once. */
  maxFailures?: number;
  coolDownMs?: number;
  /** Minimum time between two requests (the platform answers 429 when called too fast). */
  minGapMs?: number;
  /** Waits before retrying a 429 when the server gives no Retry-After. */
  retryDelaysMs?: number[];
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Apertus {
  private readonly baseUrl: string | null;
  private readonly model: string | null;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;
  private readonly cacheFile: string | null;
  private readonly maxFailures: number;
  private readonly coolDownMs: number;
  private readonly minGapMs: number;
  private readonly retryDelaysMs: number[];
  private readonly fetchImpl: typeof fetch;
  private readonly log: (line: string) => void;
  private cache: Record<string, string> = {};
  private failures = 0;
  private openUntil = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;

  constructor(opts: ApertusOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.APERTUS_BASE_URL ?? "").replace(/\/$/, "") || null;
    this.model = opts.model ?? process.env.APERTUS_MODEL ?? null;
    this.apiKey = opts.apiKey ?? process.env.APERTUS_API_KEY ?? null;
    this.timeoutMs = opts.timeoutMs ?? 45_000;
    this.cacheFile = opts.cacheFile === undefined ? null : opts.cacheFile;
    this.maxFailures = opts.maxFailures ?? 3;
    this.coolDownMs = opts.coolDownMs ?? 60_000;
    this.minGapMs = opts.minGapMs ?? Number(process.env.APERTUS_MIN_GAP_MS ?? 1_500);
    this.retryDelaysMs = opts.retryDelaysMs ?? [2_000, 5_000];
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log ?? (() => {});
    if (this.cacheFile && existsSync(this.cacheFile)) {
      try {
        this.cache = JSON.parse(readFileSync(this.cacheFile, "utf8")) as Record<string, string>;
      } catch {
        this.log(`apertus: cache ${this.cacheFile} unreadable, starting empty`);
      }
    }
  }

  get enabled(): boolean {
    return !!(this.baseUrl && this.model && this.apiKey);
  }

  get modelName(): string | null {
    return this.model;
  }

  private saveCache() {
    if (!this.cacheFile) return;
    mkdirSync(dirname(this.cacheFile), { recursive: true });
    const tmp = `${this.cacheFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cache));
    renameSync(tmp, this.cacheFile);
  }

  /** Runs `fn` after every earlier call, and at least minGapMs after the previous request went out. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const wait = this.lastCallAt + this.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCallAt = Date.now();
      return fn();
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** One request, retried on 429 (Retry-After, else the configured delays) while the budget lasts. */
  private async complete(system: string, user: string, maxTokens: number): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        // max_tokens keeps each call's reservation small: the platform limits OUTPUT tokens per minute.
        body: JSON.stringify({ model: this.model, temperature: 0, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
      });
      if (res.status === 429 && attempt < this.retryDelaysMs.length) {
        const retryAfter = Number(res.headers.get("retry-after") ?? (res.headers.get("x-ratelimit-reset") ?? "").replace(/s$/, ""));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (this.retryDelaysMs[attempt] ?? 2_000);
        if (Date.now() + wait >= deadline) throw new Error("HTTP 429 (rate limited, no time left to retry)");
        await sleep(wait);
        this.lastCallAt = Date.now();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return body.choices?.[0]?.message?.content ?? "";
    }
  }

  /**
   * One chat completion that must return JSON. `validate` turns the parsed JSON into T or throws; anything invalid
   * counts as a failure and the caller's fallback is used. Same system + user text = same cached answer.
   */
  async json<T>(system: string, user: string, validate: (v: unknown) => T, maxTokens = 400): Promise<{ value: T | null; call: LlmCall }> {
    const t0 = Date.now();
    const base: LlmCall = { used: false, cached: false, fallback: true, latency_ms: 0, model: this.model };
    if (!this.enabled) return { value: null, call: { ...base, error: "apertus not configured" } };
    const key = createHash("sha256").update(`${this.model}\n${system}\n${user}`).digest("hex");
    const hit = this.cache[key];
    if (hit !== undefined) {
      try {
        return { value: validate(extractJson(hit)), call: { ...base, used: true, cached: true, fallback: false, latency_ms: Date.now() - t0 } };
      } catch {
        delete this.cache[key]; // a cached answer that no longer validates is dropped, not trusted
      }
    }
    if (Date.now() < this.openUntil) return { value: null, call: { ...base, error: "breaker open after repeated failures" } };
    try {
      const text = await this.serial(() => this.complete(system, user, maxTokens));
      const value = validate(extractJson(text));
      this.cache[key] = text;
      this.saveCache();
      this.failures = 0;
      return { value, call: { ...base, used: true, fallback: false, latency_ms: Date.now() - t0 } };
    } catch (err) {
      this.failures += 1;
      if (this.failures >= this.maxFailures) {
        this.openUntil = Date.now() + this.coolDownMs;
        this.log(`apertus: ${this.failures} failures in a row, pausing calls for ${Math.round(this.coolDownMs / 1000)} s`);
      }
      return { value: null, call: { ...base, latency_ms: Date.now() - t0, error: (err as Error).message } };
    }
  }
}

/** The first JSON object or array in a model answer (models sometimes wrap it in prose or code fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("no JSON in the answer");
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  const end = body.lastIndexOf(close);
  if (end <= start) throw new Error("unterminated JSON");
  return JSON.parse(body.slice(start, end + 1));
}
