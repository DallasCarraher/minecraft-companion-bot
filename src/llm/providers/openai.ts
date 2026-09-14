import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type {
  LLMProvider,
  NormalizedMessage,
  NormalizedResponse,
  NormalizedToolCall,
  ToolSpec,
} from '../types.js';

/**
 * Translates between our normalized shape and OpenAI's Chat Completions API. Like the Anthropic
 * adapter, this only implements the single-turn translation — the multi-turn loop, repair retry,
 * and escalation policy all live once in `decisionLoop.ts`. This adapter is also why that repair
 * logic is shared rather than Anthropic-specific: docs/model-options.md already flags GPT-4.1-mini
 * as needing more JSON-repair robustness than Haiku, so any provider gets the same safety net.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async createTurn(params: {
    system: string;
    messages: NormalizedMessage[];
    tools: ToolSpec[];
  }): Promise<NormalizedResponse> {
    const tools: ChatCompletionTool[] = params.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.jsonSchema,
        strict: true,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'system', content: params.system }, ...toOpenAIMessages(params.messages)],
      tools,
    });

    const choice = response.choices[0];
    const message = choice?.message;

    const toolCalls: NormalizedToolCall[] = (message?.tool_calls ?? [])
      .filter(
        (call): call is Extract<typeof call, { type: 'function' }> => call.type === 'function',
      )
      .map((call) => ({ id: call.id, name: call.function.name, argsRaw: call.function.arguments }));

    return {
      stopReason: toolCalls.length > 0 ? 'tool_calls' : 'end',
      toolCalls,
      text: message?.content ?? null,
      raw: response,
    };
  }
}

function toOpenAIMessages(messages: NormalizedMessage[]): ChatCompletionMessageParam[] {
  return messages.flatMap((message): ChatCompletionMessageParam[] => {
    if (message.role === 'tool') {
      // OpenAI has no equivalent of folding multiple tool results into one message — each needs
      // its own `{role:'tool', tool_call_id, content}` entry, unlike Anthropic's single user
      // message with multiple tool_result blocks.
      return (message.toolResults ?? []).map((result) => ({
        role: 'tool' as const,
        tool_call_id: result.toolCallId,
        content: result.content,
      }));
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      return [
        {
          role: 'assistant',
          content: message.text ?? null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: call.argsRaw },
          })),
        },
      ];
    }

    return [
      { role: message.role === 'assistant' ? 'assistant' : 'user', content: message.text ?? '' },
    ];
  });
}
