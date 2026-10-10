import { z } from 'zod';
import pathfinderPkg from 'mineflayer-pathfinder';
import type { Bot } from 'mineflayer';
import { defineSkill } from './types.js';
import { setFollowTarget } from '../mineflayer/followState.js';
import { applyDiggingMovements, applySafeMovements } from '../mineflayer/movementsConfig.js';

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
    // "Go to me" is an explicit priority command — stand down any reflex fight the bot picked on
    // its own first, or it'll keep re-asserting its own GoalFollow on whatever it was chasing.
    ctx.interruptReflexes();
    const entity = findPlayerEntity(ctx.bot, args.playerName);
    const goal = new goals.GoalFollow(entity, args.maxDistance);

    // Getting to the player is the whole point of this command — allow digging (e.g. out of a
    // hole) rather than reporting "no path found", but only for the duration of this one trip.
    applyDiggingMovements(ctx.bot);
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
      applySafeMovements(ctx.bot);
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
  timeoutMs: 15_000,
  // Fires the pathfinder goal and returns immediately rather than blocking until "stop" —
  // mineflayer-pathfinder keeps following on its own tick loop, and the previous design (awaiting
  // the abort signal for up to 10 minutes) held the chat router's single-flight decision tick open
  // for the whole time the bot was following, so every other command got "Still working on: follow
  // me" until the user explicitly said "stop". Cancellation is handled independently of this call,
  // via ChatRouter.cancelActive() and the death handler in lifecycle.ts, both of which call
  // stopFollowing() directly.
  async run(ctx, args) {
    // "Follow me" means stop everything and follow, no matter what the bot was doing on its own —
    // otherwise a reflex fight it picked keeps re-issuing its own GoalFollow on the fight target
    // and this command's goal gets clobbered a few hundred ms later.
    ctx.interruptReflexes();
    const entity = findPlayerEntity(ctx.bot, args.playerName);
    const goal = new goals.GoalFollow(entity, args.maxDistance);
    // Same reasoning as goToPlayer: allow digging out of a stuck spot. Unlike goToPlayer this
    // isn't reverted when `run()` returns (it returns immediately, before the follow itself is
    // anywhere near done) — stopFollowing() reverts it once the follow actually ends.
    applyDiggingMovements(ctx.bot);
    ctx.bot.pathfinder.setGoal(goal, true);

    // Pathfinder can't use bubble columns (soul sand elevators), so even with digging allowed a
    // player above one can be permanently unreachable. Instead of silently wandering, tell the
    // player once and keep retrying periodically. This outlives `run()` — the follow state owns
    // it via `dispose`, so it ends whenever the follow does (stop, death, or being superseded).
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
      // Re-issue the *same* goal object: lifecycle.ts treats a different goal as "superseded".
      ctx.bot.pathfinder.setGoal(goal, true);
    }, REPLAN_INTERVAL_MS);
    ctx.bot.on('path_update', onPathUpdate);

    setFollowTarget(ctx.bot, {
      playerName: args.playerName,
      maxDistance: args.maxDistance,
      goal,
      dispose: () => {
        clearInterval(replan);
        ctx.bot.removeListener('path_update', onPathUpdate);
      },
    });

    return { ok: true, message: `Following ${args.playerName}.` };
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
