import type { NormalizedResponse } from '../../src/llm/types.js';
import type { CapturedCall } from './fakeLLMProvider.js';

/**
 * Estimates $ cost for a scripted decision tick, for tests only — this is a char-count
 * heuristic (~4 chars/token, the standard rough approximation for English/JSON text), not the
 * real Claude tokenizer, and not real billing data. A production cost-tracking feature should
 * instead read `usage.input_tokens`/`usage.output_tokens` off the real Anthropic/OpenAI response
 * (available via `NormalizedResponse.raw`) rather than estimate from payload size.
 *
 * It deliberately estimates from `JSON.stringify(call.tools)`/`JSON.stringify(call.messages)`
 * rather than summing field lengths by hand: that JSON structure (keys, quotes, braces) is what
 * actually goes over the wire and gets tokenized, so it's a closer approximation than counting
 * only the human-readable text.
 */
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateInputTokens(call: CapturedCall): number {
  return (
    estimateTokens(call.system) +
    estimateTokens(JSON.stringify(call.tools)) +
    estimateTokens(JSON.stringify(call.messages))
  );
}

export function estimateOutputTokens(response: NormalizedResponse): number {
  return estimateTokens(response.text ?? '') + estimateTokens(JSON.stringify(response.toolCalls));
}

export interface ModelPricing {
  /** $ per 1M input tokens */
  inputPerMTok: number;
  /** $ per 1M output tokens */
  outputPerMTok: number;
}

/** Claude Haiku 4.5 pricing per docs/model-options.md — reverify before relying on it for budgeting. */
export const HAIKU_4_5_PRICING: ModelPricing = { inputPerMTok: 1.0, outputPerMTok: 5.0 };

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
): number {
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMTok +
    (outputTokens / 1_000_000) * pricing.outputPerMTok
  );
}

export interface CallCostBreakdown {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

/** Pairs each captured request with the scripted response that answered it and prices both. */
export function estimateTickCost(
  calls: CapturedCall[],
  responses: NormalizedResponse[],
  pricing: ModelPricing = HAIKU_4_5_PRICING,
): {
  perCall: CallCostBreakdown[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
} {
  const perCall = calls.map((call, i) => {
    const response = responses[i];
    if (!response) throw new Error(`No scripted response to pair with call #${i}`);
    const inputTokens = estimateInputTokens(call);
    const outputTokens = estimateOutputTokens(response);
    return { inputTokens, outputTokens, cost: estimateCost(inputTokens, outputTokens, pricing) };
  });

  return {
    perCall,
    totalInputTokens: perCall.reduce((sum, c) => sum + c.inputTokens, 0),
    totalOutputTokens: perCall.reduce((sum, c) => sum + c.outputTokens, 0),
    totalCost: perCall.reduce((sum, c) => sum + c.cost, 0),
  };
}
