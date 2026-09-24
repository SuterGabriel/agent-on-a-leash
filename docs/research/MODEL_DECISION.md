# Model decision (merged from two research passes, 24 Sep 2026)

Sources: [research 1 (Perplexity)](model-selection-perplexity-2026-09-24.md) · [research 2 (second opinion)](model-selection-second-opinion-2026-09-24.md).
Where the two disagree, research 2 wins because it is newer (Qwen3.5, Gemma 4, Horizon Labs) and because it evaluated our exact injection style.

## What changed between research 1 and research 2

| Topic | Research 1 said | Research 2 says | We do |
|---|---|---|---|
| Policy parsing latency | Same 2.2 s budget as everything else | It runs once at mandate creation, not per purchase. 3–5 s is fine. | Task 1 gets a 5 s timeout and can use a bigger model. Result is shown as chips for confirmation. |
| Injection classifier | Prompt Guard 2 22M (86M multilingual fallback) | Prompt Guard 2 misses polite, indirect injections like ours (PIArena F1 0.003 / 0.150). Horizon-Labs small catches them (0.948) with few false alarms (NotInject 0.897). | **Horizon-Labs/prompt-injection-guard-small**, protectai v2 at threshold ~0.9 as fallback. Prompt Guard 2 dropped. |
| Fact extraction model | Qwen2.5-1.5B-Instruct | Qwen3.5-2B fits the CPU budget and is a 2026 model | **Qwen3.5-2B** on CPU, Qwen3.5-4B on GPU (shares Task 1's server) |
| Policy model | Qwen3.5-4B, fallback Qwen2.5-1.5B | Qwen3.5-4B, 9B if a GPU is present, fallback Gemma-4-E4B-it | **Qwen3.5-4B**, fallback **Gemma-4-E4B-it** |
| GGUF source | bartowski | unsloth (`unsloth/Qwen3.5-4B-GGUF`) | Either; check file names against the repo |
| Gated models | Accept Meta/Google terms in advance | Everything we use is ungated (Qwen, Gemma 4, Horizon, protectai) | No gated downloads needed |
| Regex vs model | Regex before the model | Same, plus: call the LLM only for fields regex leaves null; if regex and LLM disagree on a field → ask | Adopted |
| Task 3 logic | High score + agent phrase → rule-based ask/decline | classifier > threshold OR LLM `aimed_at_agent` OR regex hit → ask | Adopted |

Both passes agree on: the model never decides; JSON enforced by the runtime, not the prompt; `null` means "not stated"; thinking disabled; warm servers; hard timeouts with regex fallback; own thresholds tuned on our strings.

## What we use

| Slot | Model | Budget | Why | How to run |
|---|---|---|---|---|
| Task 1 Policy compiler (once, at mandate creation) | `Qwen/Qwen3.5-4B` Q4_K_M (`unsloth/Qwen3.5-4B-GGUF`); 9B if the demo GPU allows | 5 s timeout, then regex only | Apache 2.0, 201 languages, best under 5B (Artificial Analysis) | llama-server, `response_format: json_schema`, `enable_thinking: false` |
| Task 1 fallback | `google/gemma-4-E4B-it` (`unsloth/gemma-4-E4B-it-GGUF`) | same | Apache 2.0 since Gemma 4, native JSON, different lineage | same |
| Task 2 Fact extraction (per purchase) | Regex first; `Qwen/Qwen3.5-2B` Q4_K_M on CPU, `Qwen3.5-4B` on GPU | 2.2 s timeout, only for fields regex left null | ~1–1.5 s CPU for ~60 output tokens | same server |
| Task 2 fallback | `google/gemma-4-E2B-it` | same | | same |
| Task 3 Injection classifier | `Horizon-Labs/prompt-injection-guard-small` (141M mmBERT, int8 ONNX in repo) | resident, ~10–30 ms CPU est. | Trained on planted, polite injections in documents; 30 languages; SAFE/INJECTION labels | transformers pipeline or onnxruntime |
| Task 3 fallback | `protectai/deberta-v3-base-prompt-injection-v2` at threshold ~0.9, sentence by sentence | | Battle-tested, English only, archived | transformers |

**Caveat:** the Horizon models were released 2026-09-23, one day before the hackathon, with an authors-only benchmark and mostly synthetic, English-heavy training data. Test on 20 of our own product strings before trusting it. If it fails, fall back to protectai v2 plus regex plus the LLM flag.

## Rules that follow

1. **The model never decides.** It produces candidate facts and open questions. The validator checks types, bounds and contradictions. The rule engine decides. Missing or ambiguous facts default to the uncertainty policy.
2. **JSON is enforced by the runtime**: llama-server `response_format` with a JSON schema, `additionalProperties: false`, shallow schema, `Optional`/`null`/enums so the model can legally say "not stated".
3. **Timeouts**: Task 1 5 s, Task 2 2.2 s, classifier resident. Every call cancels on timeout and falls back to regex. Warm-up call at boot for each model and each grammar.
4. **Regex first, model second.** Deterministic patterns take under 1 ms: `returns accepted within (\d+) days`, `final sale|non-refundable|kein Umtausch`, `subscription|abonnement|monthly|monatlich`, `size (\d+)|Gr\. (\d+)`. The LLM fills only null fields. Regex and LLM disagree on a field → ask.
5. **Injection decision** = classifier score > threshold **OR** LLM `aimed_at_agent` **OR** regex hit (`automated|AI agent|KI-Agent|agent IA|pre-?authori[sz]ed|vorautorisiert|limits? do(es)? not apply|System:|ignore .* instructions`) → ask. Combined with any decline it stays decline. Never approve because of text.
6. **No extracted field can raise a limit.** The schemas have no "pre-authorised amount" field.
7. **Thinking off** on Qwen3.5 and Gemma 4 (`chat_template_kwargs.enable_thinking=false`, `think=False` in Ollama), `max_tokens` set.
8. **Runtime**: plain llama.cpp, not Ollama, unless benchmarked (reports of 5× slower Qwen3.5 in Ollama). Static prompt prefix identical across calls so the prompt cache works; prefill on CPU can cost more than generation.
9. **Thresholds are ours.** Two thresholds (warn, block) tuned on ≥ 50 benign merchant strings and ≥ 20 injections in EN/DE/FR/IT. Score sentence by sentence; DeBERTa truncates at 512 tokens, mmBERT handles 8k.
10. **Do not use**: Prompt Guard 2 (misses our attack type, gated), `Qwen/Qwen2.5-3B-Instruct` (research-only license), deepset injection (flags almost everything), PIGuard (`trust_remote_code`), Llama 3.2 / Phi / Gemma 3 / SmolLM2 (older, gated, or English-leaning).

## Bake-off (before wiring anything, ~40 minutes)

Six runs on the same 15 strings (5 English, 5 German, 5 injections):
Task 1 Qwen3.5-4B vs Gemma-4-E4B · Task 2 Qwen3.5-2B vs Gemma-4-E2B · Task 3 Horizon-small vs protectai v2.
Score field accuracy, open-question recall, schema-valid rate, warm p50/p95, timeout rate. For Task 3 pick fewer dangerous false negatives only if ordinary products are not flagged.

## Schemas (adopted)

```json
Policy {
  per_order_limit_chf: number | null,
  per_order_includes_delivery: bool | null,
  rolling_limit: {amount_chf: number, days: int} | null,
  allowed_categories: string[],
  merchant_must_be_familiar: bool | null,
  merchant_category: string | null,
  min_return_window_days: int | null,
  requested_item_attributes: string[],
  on_uncertain: "ask" | "decline" | "approve",
  open_questions: string[]
}

ProductFacts {
  size: string | null,
  return_window_days: int | null,
  final_sale: bool,
  recurring_billing: bool,
  warranty: string | null,
  aimed_at_agent: bool
}
```

`aimed_at_agent` (extractor), classifier score, and regex hit are three separate signals, all recorded as evidence.

## Commands

```bash
# GPU demo machine: one server for Task 1 and Task 2
llama-server -hf unsloth/Qwen3.5-4B-GGUF:Q4_K_M -ngl 99 -c 8192 --jinja --port 8080
# CPU-only laptop: Task 2 model
llama-server -hf unsloth/Qwen3.5-2B-GGUF:Q4_K_M -ngl 0 -c 4096 --jinja --port 8080
```

Task 1 on a CPU-only laptop can still use Qwen3.5-4B because it is off the hot path (5 s budget).

## Where this lands in the code

- `packages/backend/compiler/model.ts`: `Policy` schema, 5 s timeout, merges with regex; numeric limits must agree or the chip is marked "please check".
- `packages/engine/shoptext/regex.ts`: deterministic facts and injection patterns (P0, always runs).
- `packages/engine/shoptext/model.ts`: `ProductFacts`, only for null fields, 2.2 s timeout, disagreement → ask.
- `packages/engine/shoptext/classifier.ts`: Horizon score, thresholds from config, sentence by sentence.
- Every decision records `model_status` ∈ {used, skipped, timeout, off}, `classifier_score`, `injection_regex_hit`, `aimed_at_agent`.

Config:
```
LLM_BASE_URL=http://127.0.0.1:8080/v1  LLM_MODEL=local
POLICY_LLM_TIMEOUT_MS=5000  FACTS_LLM_TIMEOUT_MS=2200
CLASSIFIER_MODEL=Horizon-Labs/prompt-injection-guard-small  CLASSIFIER_WARN=0.5  CLASSIFIER_BLOCK=0.9
```
