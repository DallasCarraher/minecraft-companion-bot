import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import { runDecisionTick } from '../../../src/llm/decisionLoop.js';
import { SkillRegistry } from '../../../src/skills/registry.js';
import { registerAllSkills } from '../../../src/skills/index.js';
import { MemoryStore } from '../../../src/memory/store.js';
import { parseConfig } from '../../../src/config/env.js';
import { buildSystemPrompt } from '../../../src/prompts/system.js';
import { buildToolSpecs } from '../../../src/llm/toolSchema.js';
import { createFakeBot } from '../../fakes/fakeBot.js';
import { FakeLLMProvider, endResponse, toolCallResponse } from '../../fakes/fakeLLMProvider.js';
import { estimateTickCost, estimateTokens, HAIKU_4_5_PRICING } from '../../fakes/costEstimate.js';

/**
 * Simulates the "chop some oak logs for me" scenario end-to-end through the real decision loop
 * and the real skill registry (so the tool-definition payload is exactly what production sends),
 * with a scripted LLM and a stubbed Mineflayer surface standing in for the network/game.
 *
 * Cost figures are estimates (see tests/fakes/costEstimate.ts) meant to catch order-of-magnitude
 * regressions — e.g. someone adding several chatty new skills, or the loop taking an extra turn
 * for a task that shouldn't need one — not to reproduce exact Anthropic billing.
 */

const silentLogger = pino({ level: 'silent' });

let dataDir: string;
let memory: MemoryStore;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcb-scenario-cost-'));
  memory = await MemoryStore.loadOrCreate('default', dataDir);
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

function makeConfig() {
  return parseConfig({
    botUsername: 'bot@example.com',
    minecraftVersion: '1.21.4',
    connectionMode: 'direct',
    serverHost: 'localhost',
    msAuthProfilesFolder: './.minecraft-auth',
    llmProvider: 'anthropic',
    anthropicApiKey: 'sk-test',
  });
}

/** A bot standing near exactly 5 oak logs, with a small starting inventory. */
function makeSceneBot() {
  const oakLogBlock = { type: 17, name: 'oak_log' };
  return createFakeBot({
    inventory: {
      items: () => [
        { name: 'stone_pickaxe', count: 1 },
        { name: 'bread', count: 4 },
        { name: 'torch', count: 12 },
      ],
    },
    registry: { blocksByName: { oak_log: { id: 17 } }, itemsByName: {} },
    findBlocks: () => Array.from({ length: 5 }, (_, i) => ({ x: i, y: 64, z: 0 })),
    blockAt: () => oakLogBlock,
    collectBlock: { collect: async () => {}, cancelTask: async () => {} },
  });
}

