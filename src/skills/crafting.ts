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
      // Distinguish "missing table" from "missing ingredients" so a failed craft doesn't read as
      // a materials shortage — that misreading is what previously sent the model off gathering
      // raw blocks (e.g. chopping wood) for a recipe that actually just needed a table nearby.
      if (!craftingTable && bot.recipesFor(itemData.id, null, args.count, true).length > 0) {
        return {
          ok: false,
          message: `Crafting ${args.itemName} needs a crafting table, and I don't have one nearby or in my inventory.`,
        };
      }
      const missing = missingIngredientsFor(bot, itemData.id, craftingTable);
      if (missing) {
        return {
          ok: false,
          message: `Can't craft ${args.itemName} yet — missing ${missing}.`,
        };
      }
      return {
        ok: false,
        message: `No known recipe for ${args.itemName} with the ingredients currently on hand.`,
      };
    }

    await bot.craft(recipe, args.count, craftingTable ?? undefined);
    return { ok: true, message: `Crafted ${args.count}x ${args.itemName}.` };
  },
});

/**
 * Names what's still missing for the closest-to-craftable recipe, e.g. "2x oak_planks". Used to
 * turn a dead-end "no recipe" failure into something the model can act on next (go get/craft the
 * missing ingredient) instead of guessing.
 */
function missingIngredientsFor(
  bot: Bot,
  itemId: number,
  craftingTable: Block | null,
): string | null {
  const candidates = bot.recipesAll(itemId, null, craftingTable);
  if (candidates.length === 0) return null;

  // Many recipes (sticks, tools, etc.) exist once per wood/material variant. Prefer the variant
  // that matches something the bot already holds (e.g. report "oak_planks" over "cherry_planks"
  // when the bot is carrying oak_logs), so the suggestion is actually actionable.
  const heldPrefixes = new Set(
    bot.inventory
      .items()
      .map((item) => item.name.split('_')[0])
      .filter((prefix): prefix is string => Boolean(prefix)),
  );

  let best: { name: string; count: number }[] | null = null;
  let bestMatchesHeld = false;
  for (const recipe of candidates) {
    const shortfall: { name: string; count: number }[] = [];
    let matchesHeld = true;
    for (const d of recipe.delta) {
      if (d.count >= 0) continue;
      const have = bot.inventory.count(d.id, d.metadata);
      const need = -d.count - have;
      if (need > 0) {
        const name = bot.registry.items[d.id]?.name ?? `item#${d.id}`;
        shortfall.push({ name, count: need });
        if (!heldPrefixes.has(name.split('_')[0] ?? '')) matchesHeld = false;
      }
    }
    const better =
      best === null ||
      shortfall.length < best.length ||
      (shortfall.length === best.length && matchesHeld && !bestMatchesHeld);
    if (better) {
      best = shortfall;
      bestMatchesHeld = matchesHeld;
    }
    if (best?.length === 0) break;
  }

  if (!best || best.length === 0) return null;
  return best.map((s) => `${s.count}x ${s.name}`).join(', ');
}

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
