import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import type { Logger } from '../logger/logger.js';
import { clearFollowTarget, getFollowTarget, setFollowTarget } from './followState.js';

const { goals } = pathfinderPkg;

interface Vec {
  x: number;
  y: number;
  z: number;
}

const fmt = (p: Vec) => `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`;

/** Human-readable description of a pathfinder goal, for diagnosing "where is she running to?". */
export function describeGoal(goal: unknown): string {
  if (!goal) return 'none';
  const g = goal as {
    constructor?: { name?: string };
    entity?: { username?: string; name?: string; position?: Vec };
    goal?: unknown;
    x?: number;
    y?: number;
    z?: number;
  };
  const type = g.constructor?.name ?? 'Goal';
  if (g.entity) {
    const who = g.entity.username ?? g.entity.name ?? 'entity';
    return `${type}(${who}${g.entity.position ? ` @ ${fmt(g.entity.position)}` : ''})`;
  }
  if (g.goal) return `${type}(${describeGoal(g.goal)})`;
  if (typeof g.x === 'number' && typeof g.z === 'number') {
    return `${type}(${fmt({ x: g.x, y: g.y ?? Number.NaN, z: g.z })})`;
  }
  return type;
}

export interface LifecycleDeps {
  logger: Logger;
  /** Aborts the in-flight decision tick / skill. */
  cancelActive: () => void;
}

/**
 * Nothing in mineflayer or mineflayer-pathfinder resets navigation on death: the pathfinder goal
 * (and a dynamic GoalFollow holding a stale entity reference) survives respawn, so the bot keeps
 * running toward the old target. This:
 *  - logs every goal change (destination) for diagnosis,
 *  - on death cancels the active skill and pathfinder/pvp/collectblock work,
 *  - on respawn re-acquires the followed player with a fresh entity (waiting for them to appear
 *    if not yet visible), rather than resuming the old path,
 *  - drops the follow target if anything else sets a different goal.
 */
export function attachLifecycle(bot: Bot, deps: LifecycleDeps): void {
  const { logger } = deps;
  let pendingFollow: { playerName: string; maxDistance: number } | null = null;

  const reacquire = (): void => {
    if (!pendingFollow) return;
    const entity = bot.players[pendingFollow.playerName]?.entity;
    if (!entity) return;
    const { playerName, maxDistance } = pendingFollow;
    pendingFollow = null;
    const goal = new goals.GoalFollow(entity, maxDistance);
    setFollowTarget(bot, { playerName, maxDistance, goal });
    bot.pathfinder.setGoal(goal, true);
    logger.info({ playerName }, 're-acquired follow target');
  };

  bot.on(
    'goal_updated' as never,
    ((goal: unknown, dynamic: boolean) => {
      logger.info({ destination: describeGoal(goal), dynamic }, 'pathfinder goal updated');
      const follow = getFollowTarget(bot);
      if (follow && follow.goal !== goal) clearFollowTarget(bot);
    }) as never,
  );
  bot.on(
    'goal_reached' as never,
    ((goal: unknown) => {
      logger.info({ destination: describeGoal(goal) }, 'pathfinder goal reached');
    }) as never,
  );
  bot.on(
    'path_reset' as never,
    ((reason: string) => {
      logger.debug({ reason }, 'pathfinder path reset');
    }) as never,
  );

  bot.on('death', () => {
    // Snapshot before cancelActive: aborting the follow skill clears the follow target.
    const follow = getFollowTarget(bot);
    pendingFollow = follow
      ? { playerName: follow.playerName, maxDistance: follow.maxDistance }
      : null;
    logger.warn(
      {
        position: bot.entity ? fmt(bot.entity.position) : undefined,
        following: follow?.playerName,
      },
      'bot died, cancelling active skill and navigation',
    );
    deps.cancelActive();
    clearFollowTarget(bot);
    bot.pathfinder?.stop();
    bot.pvp?.stop();
    void bot.collectBlock?.cancelTask?.();
  });

  bot.on('spawn', reacquire);
  bot.on('entitySpawn', (entity) => {
    if (pendingFollow && entity.username === pendingFollow.playerName) reacquire();
  });
  // A followed player's entity object is replaced when they leave/re-enter range; the old
  // GoalFollow would keep chasing the stale one, so re-point it once they are visible again.
  bot.on('entityGone', (entity) => {
    const follow = getFollowTarget(bot);
    if (!follow || entity.username !== follow.playerName) return;
    logger.info(
      { playerName: follow.playerName },
      'follow target left view, waiting to re-acquire',
    );
    pendingFollow = { playerName: follow.playerName, maxDistance: follow.maxDistance };
    clearFollowTarget(bot);
    bot.pathfinder.stop();
  });
}
