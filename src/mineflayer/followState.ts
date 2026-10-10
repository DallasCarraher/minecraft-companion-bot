import type { Bot } from 'mineflayer';
import { applySafeMovements } from './movementsConfig.js';

export interface FollowTarget {
  playerName: string;
  maxDistance: number;
  /** The pathfinder goal installed for this follow; a different goal later means we were superseded. */
  goal: unknown;
  /** Tears down anything that only makes sense while this follow is live (see followPlayer). */
  dispose?: () => void;
}

const targets = new WeakMap<Bot, FollowTarget>();

export function getFollowTarget(bot: Bot): FollowTarget | undefined {
  return targets.get(bot);
}

export function setFollowTarget(bot: Bot, target: FollowTarget): void {
  targets.get(bot)?.dispose?.();
  targets.set(bot, target);
}

export function clearFollowTarget(bot: Bot): void {
  targets.get(bot)?.dispose?.();
  targets.delete(bot);
}

/** Clears follow state and halts pathfinding if (and only if) the bot was following someone. */
export function stopFollowing(bot: Bot): void {
  const target = targets.get(bot);
  if (!target) return;
  target.dispose?.();
  targets.delete(bot);
  bot.pathfinder?.stop();
  // followPlayer enables digging for the duration of the follow (see movementsConfig.ts) —
  // put it back once there's nothing left that needs it.
  applySafeMovements(bot);
}
