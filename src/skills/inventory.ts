import { z } from 'zod';
import { Vec3 } from 'vec3';
import type { Bot, Chest } from 'mineflayer';
import { defineSkill } from './types.js';

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

export const depositToChest = defineSkill({
  name: 'depositToChest',
  description: 'Open a chest at the given position and deposit an item into it.',
  argsSchema: z
    .object({
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
      await chest.deposit(itemData.id, null, args.count);
      return { ok: true, message: `Deposited ${args.count}x ${args.itemName}.` };
    } finally {
      await chest.close();
    }
  },
});

export const withdrawFromChest = defineSkill({
  name: 'withdrawFromChest',
  description: 'Open a chest at the given position and withdraw an item from it.',
  argsSchema: z
    .object({
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
      await chest.withdraw(itemData.id, null, args.count);
      return { ok: true, message: `Withdrew ${args.count}x ${args.itemName}.` };
    } finally {
      await chest.close();
    }
  },
});
