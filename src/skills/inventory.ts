import { z } from 'zod';
import { Vec3 } from 'vec3';
import type { Bot, Chest } from 'mineflayer';
import { defineSkill } from './types.js';
import { eatBestFood } from '../mineflayer/eat.js';
import { bestMelee } from '../mineflayer/weapons.js';

export const equipArmor = defineSkill({
  name: 'equipArmor',
  description: "Equip the best available armor pieces from the bot's inventory.",
  argsSchema: z.object({}).strict(),
  timeoutMs: 15_000,
  async run(ctx) {
    await ctx.bot.armorManager.equipAll();
    return { ok: true, message: 'Equipped best available armor.' };
  },
});

export const equipItem = defineSkill({
  name: 'equipItem',
  description:
    'Equip a weapon (sword, axe, bow, shield, etc.) from inventory to the hand or off-hand. ' +
    'Give the exact item name to equip a specific one; omit it to equip the best available melee weapon.',
  argsSchema: z
    .object({
      itemName: z
        .string()
        .min(1)
        .nullable()
        .default(null)
        .describe('Exact item name, e.g. "iron_sword"; null to equip the best available melee weapon'),
      destination: z.enum(['hand', 'off-hand']).default('hand'),
    })
    .strict(),
  timeoutMs: 15_000,
  async run(ctx, args) {
    const items = ctx.bot.inventory.items();
    const item = args.itemName ? items.find((i) => i.name === args.itemName) : bestMelee(items);

    if (!item) {
      return {
        ok: false,
        message: args.itemName
          ? `I don't have "${args.itemName}" in my inventory.`
          : 'I have no melee weapon to equip.',
      };
    }

    await ctx.bot.equip(item, args.destination);
    return { ok: true, message: `Equipped ${item.name} to ${args.destination}.` };
  },
});

export const eatFood = defineSkill({
  name: 'eatFood',
  description: 'Eat the best food in the inventory to restore hunger.',
  argsSchema: z.object({}).strict(),
  timeoutMs: 15_000,
  async run(ctx) {
    if (ctx.bot.food >= 20) return { ok: false, message: 'Not hungry — hunger bar is full.' };
    try {
      const eaten = await eatBestFood(ctx.bot);
      if (!eaten) return { ok: false, message: 'I have no edible food.' };
      return { ok: true, message: `Ate ${eaten}. Food is now ${ctx.bot.food}/20.` };
    } catch (err) {
      return { ok: false, message: `Couldn't eat: ${err instanceof Error ? err.message : err}` };
    }
  },
});

export const dropJunk = defineSkill({
  name: 'dropJunk',
  description: 'Drop all inventory items matching the given item names.',
  argsSchema: z
    .object({
      itemNames: z.array(z.string().min(1)).min(1).describe('e.g. ["rotten_flesh", "cobblestone"]'),
    })
    .strict(),
  timeoutMs: 20_000,
  async run(ctx, args) {
    const wanted = new Set(args.itemNames);
    const toDrop = ctx.bot.inventory.items().filter((item) => wanted.has(item.name));
    for (const item of toDrop) {
      await ctx.bot.tossStack(item);
    }
    return {
      ok: true,
      message: `Dropped ${toDrop.length} stack(s): ${args.itemNames.join(', ')}.`,
    };
  },
});

const chestPositionSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });

async function openChestAt(
  ctx: { bot: Bot },
  pos: z.infer<typeof chestPositionSchema>,
): Promise<Chest> {
  const block = ctx.bot.blockAt(new Vec3(pos.x, pos.y, pos.z));
  if (!block) {
    throw new Error(`No block found at (${pos.x}, ${pos.y}, ${pos.z})`);
  }
  const container = await ctx.bot.openContainer(block);
  // `Chest` has no matching runtime export from the `mineflayer` package (its .d.ts declares one,
  // but the actual module never binds it) — `instanceof Chest` would crash, so check structurally.
  if (typeof (container as Partial<Chest>).deposit !== 'function') {
    throw new Error(`Block at (${pos.x}, ${pos.y}, ${pos.z}) is not a chest`);
  }
  return container as Chest;
}

export const chestTransfer = defineSkill({
  name: 'chestTransfer',
  description: 'Open a chest at the given position and deposit or withdraw an item.',
  argsSchema: z
    .object({
      direction: z.enum(['deposit', 'withdraw']),
      position: chestPositionSchema,
      itemName: z.string().min(1),
      count: z.number().int().positive().max(64).default(64),
    })
    .strict(),
  timeoutMs: 30_000,
  async run(ctx, args) {
    const itemData = ctx.bot.registry.itemsByName[args.itemName];
    if (!itemData) throw new Error(`Unknown item "${args.itemName}"`);

    const chest = await openChestAt(ctx, args.position);
    try {
      if (args.direction === 'deposit') {
        await chest.deposit(itemData.id, null, args.count);
        return { ok: true, message: `Deposited ${args.count}x ${args.itemName}.` };
      }
      await chest.withdraw(itemData.id, null, args.count);
      return { ok: true, message: `Withdrew ${args.count}x ${args.itemName}.` };
    } finally {
      await chest.close();
    }
  },
});
