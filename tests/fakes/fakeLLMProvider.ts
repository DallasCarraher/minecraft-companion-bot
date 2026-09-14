import type {
  LLMProvider,
  NormalizedMessage,
  NormalizedResponse,
  ToolSpec,
} from '../../src/llm/types.js';

export interface CapturedCall {
  system: string;
  messages: NormalizedMessage[];
  tools: ToolSpec[];
}

/** Scriptable LLMProvider: returns one canned response per call, in order. */
export class FakeLLMProvider implements LLMProvider {
  readonly name = 'fake';
  readonly calls: CapturedCall[] = [];
  private callIndex = 0;

  constructor(private readonly responses: NormalizedResponse[]) {}

  async createTurn(params: CapturedCall): Promise<NormalizedResponse> {
    this.calls.push(params);
    const response = this.responses[this.callIndex];
    if (!response) {
      throw new Error(`FakeLLMProvider: no scripted response for call #${this.callIndex}`);
    }
    this.callIndex++;
    return response;
  }
}

export function endResponse(text: string): NormalizedResponse {
  return { stopReason: 'end', toolCalls: [], text, raw: null };
}

export function toolCallResponse(name: string, args: unknown, id = 'call_1'): NormalizedResponse {
  return {
    stopReason: 'tool_calls',
    toolCalls: [{ id, name, argsRaw: JSON.stringify(args) }],
    text: null,
    raw: null,
  };
}
