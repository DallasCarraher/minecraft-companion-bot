import { z } from 'zod';
import { defineSkill } from './types.js';
import type { Block } from 'prismarine-block';

export const collectBlock = defineSkill({
  name: 'collectBlock',
  description: 'Mine and pick up the nearest blocks of a given type, up to a target count.',
  argsSchema: z
    .object({
      blockName: z.string().min(1).describe('Block id, e.g. "oak_log", "stone", "iron_ore"'),
      count: z.number().int().positive().max(64).default(1),
    })
    .strict(),
  timeoutMs: 120_000,
  async run(ctx, args) {
    const blockData = ctx.bot.registry.blocksByName[args.blockName];
    if (!blockData) {
      throw new Error(`Unknown block type "${args.blockName}"`);
    }

    const positions = ctx.bot.findBlocks({
      matching: blockData.id,
      maxDistance: ctx.config.pathfinderMaxDistance,
      count: args.count,
    });
    const blocks = positions
      .map((pos) => ctx.bot.blockAt(pos))
      .filter((block): block is Block => block !== null);

    if (blocks.length === 0) {
      return { ok: false, message: `Couldn't find any "${args.blockName}" nearby.` };
    }

    const onAbort = () => {
      void ctx.bot.collectBlock.cancelTask();
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await ctx.bot.collectBlock.collect(blocks);
      return { ok: true, message: `Collected ${blocks.length}x ${args.blockName}.` };
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
  },
});

export const equipBestTool = defineSkill({
  name: 'equipBestTool',
  description: 'Equip the best available tool in inventory for harvesting a given block type.',
  argsSchema: z.object({ blockName: z.string().min(1) }).strict(),
  timeoutMs: 10_000,
  async run(ctx, args) {
    const blockData = ctx.bot.registry.blocksByName[args.blockName];
    if (!blockData) {
      throw new Error(`Unknown block type "${args.blockName}"`);
    }
    const nearby = ctx.bot.findBlock({
      matching: blockData.id,
      maxDistance: ctx.config.pathfinderMaxDistance,
    });
    if (!nearby) {
      return {
        ok: false,
        message: `Couldn't find "${args.blockName}" nearby to size a tool against.`,
      };
    }
    await ctx.bot.tool.equipForBlock(nearby, { requireHarvest: false });
    return { ok: true, message: `Equipped best tool for ${args.blockName}.` };
  },
});
