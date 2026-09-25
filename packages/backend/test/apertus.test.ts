import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Apertus, extractJson } from "../src/llm/apertus.js";
import { readProfile } from "../src/llm/profileReader.js";
import { englishThousands, lostInTranslation, understandLeash } from "../src/llm/leashTranslator.js";
import { compile } from "../src/compiler/compile.js";

// Apertus with recorded answers (no network): what it adds, and that nothing breaks or decides when it fails.

type Reply = { status?: number; content?: string; headers?: Record<string, string>; hang?: boolean };
function fakeFetch(replies: Reply[]) {
  const calls: { body: Record<string, unknown> }[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    calls.push({ body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const r = replies.shift() ?? { status: 500 };
    if (r.hang) {
      await new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: r.content ?? "" } }] }), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const llm = (replies: Reply[], extra: Partial<ConstructorParameters<typeof Apertus>[0]> = {}) => {
  const f = fakeFetch(replies);
  return { client: new Apertus({ baseUrl: "https://llm.test/v1", model: "apertus-test", apiKey: "k", minGapMs: 0, retryDelaysMs: [10], ...extra, fetchImpl: f.impl }), calls: f.calls };
};

describe("the Apertus client", () => {
  it("finds the JSON in a chatty answer", () => {
    expect(extractJson('Sure! ```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here: {"a": [1, 2]} hope it helps')).toEqual({ a: [1, 2] });
  });

  it("caches: the same question never goes out twice", async () => {
    const { client, calls } = llm([{ content: '{"x": 1}' }]);
    const v = (o: unknown) => (o as { x: number }).x;
    expect((await client.json("s", "u", v)).value).toBe(1);
    const again = await client.json("s", "u", v);
    expect(again.value).toBe(1);
    expect(again.call.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("an invalid answer, a timeout or no config means fallback, never an exception", async () => {
    const bad = await llm([{ content: "no json here" }]).client.json("s", "u", (o) => o);
    expect(bad.value).toBeNull();
    expect(bad.call.fallback).toBe(true);
    const slow = await llm([{ hang: true }], { timeoutMs: 1_000 }).client.json("s", "u", (o) => o);
    expect(slow.value).toBeNull();
    const off = await new Apertus({ baseUrl: "", model: "", apiKey: "" }).json("s", "u", (o) => o);
    expect(off.call.error).toMatch(/not configured/);
  });

  it("a 429 is retried; repeated failures open the breaker; max_tokens is always sent", async () => {
    const { client, calls } = llm([{ status: 429 }, { content: '{"ok": true}' }]);
    expect((await client.json("s", "u", (o) => o)).value).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body.max_tokens).toBeGreaterThan(0);

    const broken = llm([{ status: 500 }, { status: 500 }, { status: 500 }, { content: '{"ok": true}' }], { maxFailures: 3 });
    for (let i = 0; i < 3; i++) await broken.client.json("s", `u${i}`, (o) => o);
    const skipped = await broken.client.json("s", "u-last", (o) => o);
    expect(skipped.call.error).toMatch(/breaker/);
    expect(broken.calls).toHaveLength(3);
  });
});

describe("use 1: a new customer's profile", () => {
  const text = { shopping_preferences: "Refundable hotel stays and the same rail operator every time.", typical_spending: "Trips abroad.", travel_pattern: "Often in Austria." };

  it("keeps only allowed categories and ISO countries from the answer", async () => {
    const { client } = llm([{ content: '{"categories": ["hotel", "spaceships", "transport"], "night_owl": false, "travel_countries": ["AT", "Mars", "CH"], "prefers_refundable": true, "prefers_known_shops": true}' }]);
    const r = await readProfile(client, text);
    expect(r.signals.source).toBe("apertus");
    expect(r.signals.categories).toEqual(["hotel", "transport"]);
    expect(r.signals.travel_countries).toEqual(["AT"]);
  });

  it("falls back to keywords when the model fails", async () => {
    const r = await readProfile(llm([{ status: 500 }]).client, text);
    expect(r.signals.source).toBe("keywords");
    expect(r.signals.categories).toContain("hotel");
  });
});

describe("use 2: a leash in another language", () => {
  it("English is never sent to the model", async () => {
    const { client, calls } = llm([]);
    const u = await understandLeash(client, "Groceries up to CHF 100 per order. Ask me when unsure.");
    expect(u.language).toBe("en");
    expect(calls).toHaveLength(0);
  });

  it("Swiss German: translated, then read by our own compiler", async () => {
    const { client } = llm([{ content: '{"language": "gsw", "english": "Buy me running shoes size 41, not more than 150 francs. Ask me if unsure."}' }]);
    const u = await understandLeash(client, "Chauf mer Laufschue Grössi 41, nöd meh als 150 Franke. Frog mi wenn unsicher.");
    expect(u).toMatchObject({ language: "gsw", translated: true, please_check: [] });
    const labels = compile(u.english).rules.map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(["Each order CHF 150 or less", "Size 41"]));
  });

  it("a number the translation changed is caught (please check)", async () => {
    const { client } = llm([{ content: '{"language": "fr", "english": "No more than CHF 50 per order."}' }]);
    const u = await understandLeash(client, "Pas plus de 500 CHF par commande.");
    expect(u.please_check).toContain("500");
  });

  it("a foreign text the model calls English is asked again", async () => {
    const { client, calls } = llm([
      { content: '{"language": "en", "english": "Compra al massimo per 80 CHF per ordine."}' },
      { content: '{"language": "it", "english": "Buy for at most 80 CHF per order."}' },
    ]);
    const u = await understandLeash(client, "Compra al massimo per 80 CHF per ordine.");
    expect(u.language).toBe("it");
    expect(calls).toHaveLength(2);
  });

  it("English thousands separators are read as thousands", () => {
    expect(englishThousands("No more than 1,500 CHF")).toBe("No more than 1500 CHF");
    expect(lostInTranslation("Höchstens 1'500 Franken", englishThousands("At most 1,500 francs"))).toEqual([]);
  });
});

describe("the model never decides", () => {
  it("no file of the engine or of the decision path imports the LLM client", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));
    const decisionPath = [...files(join(root, "engine/src")), join(root, "backend/src/engine/leashEngine.ts"), join(root, "backend/src/worker.ts")];
    for (const f of decisionPath) expect(readFileSync(f, "utf8"), f).not.toMatch(/llm\/|apertus/i);
  });
});
