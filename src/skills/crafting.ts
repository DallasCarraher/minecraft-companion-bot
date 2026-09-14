import { z } from 'zod';
import { Vec3 } from 'vec3';
import type { Block } from 'prismarine-block';
import type { Bot } from 'mineflayer';
import { defineSkill } from './types.js';

/**
 * v1 scope: if a crafting table is required and the bot doesn't have one placed within reach, it
 * places one from inventory near its feet. It does *not* remove/retrieve the table afterward —
 * cleaning up placed tables is left for a later iteration.
 */
export const craftItem = defineSkill({
  name: 'craftItem',
  description:
    'Craft an item, placing a crafting table nearby from inventory if one is required and not already in reach.',
  argsSchema: z
    .object({
      itemName: z.string().min(1).describe('e.g. "stick", "wooden_pickaxe"'),
      count: z.number().int().positive().max(64).default(1),
    })
    .strict(),
  timeoutMs: 60_000,
  async run(ctx, args) {
    const { bot } = ctx;
    const itemData = bot.registry.itemsByName[args.itemName];
    if (!itemData) {
      throw new Error(`Unknown item "${args.itemName}"`);
    }

    const tableBlockData = bot.registry.blocksByName['crafting_table'];
    const nearbyTable = tableBlockData
      ? bot.findBlock({ matching: tableBlockData.id, maxDistance: 4 })
      : null;

    let recipes = bot.recipesFor(itemData.id, null, 1, nearbyTable ?? null);
    let craftingTable: Block | null = nearbyTable;

    if (recipes.length === 0 && !nearbyTable) {
      const placedTable = await placeCraftingTableFromInventory(ctx.bot);
      if (placedTable) {
        craftingTable = placedTable;
        recipes = bot.recipesFor(itemData.id, null, 1, placedTable);
      }
    }

    const recipe = recipes[0];
    if (!recipe) {
      return {
        ok: false,
        message: `No known recipe for ${args.itemName} with the ingredients currently on hand.`,
      };
    }

    await bot.craft(recipe, args.count, craftingTable ?? undefined);
    return { ok: true, message: `Crafted ${args.count}x ${args.itemName}.` };
  },
});

async function placeCraftingTableFromInventory(bot: Bot): Promise<Block | null> {
  const tableItem = bot.inventory.items().find((item) => item.name === 'crafting_table');
  if (!tableItem) return null;

  const belowBot = bot.blockAt(bot.entity.position.offset(0, -1, 0));
  if (!belowBot) return null;

  await bot.equip(tableItem, 'hand');
  await bot.placeBlock(belowBot, new Vec3(0, 1, 0));

  const tableBlockData = bot.registry.blocksByName['crafting_table'];
  return bot.findBlock({ matching: tableBlockData!.id, maxDistance: 4 });
}
