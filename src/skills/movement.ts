import { z } from 'zod';
import pathfinderPkg from 'mineflayer-pathfinder';
import type { Bot } from 'mineflayer';
import { defineSkill } from './types.js';

const { goals } = pathfinderPkg;

function findPlayerEntity(bot: Bot, username: string) {
  const player = bot.players[username];
  if (!player?.entity) {
    throw new Error(`Can't see player "${username}" nearby`);
  }
  return player.entity;
}

export const goToPlayer = defineSkill({
  name: 'goToPlayer',
  category: 'movement',
  description: "Path to within a short distance of the given player's current position.",
  argsSchema: z
    .object({
      playerName: z.string().min(1).describe('Exact in-game username to walk to'),
      maxDistance: z
        .number()
        .int()
        .positive()
        .max(256)
        .default(3)
        .describe('How close to get, in blocks'),
    })
    .strict(),
  timeoutMs: 60_000,
  async run(ctx, args) {
    const entity = findPlayerEntity(ctx.bot, args.playerName);
    const goal = new goals.GoalFollow(entity, args.maxDistance);

    const onAbort = () => ctx.bot.pathfinder.stop();
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await ctx.bot.pathfinder.goto(goal);
      return { ok: true, message: `Reached ${args.playerName}.` };
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
  },
});

export const followPlayer = defineSkill({
  name: 'followPlayer',
  category: 'movement',
  description: 'Continuously follow a player until told to stop or given a new goal.',
  argsSchema: z
    .object({
      playerName: z.string().min(1),
      maxDistance: z.number().int().positive().max(256).default(3),
    })
    .strict(),
  timeoutMs: 600_000,
  async run(ctx, args) {
    const entity = findPlayerEntity(ctx.bot, args.playerName);
    const goal = new goals.GoalFollow(entity, args.maxDistance);
    ctx.bot.pathfinder.setGoal(goal, true);

    await new Promise<void>((resolve) => {
      ctx.signal.addEventListener(
        'abort',
        () => {
          ctx.bot.pathfinder.stop();
          resolve();
        },
        { once: true },
      );
    });

    return { ok: true, message: `Stopped following ${args.playerName}.` };
  },
});

export const fleeFrom = defineSkill({
  name: 'fleeFrom',
  // Escaping danger pairs with the other combat-context skills for filtering purposes, even
  // though the mechanism (pathfinder) is movement — only relevant when something threatening
  // is actually nearby, same gate as attackNearest/stopCombat.
  category: 'combat',
  description: 'Run away from a nearby player or mob until a safe distance away.',
  argsSchema: z
    .object({
      entityName: z.string().min(1).describe('Player username or mob type to flee from'),
      distance: z.number().int().positive().max(128).default(16),
    })
    .strict(),
  timeoutMs: 30_000,
  async run(ctx, args) {
    const player = ctx.bot.players[args.entityName]?.entity;
    const mob = ctx.bot.nearestEntity(
      (e) => e.name === args.entityName || e.displayName === args.entityName,
    );
    const target = player ?? mob;
    if (!target) {
      throw new Error(`Can't see "${args.entityName}" nearby to flee from`);
    }

    const goal = new goals.GoalInvert(
      new goals.GoalNear(target.position.x, target.position.y, target.position.z, args.distance),
    );

    const onAbort = () => ctx.bot.pathfinder.stop();
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await ctx.bot.pathfinder.goto(goal);
      return { ok: true, message: `Fled from ${args.entityName}.` };
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
  },
});
