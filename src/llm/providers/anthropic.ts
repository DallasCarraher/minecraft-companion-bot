import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import type {
  LLMProvider,
  NormalizedMessage,
  NormalizedResponse,
  NormalizedToolCall,
  ToolSpec,
} from '../types.js';

const MAX_TOKENS = 1024;

/**
 * Translates between our normalized shape and Anthropic's Messages API. Does not implement any
 * multi-turn looping itself — that lives once, provider-agnostically, in `decisionLoop.ts`.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async createTurn(params: {
    system: string;
    messages: NormalizedMessage[];
    tools: ToolSpec[];
  }): Promise<NormalizedResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: params.system,
      messages: toAnthropicMessages(params.messages),
      tools: params.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        strict: true,
        input_schema: tool.jsonSchema as Anthropic.Tool.InputSchema,
      })),
    });

    const toolCalls: NormalizedToolCall[] = response.content
      .filter((block): block is ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({ id: block.id, name: block.name, argsRaw: JSON.stringify(block.input) }));

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return {
      stopReason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'end',
      toolCalls,
      text: text || null,
      raw: response,
    };
  }
}

function toAnthropicMessages(messages: NormalizedMessage[]): MessageParam[] {
  return messages.map((message): MessageParam => {
    if (message.role === 'tool') {
      // Anthropic requires every tool_result for a given turn to be folded into a single `user`
      // message, not split across multiple messages — splitting trains the model away from
      // issuing parallel tool calls. Since decisionLoop already emits one NormalizedMessage per
      // tick containing all of that tick's tool results, this is a 1:1 mapping, not a fold.
      const content: ToolResultBlockParam[] = (message.toolResults ?? []).map((result) => ({
        type: 'tool_result',
        tool_use_id: result.toolCallId,
        content: result.content,
        is_error: result.isError,
      }));
      return { role: 'user', content };
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.toolCalls.map((call) => ({
          type: 'tool_use' as const,
          id: call.id,
          name: call.name,
          input: JSON.parse(call.argsRaw) as unknown,
        })),
      };
    }

    return {
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.text ?? '',
    };
  });
}
