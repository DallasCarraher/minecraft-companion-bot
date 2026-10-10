import { describe, expect, it, vi } from 'vitest';
import { craftItem } from '../../../src/skills/crafting.js';
import { createFakeBot } from '../../fakes/fakeBot.js';
import type { SkillContext } from '../../../src/skills/types.js';

const bowRecipe = { result: { id: 99, count: 1 }, requiresTable: true };

function makeCtx(overrides: Record<string, unknown> = {}) {
  const bot = createFakeBot({
    registry: {
      itemsByName: { bow: { id: 99 }, stick: { id: 5 } },
      blocksByName: { crafting_table: { id: 58 } },
    },
    findBlock: () => null,
    recipesFor: () => [],
    craft: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  });
  const ctx = {
    bot,
    say: vi.fn<(message: string) => void>(),
    signal: new AbortController().signal,
  } as unknown as SkillContext;
  return { ctx, bot };
}

describe('craftItem.argsSchema', () => {
  it('accepts a valid itemName and applies the count default', () => {
    const data = craftItem.argsSchema.parse({ itemName: 'stick' });
    expect(data.count).toBe(1);
  });

  it('rejects an empty itemName', () => {
    expect(craftItem.argsSchema.safeParse({ itemName: '' }).success).toBe(false);
  });

  it('rejects a count above the max', () => {
    expect(craftItem.argsSchema.safeParse({ itemName: 'stick', count: 65 }).success).toBe(false);
  });
});

describe('craftItem.run', () => {
  it('throws for an unknown item', async () => {
    const { ctx } = makeCtx();
    await expect(craftItem.run(ctx, { itemName: 'not_a_real_item', count: 1 })).rejects.toThrow(
      /Unknown item/,
    );
  });

  it('reports a missing crafting table distinctly from missing ingredients', async () => {
    const { ctx } = makeCtx({
      // No table-eligible recipe without a table; one exists once a table is available.
      recipesFor: (_id: number, _meta: unknown, _count: number, craftingTable: unknown) =>
        craftingTable ? [bowRecipe] : [],
    });
    const result = await craftItem.run(ctx, { itemName: 'bow', count: 1 });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/crafting table/i);
  });

  it('reports missing ingredients when no table would help either', async () => {
    const { ctx } = makeCtx({ recipesFor: () => [] });
    const result = await craftItem.run(ctx, { itemName: 'bow', count: 1 });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no known recipe/i);
  });

  it('names the missing ingredients when a recipe exists but inventory is short', async () => {
    const stickRecipe = {
      result: { id: 5, count: 4 },
      requiresTable: false,
      delta: [{ id: 6, metadata: null, count: -2 }],
    };
    const { ctx } = makeCtx({
      recipesFor: () => [],
      recipesAll: () => [stickRecipe],
      registry: {
        itemsByName: { bow: { id: 99 }, stick: { id: 5 } },
        blocksByName: { crafting_table: { id: 58 } },
        items: { 6: { name: 'oak_planks' } },
      },
    });
    const result = await craftItem.run(ctx, { itemName: 'stick', count: 1 });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/2x oak_planks/);
  });

  it('prefers the wood variant the bot is already carrying when several recipes tie', async () => {
    const cherryStickRecipe = {
      result: { id: 5, count: 4 },
      requiresTable: false,
      delta: [{ id: 7, metadata: null, count: -2 }],
    };
    const oakStickRecipe = {
      result: { id: 5, count: 4 },
      requiresTable: false,
      delta: [{ id: 6, metadata: null, count: -2 }],
    };
    const { ctx } = makeCtx({
      recipesFor: () => [],
      recipesAll: () => [cherryStickRecipe, oakStickRecipe],
      inventory: { items: () => [{ name: 'oak_log' }], count: () => 0 },
      registry: {
        itemsByName: { bow: { id: 99 }, stick: { id: 5 } },
        blocksByName: { crafting_table: { id: 58 } },
        items: { 6: { name: 'oak_planks' }, 7: { name: 'cherry_planks' } },
      },
    });
    const result = await craftItem.run(ctx, { itemName: 'stick', count: 1 });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/2x oak_planks/);
  });

  it('crafts directly when a recipe is already available', async () => {
    const { ctx, bot } = makeCtx({ recipesFor: () => [bowRecipe] });
    const result = await craftItem.run(ctx, { itemName: 'bow', count: 1 });
    expect(result.ok).toBe(true);
    expect(bot.craft).toHaveBeenCalledWith(bowRecipe, 1, undefined);
  });
});
