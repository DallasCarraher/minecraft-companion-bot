import { describe, expect, it, vi } from 'vitest';
import { collectBlock, equipBestTool } from '../../../src/skills/gathering.js';
import { createFakeBot } from '../../fakes/fakeBot.js';
import type { SkillContext } from '../../../src/skills/types.js';

function makeCtx(overrides: Record<string, unknown> = {}) {
  const bot = createFakeBot({
    registry: { blocksByName: { oak_log: { id: 17 }, oak_planks: { id: 5 } } },
    findBlocks: vi.fn().mockReturnValue([]),
    config: { pathfinderMaxDistance: 32 },
    collectBlock: { collect: vi.fn().mockResolvedValue(undefined), cancelTask: vi.fn() },
    ...overrides,
  });
  const ctx = {
    bot,
    config: { pathfinderMaxDistance: 32 },
    say: vi.fn(),
    signal: new AbortController().signal,
  } as unknown as SkillContext;
  return { ctx, bot };
}

describe('collectBlock.argsSchema', () => {
  it('accepts a valid blockName and applies the count default', () => {
    const data = collectBlock.argsSchema.parse({ blockName: 'oak_log' });
    expect(data.count).toBe(1);
  });

  it('rejects a count above the max', () => {
    expect(collectBlock.argsSchema.safeParse({ blockName: 'oak_log', count: 65 }).success).toBe(
      false,
    );
  });

  it('rejects a non-integer count', () => {
    expect(collectBlock.argsSchema.safeParse({ blockName: 'oak_log', count: 1.5 }).success).toBe(
      false,
    );
  });
});

describe('collectBlock.run', () => {
  it('refuses a manufactured/build block type without touching the world', async () => {
    const { ctx, bot } = makeCtx();
    const result = await collectBlock.run(ctx, { blockName: 'oak_planks', count: 1 });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/build/i);
    expect(bot.findBlocks).not.toHaveBeenCalled();
  });

  it('throws for an unknown block type', async () => {
    const { ctx } = makeCtx();
    await expect(collectBlock.run(ctx, { blockName: 'not_a_real_block', count: 1 })).rejects.toThrow(
      /Unknown block type/,
    );
  });

  it('reports nothing found when no matching raw resource is nearby', async () => {
    const { ctx } = makeCtx({ findBlocks: () => [] });
    const result = await collectBlock.run(ctx, { blockName: 'oak_log', count: 1 });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/couldn't find/i);
  });
});

describe('equipBestTool.argsSchema', () => {
  it('accepts a valid blockName', () => {
    expect(equipBestTool.argsSchema.safeParse({ blockName: 'stone' }).success).toBe(true);
  });

  it('rejects a missing blockName', () => {
    expect(equipBestTool.argsSchema.safeParse({}).success).toBe(false);
  });
});
