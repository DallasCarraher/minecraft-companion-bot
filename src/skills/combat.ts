import { z } from 'zod';
import { defineSkill } from './types.js';

export const attackNearest = defineSkill({
  name: 'attackNearest',
  category: 'combat',
  description: 'Attack the nearest hostile mob, or a specific mob/player if named.',
  argsSchema: z
    .object({
      target: z
        .string()
        .nullable()
        .default(null)
        .describe('Mob type (e.g. "zombie") or player username; null for nearest hostile mob'),
    })
    .strict(),
  timeoutMs: 60_000,
  async run(ctx, args) {
    const entity = ctx.bot.nearestEntity((e) => {
      if (args.target) return e.name === args.target || e.username === args.target;
      return e.type === 'hostile';
    });

    if (!entity) {
      return {
        ok: false,
        message: args.target ? `Couldn't find "${args.target}" nearby.` : 'No hostile mobs nearby.',
      };
    }

    const onAbort = () => {
      void ctx.bot.pvp.stop();
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await ctx.bot.pvp.attack(entity);
      return { ok: true, message: `Defeated ${entity.name ?? entity.username ?? 'target'}.` };
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
  },
});

export const stopCombat = defineSkill({
  name: 'stopCombat',
  category: 'combat',
  description: 'Stop the current attack, if any.',
  argsSchema: z.object({}).strict(),
  timeoutMs: 5_000,
  async run(ctx) {
    await ctx.bot.pvp.stop();
    return { ok: true, message: 'Stopped attacking.' };
  },
});
