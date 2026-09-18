import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import { ChatRouter } from '../../../src/chat/router.js';
import { SkillRegistry } from '../../../src/skills/registry.js';
import { MemoryStore } from '../../../src/memory/store.js';
import { parseConfig } from '../../../src/config/env.js';
import { createFakeBot } from '../../fakes/fakeBot.js';
import { FakeLLMProvider, endResponse } from '../../fakes/fakeLLMProvider.js';
import type { LLMProvider, NormalizedResponse } from '../../../src/llm/types.js';

const silentLogger = pino({ level: 'silent' });

let dataDir: string;
let memory: MemoryStore;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcb-router-test-'));
  memory = await MemoryStore.loadOrCreate('default', dataDir);
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

function makeRouter(
  configOverrides: Record<string, string> = {},
  provider: LLMProvider = new FakeLLMProvider([]),
) {
  const chatLines: string[] = [];
  const whispers: { username: string; message: string }[] = [];
  const bot = createFakeBot({
    chat: (msg: string) => chatLines.push(msg),
    whisper: (username: string, msg: string) => whispers.push({ username, message: msg }),
  });

  const config = parseConfig({
    botUsername: 'bot@example.com',
    minecraftVersion: '1.21.4',
    connectionMode: 'direct',
    serverHost: 'localhost',
    msAuthProfilesFolder: './.minecraft-auth',
    llmProvider: 'anthropic',
    anthropicApiKey: 'sk-test',
    chatTriggerMode: 'mention',
    chatCooldownMs: '3000',
    ...configOverrides,
  });

  const router = new ChatRouter({
    bot,
    memory,
    provider,
    registry: new SkillRegistry(),
    config,
    logger: silentLogger,
  });
  router.attach();

  return { bot, router, chatLines, whispers, config };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ChatRouter', () => {
  it('ignores messages from a disallowed sender when an allowlist is set', async () => {
    const { bot, chatLines } = makeRouter({ chatAllowlist: 'Alice' });
    bot.emit('chat', 'Mallory', 'TestBot come here');
    await flush();
    expect(chatLines).toHaveLength(0);
  });

  it('ignores untriggered chat in mention mode but still records it to memory', async () => {
    const { bot, chatLines } = makeRouter({ chatTriggerMode: 'mention' });
    bot.emit('chat', 'Alice', 'just chatting, not talking to the bot');
    await flush();
    expect(chatLines).toHaveLength(0);
    expect(memory.snapshot.conversation).toHaveLength(1);
  });

  it('handles "stop" as a built-in command without calling the LLM', async () => {
    let providerCalls = 0;
    const provider: LLMProvider = {
      name: 'fake',
      createTurn: async () => {
        providerCalls++;
        return endResponse('should not happen');
      },
    };
    const { bot, chatLines } = makeRouter({}, provider);

    bot.emit('chat', 'Alice', 'TestBot stop');
    await flush();

    expect(chatLines).toEqual(['Stopped.']);
    expect(providerCalls).toBe(0);
  });

  it('handles "status" as a built-in command without calling the LLM', async () => {
    let providerCalls = 0;
    const provider: LLMProvider = {
      name: 'fake',
      createTurn: async () => {
        providerCalls++;
        return endResponse('');
      },
    };
    const { bot, chatLines } = makeRouter({}, provider);

    bot.emit('chat', 'Alice', 'TestBot status');
    await flush();

    expect(chatLines).toEqual(["I'm not doing anything right now."]);
    expect(providerCalls).toBe(0);
  });

  it('applies a per-user cooldown between LLM-triggering messages', async () => {
    const provider: LLMProvider = { name: 'fake', createTurn: async () => endResponse('done') };
    const { bot, chatLines } = makeRouter({ chatCooldownMs: '60000' }, provider);

    bot.emit('chat', 'Alice', 'TestBot say hi');
    await flush();
    const firstReplyCount = chatLines.length;
    expect(firstReplyCount).toBeGreaterThan(0);

    bot.emit('chat', 'Alice', 'TestBot say hi again');
    await flush();

    expect(chatLines.at(-1)).toBe('One sec...');
  });

  it('replies with a busy message instead of double-dispatching while a tick is in flight', async () => {
    let resolveFirst!: (response: NormalizedResponse) => void;
    const provider: LLMProvider = {
      name: 'fake',
      createTurn: () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    };
    const { bot, chatLines } = makeRouter({}, provider);

    bot.emit('chat', 'Alice', 'TestBot build a house');
    await flush();
    // The first tick is now in flight (blocked on the unresolved provider promise).

    bot.emit('chat', 'Bob', 'TestBot come here');
    await flush();
    expect(chatLines.at(-1)).toMatch(/still working on/i);

    resolveFirst(endResponse('Built it!'));
    await flush();
    expect(chatLines).toContain('Built it!');
  });

  it('treats a whisper as always-triggered and replies over whisper, not public chat', async () => {
    const provider: LLMProvider = { name: 'fake', createTurn: async () => endResponse('hi!') };
    const { bot, chatLines, whispers } = makeRouter({}, provider);

    // No mention of the bot's name needed — a whisper is already a direct address.
    bot.emit('whisper', 'Alice', 'say hi');
    await flush();

    expect(chatLines).toHaveLength(0);
    expect(whispers.map((w) => w.message)).toContain('hi!');
    expect(whispers.every((w) => w.username === 'Alice')).toBe(true);
  });

  it('does not double-reply "Stopped." when "stop" cancels an in-flight tick', async () => {
    let resolveFirst!: (response: NormalizedResponse) => void;
    const provider: LLMProvider = {
      name: 'fake',
      createTurn: () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    };
    const { bot, chatLines } = makeRouter({}, provider);

    bot.emit('chat', 'Alice', 'TestBot follow me');
    await flush();
    // The tick is now blocked inside its first LLM call.

    bot.emit('chat', 'Alice', 'TestBot stop');
    await flush();
    // "stop" replies immediately and aborts the in-flight controller...

    resolveFirst(endResponse('should be swallowed by the abort check'));
    await flush();
    // ...so when the blocked LLM call finally resolves, decisionLoop's next iteration sees
    // signal.aborted and returns its own "Stopped." — which the router must not also relay.

    expect(chatLines.filter((line) => line === 'Stopped.')).toHaveLength(1);
  });
});
