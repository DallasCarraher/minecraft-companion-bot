import { z } from 'zod';
import { Vec3 } from 'vec3';
import pathfinderPkg from 'mineflayer-pathfinder';
import { defineSkill } from './types.js';

const { goals } = pathfinderPkg;

/**
 * v1 scope is deliberately narrow: simple parametric shapes only (a flat wall or floor), not
 * arbitrary schematics. This is flagged in the architecture plan as the hardest skill to get
 * robust — every target position needs an already-solid block beneath/behind it to place
 * against, so this works well for building on flat ground and poorly for anything requiring
 * placement against a side face or over a gap. Revisit with a proper reference-face solver
 * (e.g. pathfinder's `GoalPlaceBlock`) once there's real-world usage to design against.
 */
export const buildStructure = defineSkill({
  name: 'buildStructure',
  description:
    'Build a simple flat wall or floor out of one block type, starting at a given position.',
  argsSchema: z
    .object({
      shape: z.enum(['wall', 'floor']),
      origin: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      width: z.number().int().positive().max(32),
      /** For "wall": how many blocks tall. For "floor": how many blocks deep along Z. */
      depthOrHeight: z.number().int().positive().max(32),
      block: z.string().min(1).describe('Block id to build with, e.g. "cobblestone"'),
    })
    .strict(),
  timeoutMs: 300_000,
  async run(ctx, args) {
    const { bot } = ctx;
    const blockData = bot.registry.blocksByName[args.block];
    if (!blockData) throw new Error(`Unknown block type "${args.block}"`);

    const positions: Vec3[] =
      args.shape === 'wall'
        ? Array.from({ length: args.width }, (_col, x) =>
            Array.from(
              { length: args.depthOrHeight },
              (_row, y) => new Vec3(args.origin.x + x, args.origin.y + y, args.origin.z),
            ),
          ).flat()
        : Array.from({ length: args.width }, (_col, x) =>
            Array.from(
              { length: args.depthOrHeight },
              (_row, zOffset) =>
                new Vec3(args.origin.x + x, args.origin.y, args.origin.z + zOffset),
            ),
          ).flat();

    let placed = 0;
    for (const pos of positions) {
      if (ctx.signal.aborted) break;

      const existing = bot.blockAt(pos);
      if (existing?.type === blockData.id) {
        placed++; // already there, nothing to do
        continue;
      }

      const referencePos = pos.offset(0, -1, 0);
      const referenceBlock = bot.blockAt(referencePos);
      if (!referenceBlock || referenceBlock.boundingBox === 'empty') {
        continue; // no solid block to place against yet; skip rather than fail the whole build
      }

      const item = bot.inventory.items().find((i) => i.name === args.block);
      if (!item) {
        return {
          ok: false,
          message: `Ran out of ${args.block} after placing ${placed}/${positions.length} blocks.`,
        };
      }

      const onAbort = () => bot.pathfinder.stop();
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      try {
        await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3));
        await bot.equip(item, 'hand');
        await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
        placed++;
      } catch (err) {
        ctx.logger.warn({ err, pos }, 'failed to place block during buildStructure, continuing');
      } finally {
        ctx.signal.removeEventListener('abort', onAbort);
      }
    }

    return {
      ok: placed === positions.length,
      message: `Placed ${placed}/${positions.length} ${args.block} block(s) for the ${args.shape}.`,
    };
  },
});
