import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolSpec } from '../../../../src/llm/types.js';

const createMock = vi.fn<(params: unknown) => Promise<unknown>>();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi
    .fn<() => { messages: { create: typeof createMock } }>()
    .mockImplementation(function AnthropicMock() {
      return { messages: { create: createMock } };
    }),
}));

const { AnthropicProvider } = await import('../../../../src/llm/providers/anthropic.js');

const tools: ToolSpec[] = [
  { name: 'toolA', description: 'does a', jsonSchema: { type: 'object', properties: {} } },
  { name: 'toolB', description: 'does b', jsonSchema: { type: 'object', properties: {} } },
];

describe('AnthropicProvider prompt caching', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('marks the system block as the single cache breakpoint, leaving tools plain', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end',
      content: [{ type: 'text', text: 'hi' }],
      usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 500 },
    });

    const provider = new AnthropicProvider('sk-test', 'claude-haiku-5-5');
    await provider.createTurn({ system: 'You are a bot.', messages: [], tools });

    const requestArg = createMock.mock.calls[0]?.[0];
    // Cache prefix order is tools -> system -> messages, so one breakpoint at the end of
    // system covers both the tool schemas and the system prompt in a single cache entry.
    expect(requestArg.system).toEqual([
      { type: 'text', text: 'You are a bot.', cache_control: { type: 'ephemeral' } },
    ]);
    for (const tool of requestArg.tools) {
      expect(tool.cache_control).toBeUndefined();
    }
  });

  it('surfaces cache usage fields from the response unchanged via NormalizedResponse.raw', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end',
      content: [{ type: 'text', text: 'hi again' }],
      usage: { cache_read_input_tokens: 1800, cache_creation_input_tokens: 0 },
    });

    const provider = new AnthropicProvider('sk-test', 'claude-haiku-5-5');
    const response = await provider.createTurn({ system: 'You are a bot.', messages: [], tools });

    expect((response.raw as { usage: { cache_read_input_tokens: number } }).usage).toMatchObject({
      cache_read_input_tokens: 1800,
    });
  });
});

describe('AnthropicProvider thinking round-trip', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('echoes its own assistant turn back verbatim, thinking blocks included', async () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'sig-abc' },
      { type: 'tool_use', id: 'tu_1', name: 'toolA', input: {} },
    ];
    createMock.mockResolvedValue({ stop_reason: 'tool_use', content, usage: {} });

    const provider = new AnthropicProvider('sk-test', 'claude-haiku-5-5');
    const first = await provider.createTurn({ system: 's', messages: [], tools });
    expect(first.toolCalls).toEqual([{ id: 'tu_1', name: 'toolA', argsRaw: '{}' }]);

    await provider.createTurn({
      system: 's',
      messages: [
        { role: 'assistant', toolCalls: first.toolCalls, replay: first.replay },
        { role: 'tool', toolResults: [{ toolCallId: 'tu_1', content: 'ok' }] },
      ],
      tools,
    });

    const requestArg = createMock.mock.calls[1]?.[0] as { messages: { content: unknown }[] };
    expect(requestArg.messages[0]?.content).toEqual(content);
  });

  it('rebuilds from normalized tool calls when the turn came from another provider', async () => {
    createMock.mockResolvedValue({ stop_reason: 'end', content: [], usage: {} });

    const provider = new AnthropicProvider('sk-test', 'claude-haiku-5-5');
    await provider.createTurn({
      system: 's',
      messages: [
        {
          role: 'assistant',
          toolCalls: [{ id: 'call_1', name: 'toolA', argsRaw: '{}' }],
          replay: { provider: 'openai', content: { tool_calls: [] } },
        },
      ],
      tools,
    });

    const requestArg = createMock.mock.calls[0]?.[0] as { messages: { content: unknown }[] };
    expect(requestArg.messages[0]?.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'toolA', input: {} },
    ]);
  });
});
