import type { Bot } from 'mineflayer';

export interface FollowTarget {
  playerName: string;
  maxDistance: number;
  /** The pathfinder goal installed for this follow; a different goal later means we were superseded. */
  goal: unknown;
}

const targets = new WeakMap<Bot, FollowTarget>();

export function getFollowTarget(bot: Bot): FollowTarget | undefined {
  return targets.get(bot);
}

export function setFollowTarget(bot: Bot, target: FollowTarget): void {
  targets.set(bot, target);
}

export function clearFollowTarget(bot: Bot): void {
  targets.delete(bot);
}

/** Clears follow state and halts pathfinding if (and only if) the bot was following someone. */
export function stopFollowing(bot: Bot): void {
  if (!targets.delete(bot)) return;
  bot.pathfinder?.stop();
}
