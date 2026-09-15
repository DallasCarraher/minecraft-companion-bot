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
    const tools = params.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      strict: true,
      input_schema: tool.jsonSchema as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      // Anthropic's cache prefix order is tools -> system -> messages, so a single breakpoint at
      // the end of system (the last static content before the per-turn messages) is enough to
      // cache both the tool schemas and the system prompt as one entry — both are static for the
      // life of the process, but decisionLoop re-sends them on every iteration (up to
      // decisionLoopMaxIterations) and every chat trigger. A breakpoint on the last tool instead
      // would NOT cover system, since system comes after tools in that prefix order.
      system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
      messages: toAnthropicMessages(params.messages),
      tools,
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
