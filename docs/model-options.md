# Model Options for the Decision Loop

The bot makes an LLM call on essentially every chat command / decision tick, so cost and latency matter more here than for a one-off assistant chat. This compares cheaper alternatives to frontier Claude (Opus/Sonnet) for driving skill invocation.

Pricing shifts quickly — verify current rates before committing budget.

## Comparison

| Model | Cost tier | Approx. price ($/1M in / out) | Tool-calling reliability | Latency notes |
|---|---|---|---|---|
| **Claude Haiku 4.5** | Cheap | $1.00 / $5.00 | Strong — same tool-use API and `strict: true` schema validation as Sonnet/Opus | Fast, sub-second for short contexts |
| **GPT-4.1-mini** | Very cheap | $0.40 / $1.60 (batch: $0.20/$0.80) | Strong, mature OpenAI function-calling | Fast |
| **GPT-5-mini** | Very cheap | $0.25 / $2.00 | Strong, native structured outputs | Fast |
| **Gemini 3.1 Flash-Lite** | Very cheap | $0.25 / $1.50 | Good; slightly less strict JSON adherence than OpenAI/Anthropic | Very fast |
| **Gemini 3.8 Flash** | Cheap | $0.75 / $3.75 (intro) | Good, improved over 2.5 line | Fast |
| **DeepSeek V3(.2)** | Very cheap | ~$0.21–0.27 / $0.31–1.10 | Tool calling supported; less proven at strict schema adherence | Moderate, host-dependent |
| **Groq-hosted Llama 3.3 70B** | Very cheap | $0.59 / $0.79 | Supported; open-weight model, more prone to malformed args than frontier-lab small models | Extremely low — ~0.9s TTFT, ~300 tok/s |
| **Local (Ollama, Llama 3.1/3.3, Qwen2.5)** | Free (marginal) | $0 + hardware/electricity | Weakest of this list — needs prompt tuning and retry/validation logic | Depends entirely on local GPU |

Rough reliability ranking for structured skill-invocation: **Claude Haiku ≈ GPT-4.1-mini/GPT-5-mini** (most schema-strict) **> Gemini Flash-tier > DeepSeek > Groq/Llama > local open-weight models**.

## Recommendation

1. **Primary: Claude Haiku 4.5.** Since the bot's main brain already targets Claude, Haiku shares the same SDK, tool schema, and strict validation — zero integration cost to use it for the high-frequency decision loop while reserving Sonnet/Opus for harder planning steps, at roughly 1/5–1/10 the cost.
2. **Latency-sensitive alternative: GPT-4.1-mini or Groq-hosted Llama 3.3 70B.** If sub-second responsiveness matters more than staying single-vendor, Groq's ~0.9s time-to-first-token is the fastest option here, at the cost of needing a JSON-repair/retry wrapper around occasional malformed tool calls.

## Existing backend support

[Mindcraft](https://github.com/kolbytn/mindcraft) already supports OpenAI, Gemini, Anthropic, Groq, Replicate, HuggingFace, and Ollama backends out of the box. The community fork [mindcraft-ce](https://github.com/mindcraft-ce/mindcraft-ce) adds first-class function-calling across Claude, GPT, Gemini, Grok, DeepSeek, and Mistral — worth adopting directly rather than re-plumbing model backends ourselves.

## Sources

- [OpenAI API Pricing (September 2026)](https://benchlm.ai/openai/api-pricing)
- [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Groq — Intelligence, Performance & Price Analysis (Artificial Analysis)](https://artificialanalysis.ai/providers/groq)
- [Llama 3.3 70B — API Provider Benchmarking & Price Analysis](https://artificialanalysis.ai/models/llama-3-3-instruct-70b/providers)
- [DeepSeek V3.2 — API Pricing & Benchmarks (OpenRouter)](https://openrouter.ai/deepseek/deepseek-v3.2)
- [mindcraft-ce README](https://github.com/mindcraft-ce/mindcraft-ce/blob/stable/README.md)
- [kolbytn/mindcraft](https://github.com/kolbytn/mindcraft)
