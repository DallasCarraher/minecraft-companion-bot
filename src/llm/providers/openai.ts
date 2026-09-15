import OpenAI from 'openai';
import type {
  ChatCompletionContentPartText,
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
 * OpenRouter's explicit prompt-caching field (`cache_control`, Anthropic-style syntax) is a wire
 * extension on top of the OpenAI Chat Completions format — it isn't part of the upstream OpenAI
 * SDK's types, so this augments the official content-part type rather than casting to `any`.
 */
type CacheableTextPart = ChatCompletionContentPartText & {
  cache_control?: { type: 'ephemeral'; ttl?: string };
};

/**
 * Per OpenRouter's prompt-caching docs, caching is automatic (no request changes needed) for
 * OpenAI, DeepSeek, Groq, Grok, Moonshot, Z.AI, and Gemini 2.5+ (implicit) models. Anthropic
 * Claude, Google Gemini (explicit mode), and Alibaba Qwen models instead require an explicit
 * `cache_control` breakpoint on a structured content block, same as native Anthropic. This only
 * matters when routed through OpenRouter — talking to the real OpenAI API never needs it.
 */
function needsExplicitCacheControl(model: string): boolean {
  return (
    model.startsWith('anthropic/') || model.startsWith('google/gemini') || model.startsWith('qwen/')
  );
}

/**
 * Translates between our normalized shape and OpenAI's Chat Completions API. Like the Anthropic
 * adapter, this only implements the single-turn translation — the multi-turn loop, repair retry,
 * and escalation policy all live once in `decisionLoop.ts`. This adapter is also why that repair
 * logic is shared rather than Anthropic-specific: docs/model-options.md already flags GPT-4.1-mini
 * as needing more JSON-repair robustness than Haiku, so any provider gets the same safety net.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  private readonly client: OpenAI;

  /**
   * `baseURL` lets this same adapter target any OpenAI-Chat-Completions-compatible endpoint —
   * e.g. OpenRouter (https://openrouter.ai/api/v1) — since the request/response shape, including
   * tool calls, is the same wire format. Model capability (especially `strict` JSON-schema tool
   * calling) still varies by the underlying model OpenRouter routes to.
   */
  constructor(
    apiKey: string,
    private readonly model: string,
    baseURL?: string,
    name = 'openai',
  ) {
    this.client = new OpenAI({ apiKey, baseURL });
    this.name = name;
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

    // See `needsExplicitCacheControl`'s doc comment: only Anthropic/Gemini/Qwen models routed
    // through OpenRouter need the system prompt reshaped into a cacheable content block; every
    // other case keeps the plain-string form so this is a no-op for the real OpenAI API and for
    // OpenRouter-routed families that already cache automatically.
    const systemContent: string | ChatCompletionContentPartText[] =
      this.name === 'openrouter' && needsExplicitCacheControl(this.model)
        ? [
            {
              type: 'text',
              text: params.system,
              cache_control: { type: 'ephemeral' },
            } as CacheableTextPart,
          ]
        : params.system;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'system', content: systemContent }, ...toOpenAIMessages(params.messages)],
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