describe('scenario: "chop some oak logs for me" — Haiku 4.5 cost simulation', () => {
  it('resolves in exactly 2 LLM calls: pick the skill, then reply', async () => {
    const registry = new SkillRegistry();
    registerAllSkills(registry);

    const responses = [
      toolCallResponse('collectBlock', { blockName: 'oak_log', count: 5 }),
      endResponse('Got 5 oak logs for you!'),
    ];
    const provider = new FakeLLMProvider(responses);
    const config = makeConfig();

    const { replyText } = await runDecisionTick({
      bot: makeSceneBot(),
      logger: silentLogger,
      memory,
      config,
      registry,
      provider,
      triggerMessage: {
        role: 'user',
        username: 'Steve',
        text: 'chop some oak logs for me',
        at: new Date().toISOString(),
      },
      systemPrompt: buildSystemPrompt(config),
      signal: new AbortController().signal,
      say: () => {},
    });

    expect(replyText).toBe('Got 5 oak logs for you!');
    expect(provider.calls).toHaveLength(2);

    // The skill actually ran (against the fake bot) and its real result made it into call #2.
    const toolResult = provider.calls[1]?.messages.at(-1)?.toolResults?.[0];
    expect(toolResult).toMatchObject({ content: 'Collected 5x oak_log.', isError: false });
  });

  it('costs a fraction of a cent on Haiku 4.5, dominated by tool-definition overhead', async () => {
    const registry = new SkillRegistry();
    registerAllSkills(registry);

    const responses = [
      toolCallResponse('collectBlock', { blockName: 'oak_log', count: 5 }),
      endResponse('Got 5 oak logs for you!'),
    ];
    const provider = new FakeLLMProvider(responses);
    const config = makeConfig();

    await runDecisionTick({
      bot: makeSceneBot(),
      logger: silentLogger,
      memory,
      config,
      registry,
      provider,
      triggerMessage: {
        role: 'user',
        username: 'Steve',
        text: 'chop some oak logs for me',
        at: new Date().toISOString(),
      },
      systemPrompt: buildSystemPrompt(config),
      signal: new AbortController().signal,
      say: () => {},
    });

    const { perCall, totalInputTokens, totalOutputTokens, totalCost } = estimateTickCost(
      provider.calls,
      responses,
      HAIKU_4_5_PRICING,
    );

    // eslint-disable-next-line no-console -- intentional: surfaces the number when the test runs.
    console.log(
      `[scenario cost] ${totalInputTokens} in / ${totalOutputTokens} out tokens ≈ $${totalCost.toFixed(4)}`,
    );

    // Baked-in expectations from the walkthrough. Bounds are wide because this is a char-count
    // heuristic, not the real tokenizer — the point is to catch order-of-magnitude regressions
    // (e.g. a much larger tool set, or an unexpected extra turn), not to nail an exact figure.
    // No hostiles and no active goal/task in this scenario, so `filterRelevantSkills` drops the
    // 3 combat skills and 2 goal-gated skills, leaving 8 of the 13 registered skills' schemas on
    // the wire — lower than the pre-filtering baseline.
    expect(totalInputTokens).toBeGreaterThan(2000);
    expect(totalInputTokens).toBeLessThan(3200);
    expect(totalOutputTokens).toBeLessThan(150);
    expect(totalCost).toBeGreaterThan(0.002);
    expect(totalCost).toBeLessThan(0.005);

    // The architectural point this scenario is meant to demonstrate: most of the first call's
    // input tokens are still tool-definition overhead unrelated to this specific task, even after
    // filtering trims out the skills that plainly don't apply.
    const firstCall = perCall[0];
    const firstCallToolTokens = estimateTokens(JSON.stringify(provider.calls[0]?.tools));
    expect(firstCall && firstCallToolTokens / firstCall.inputTokens).toBeGreaterThan(0.4);
  });

  it('sends fewer tool schemas than the full registry when combat/goal-gated skills do not apply', async () => {
    const registry = new SkillRegistry();
    registerAllSkills(registry);

    const responses = [
      toolCallResponse('collectBlock', { blockName: 'oak_log', count: 5 }),
      endResponse('Got 5 oak logs for you!'),
    ];
    const provider = new FakeLLMProvider(responses);
    const config = makeConfig();

    await runDecisionTick({
      bot: makeSceneBot(),
      logger: silentLogger,
      memory,
      config,
      registry,
      provider,
      triggerMessage: {
        role: 'user',
        username: 'Steve',
        text: 'chop some oak logs for me',
        at: new Date().toISOString(),
      },
      systemPrompt: buildSystemPrompt(config),
      signal: new AbortController().signal,
      say: () => {},
    });

    // No hostiles nearby and no active goal/task, so combat (attackNearest, stopCombat, fleeFrom)
    // and goal-gated (craftItem, buildStructure) skills are filtered out of every call's tools.
    const sentToolNames = provider.calls[0]?.tools.map((tool) => tool.name) ?? [];
    expect(sentToolNames.length).toBe(registry.list().length - 5);
    expect(sentToolNames).not.toContain('attackNearest');
    expect(sentToolNames).not.toContain('stopCombat');
    expect(sentToolNames).not.toContain('fleeFrom');
    expect(sentToolNames).not.toContain('craftItem');
    expect(sentToolNames).not.toContain('buildStructure');

    const fullRegistryToolTokens = estimateTokens(JSON.stringify(buildToolSpecs(registry.list())));
    const filteredToolTokens = estimateTokens(JSON.stringify(provider.calls[0]?.tools));
    expect(filteredToolTokens).toBeLessThan(fullRegistryToolTokens);
  });
});
