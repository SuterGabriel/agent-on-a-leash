import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LeashService, ServiceSnapshot } from "./leash/service.js";

// A JSON snapshot of the service on disk, so a backend restart keeps the leash, the feed, open asks and tokens.
// Written whenever something changes (debounced) and every few seconds as a safety net. Not a database: one
// customer, one process, one file. The seam for a real store is DecisionStore in store.ts.

export interface SnapshotFileOptions {
  /** Wait after a change before writing, so a burst of decisions is one write. */
  debounceMs?: number;
  /** Periodic write if anything changed that no event announced (pause, dismissed suggestion). */
  intervalMs?: number;
  log?: (line: string) => void;
}

export interface SnapshotFile {
  /** What was loaded at attach time, or null when there was no file. */
  restored: ReturnType<LeashService["restore"]> | null;
  /** Writes now if anything changed. */
  flush(): boolean;
  stop(): void;
}

export function attachSnapshotFile(service: LeashService, file: string, opts: SnapshotFileOptions = {}): SnapshotFile {
  const log = opts.log ?? (() => {});
  const debounceMs = opts.debounceMs ?? 250;
  const intervalMs = opts.intervalMs ?? 5_000;

  let restored: SnapshotFile["restored"] = null;
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as ServiceSnapshot;
      restored = service.restore(parsed);
      log(`state: restored from ${file}: ${restored.decisions} decisions, ${restored.open_asks} open asks, ${restored.tokens} tokens` + (restored.tokens_rejected.length ? `, ${restored.tokens_rejected.length} token(s) rejected (history chain broken)` : ""));
    } catch (err) {
      const aside = `${file}.corrupt-${Date.now()}`;
      renameSync(file, aside);
      log(`state: could not read ${file} (${(err as Error).message}); moved to ${aside}, starting empty`);
    }
  }

  let last = "";
  const write = (): boolean => {
    const snap = service.snapshot();
    // saved_at changes on every call; compare the content without it, so a quiet service writes nothing.
    const content = JSON.stringify({ ...snap, saved_at: "" });
    if (content === last) return false;
    const json = JSON.stringify(snap);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, json);
    renameSync(tmp, file); // atomic on the same volume: the file is either the old snapshot or the new one
    last = content;
    return true;
  };

  let timer: NodeJS.Timeout | null = null;
  const soon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        write();
      } catch (err) {
        log(`state: write failed: ${(err as Error).message}`);
      }
    }, debounceMs);
    timer.unref();
  };
  const events = ["decision", "ask", "ask_expired", "leash_changed", "token"] as const;
  for (const e of events) service.bus.on(e, soon as never);
  const interval = setInterval(() => {
    try {
      write();
    } catch (err) {
      log(`state: write failed: ${(err as Error).message}`);
    }
  }, intervalMs);
  interval.unref();

  const onExit = () => {
    try {
      write();
    } catch {
      // nothing to do on the way out
    }
  };
  process.once("beforeExit", onExit);
  process.once("SIGINT", () => {
    onExit();
    process.exit(0);
  });

  return {
    restored,
    flush: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      return write();
    },
    stop: () => {
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      for (const e of events) service.bus.off(e, soon as never);
      process.off("beforeExit", onExit);
    },
  };
}
