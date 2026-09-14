import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import pino from 'pino';
import { runDecisionTick } from '../../../src/llm/decisionLoop.js';
import { SkillRegistry } from '../../../src/skills/registry.js';
import type { Skill } from '../../../src/skills/types.js';
import { MemoryStore } from '../../../src/memory/store.js';
import { parseConfig } from '../../../src/config/env.js';
import { createFakeBot } from '../../fakes/fakeBot.js';
import { FakeLLMProvider, endResponse, toolCallResponse } from '../../fakes/fakeLLMProvider.js';

const silentLogger = pino({ level: 'silent' });

const echoSkill: Skill<{ message: string }> = {
  name: 'echo',
  description: 'echoes the given message',
  argsSchema: z.object({ message: z.string() }).strict(),
  timeoutMs: 1000,
  async run(_ctx, args) {
    return { ok: true, message: `echoed: ${args.message}` };
  },
};

let dataDir: string;
let memory: MemoryStore;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcb-decisionloop-test-'));
  memory = await MemoryStore.loadOrCreate('default', dataDir);
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

function baseParams(overrides: Partial<Parameters<typeof runDecisionTick>[0]> = {}) {
  const registry = new SkillRegistry();
  registry.register(echoSkill as Skill<unknown>);

  return {
    bot: createFakeBot(),
    logger: silentLogger,
    memory,
    config: parseConfig({
      botUsername: 'bot@example.com',
      minecraftVersion: '1.21.4',
      connectionMode: 'direct',
      serverHost: 'localhost',
      msAuthProfilesFolder: './.minecraft-auth',
      llmProvider: 'anthropic',
      anthropicApiKey: 'sk-test',
      decisionLoopMaxIterations: '3',
    }),
    registry,
    provider: new FakeLLMProvider([]),
    triggerMessage: {
      role: 'user' as const,
      username: 'Alice',
      text: 'say hi',
      at: new Date().toISOString(),
    },
    systemPrompt: 'system prompt',
    signal: new AbortController().signal,
    say: () => {},
    ...overrides,
  };
}

describe('runDecisionTick', () => {
  it('happy path: tool call -> result -> end', async () => {
    const provider = new FakeLLMProvider([
      toolCallResponse('echo', { message: 'hi' }),
      endResponse('Said hi!'),
    ]);
    const { replyText } = await runDecisionTick(baseParams({ provider }));

    expect(replyText).toBe('Said hi!');
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.messages.at(-1)?.toolResults?.[0]).toMatchObject({
      content: 'echoed: hi',
      isError: false,
    });
  });

  it('malformed args -> repair -> success', async () => {
    const provider = new FakeLLMProvider([
      toolCallResponse('echo', { wrongField: 'oops' }), // invalid: missing required "message"
      toolCallResponse('echo', { message: 'fixed' }), // repair turn's re-emitted call
      endResponse('Fixed it!'),
    ]);
    const { replyText } = await runDecisionTick(baseParams({ provider }));

    expect(replyText).toBe('Fixed it!');
    expect(provider.calls).toHaveLength(3);
    const toolResultMsg = provider.calls[2]?.messages.at(-1)?.toolResults?.[0];
    expect(toolResultMsg?.isError).toBe(false);
    expect(toolResultMsg?.content).toBe('echoed: fixed');
  });

  it('malformed args -> repair also fails -> reports the error and continues the tick', async () => {
    const provider = new FakeLLMProvider([
      toolCallResponse('echo', { wrongField: 1 }),
      toolCallResponse('echo', { stillWrong: 2 }), // repair attempt, still invalid
      endResponse('Sorry, could not do that.'),
    ]);
    const { replyText } = await runDecisionTick(baseParams({ provider }));

    expect(replyText).toBe('Sorry, could not do that.');
    const errorResult = provider.calls[2]?.messages.at(-1)?.toolResults?.[0];
    expect(errorResult?.isError).toBe(true);
    expect(errorResult?.content).toMatch(/Invalid arguments after repair/);
  });

  it('falls back gracefully when the iteration cap is hit without an "end"', async () => {
    // config sets decisionLoopMaxIterations=3; script it to keep calling tools forever.
    const responses = Array.from({ length: 3 }, () =>
      toolCallResponse('echo', { message: 'again' }),
    );
    const provider = new FakeLLMProvider(responses);

    const { replyText } = await runDecisionTick(baseParams({ provider }));

    expect(replyText).toMatch(/taking more steps than expected/);
    expect(provider.calls).toHaveLength(3);
  });

  it('returns immediately if the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new FakeLLMProvider([]);

    const { replyText } = await runDecisionTick(
      baseParams({ provider, signal: controller.signal }),
    );
    expect(replyText).toBe('Stopped.');
    expect(provider.calls).toHaveLength(0);
  });
});
