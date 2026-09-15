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

    const provider = new AnthropicProvider('sk-test', 'claude-haiku-4-5');
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

    const provider = new AnthropicProvider('sk-test', 'claude-haiku-4-5');
    const response = await provider.createTurn({ system: 'You are a bot.', messages: [], tools });

    expect((response.raw as { usage: { cache_read_input_tokens: number } }).usage).toMatchObject({
      cache_read_input_tokens: 1800,
    });
  });
});
