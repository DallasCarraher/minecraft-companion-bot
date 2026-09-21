import { z } from 'zod';
import pathfinderPkg from 'mineflayer-pathfinder';
import type { Bot } from 'mineflayer';
import { defineSkill } from './types.js';

const { goals } = pathfinderPkg;

/** How long follow may report noPath/timeout before telling the player she can't reach them. */
export const UNREACHABLE_NOTIFY_MS = 8_000;
/** While unreachable, re-issue the follow goal this often so a changed world/player position is retried. */
export const REPLAN_INTERVAL_MS = 5_000;

type PathUpdate = { status?: string };

function findPlayerEntity(bot: Bot, username: string) {
  const player = bot.players[username];
  if (!player?.entity) {
    throw new Error(`Can't see player "${username}" nearby`);
  }
  return player.entity;
}

export const goToPlayer = defineSkill({
  name: 'goToPlayer',
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
    } catch (err) {
      // mineflayer-pathfinder cannot traverse bubble columns / swim upward against water, so
      // vertical elevators and other unreachable spots surface here as NoPath / Timeout.
      const name = err instanceof Error ? err.name : '';
      if (name === 'NoPath' || name === 'Timeout') {
        const message = `I can't find a path to ${args.playerName} (maybe a bubble-column elevator or a wall). Can you come to me?`;
        ctx.say(message);
        return { ok: false, message };
      }
      throw err;
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
  },
});

export const followPlayer = defineSkill({
  name: 'followPlayer',
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

    // Pathfinder can't use bubble columns (soul sand elevators) and never digs/places here, so a
    // player above/behind an obstacle can be permanently unreachable. Instead of silently
    // wandering, tell the player once and keep retrying periodically.
    let unreachableSince: number | null = null;
    let notified = false;
    const onPathUpdate = (result: PathUpdate) => {
      if (result.status === 'noPath' || result.status === 'timeout') {
        unreachableSince ??= Date.now();
        if (!notified && Date.now() - unreachableSince >= UNREACHABLE_NOTIFY_MS) {
          notified = true;
          ctx.say(
            `I can't find a way to reach you, ${args.playerName}. Can you come down or meet me somewhere I can walk to?`,
          );
        }
      } else if (result.status === 'success') {
        unreachableSince = null;
        notified = false;
      }
    };
    const replan = setInterval(() => {
      if (unreachableSince === null) return;
      const fresh = ctx.bot.players[args.playerName]?.entity;
      if (fresh) ctx.bot.pathfinder.setGoal(new goals.GoalFollow(fresh, args.maxDistance), true);
    }, REPLAN_INTERVAL_MS);
    ctx.bot.on('path_update', onPathUpdate);

    await new Promise<void>((resolve) => {
      ctx.signal.addEventListener(
        'abort',
        () => {
          clearInterval(replan);
          ctx.bot.removeListener('path_update', onPathUpdate);
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
