import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VisecaApi } from "./api.js";

/**
 * Wraps a VisecaApi and writes every call's raw result (or error) to `dir`, one JSON file per call.
 * Used on the first live run to see the real response shapes. Never records the team key.
 */
export function recordingApi(api: VisecaApi, dir: string): VisecaApi {
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const save = (method: string, args: unknown[], outcome: { result?: unknown; error?: unknown }) => {
    n += 1;
    const file = join(dir, `${String(n).padStart(3, "0")}-${method}.json`);
    writeFileSync(file, JSON.stringify({ method, args, ...outcome }, null, 2));
  };
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          const result = await value.apply(target, args);
          // 204s are frequent and empty; skip them to keep the folder readable.
          if (!(prop === "nextDecisionRequest" && result === null)) save(String(prop), args, { result });
          return result;
        } catch (err) {
          const e = err as { status?: number; body?: unknown; message?: string };
          save(String(prop), args, { error: { status: e.status, body: e.body, message: e.message } });
          throw err;
        }
      };
    },
  });
}
