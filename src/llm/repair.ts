import type { LLMProvider, NormalizedMessage, NormalizedToolCall, ToolSpec } from './types.js';

/**
 * Sends one follow-up turn asking the model to re-emit corrected arguments for a single tool call
 * that failed zod validation. Reuses the tick's existing message history (rather than starting a
 * bare exchange) so the model still has the original request in context. Shared across providers
 * — docs/model-options.md already flags GPT-4.1-mini as needing more of this than Claude Haiku, so
 * this can't be an Anthropic-only afterthought.
 */
export async function requestRepair(params: {
  provider: LLMProvider;
  system: string;
  tools: ToolSpec[];
  priorMessages: NormalizedMessage[];
  failedCall: NormalizedToolCall;
  validationError: string;
}): Promise<NormalizedToolCall | null> {
  const repairMessages: NormalizedMessage[] = [
    ...params.priorMessages,
    { role: 'assistant', toolCalls: [params.failedCall] },
    {
      role: 'tool',
      toolResults: [
        {
          toolCallId: params.failedCall.id,
          content: `Invalid arguments for ${params.failedCall.name}: ${params.validationError}. Call ${params.failedCall.name} again with corrected arguments matching its schema.`,
          isError: true,
        },
      ],
    },
  ];

  const response = await params.provider.createTurn({
    system: params.system,
    messages: repairMessages,
    tools: params.tools,
  });

  return response.toolCalls.find((call) => call.name === params.failedCall.name) ?? null;
}
