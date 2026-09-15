import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolSpec } from '../../../../src/llm/types.js';

const createMock = vi.fn<(params: unknown) => Promise<unknown>>();

vi.mock('openai', () => ({
  default: vi
    .fn<() => { chat: { completions: { create: typeof createMock } } }>()
    .mockImplementation(function OpenAIMock() {
      return { chat: { completions: { create: createMock } } };
    }),
}));

const { OpenAIProvider } = await import('../../../../src/llm/providers/openai.js');

const tools: ToolSpec[] = [
  { name: 'toolA', description: 'does a', jsonSchema: { type: 'object', properties: {} } },
];

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

function stubResponse() {
  createMock.mockResolvedValue({
    choices: [{ message: { content: 'hi', tool_calls: [] } }],
  });
}

describe('OpenAIProvider prompt caching (OpenRouter-aware)', () => {
  beforeEach(() => {
    createMock.mockReset();
    stubResponse();
  });

  it('adds an explicit cache_control breakpoint for an Anthropic model routed via OpenRouter', async () => {
    const provider = new OpenAIProvider(
      'sk-test',
      'anthropic/claude-haiku-4.5',
      OPENROUTER_BASE_URL,
      'openrouter',
    );
    await provider.createTurn({ system: 'You are a bot.', messages: [], tools });

    const requestArg = createMock.mock.calls[0]?.[0];
    expect(requestArg.messages[0]).toEqual({
      role: 'system',
      content: [{ type: 'text', text: 'You are a bot.', cache_control: { type: 'ephemeral' } }],
    });
  });

  it('leaves the system prompt as a plain string for an OpenAI model routed via OpenRouter', async () => {
    const provider = new OpenAIProvider(
      'sk-test',
      'openai/gpt-5-mini',
      OPENROUTER_BASE_URL,
      'openrouter',
    );
    await provider.createTurn({ system: 'You are a bot.', messages: [], tools });

    const requestArg = createMock.mock.calls[0]?.[0];
    expect(requestArg.messages[0]).toEqual({ role: 'system', content: 'You are a bot.' });
  });

  it('leaves the system prompt as a plain string against the real OpenAI API regardless of model name', async () => {
    const provider = new OpenAIProvider('sk-test', 'anthropic/claude-haiku-4.5');
    await provider.createTurn({ system: 'You are a bot.', messages: [], tools });

    const requestArg = createMock.mock.calls[0]?.[0];
    expect(requestArg.messages[0]).toEqual({ role: 'system', content: 'You are a bot.' });
  });
});
