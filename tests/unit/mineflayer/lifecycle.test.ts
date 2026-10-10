import { describe, expect, it, vi } from 'vitest';
import { attachLifecycle, describeGoal } from '../../../src/mineflayer/lifecycle.js';
import { getFollowTarget, setFollowTarget } from '../../../src/mineflayer/followState.js';
import { createFakeBot } from '../../fakes/fakeBot.js';
import type { Logger } from '../../../src/logger/logger.js';

const logger = {
  info: vi.fn<() => void>(),
  warn: vi.fn<() => void>(),
  debug: vi.fn<() => void>(),
  error: vi.fn<() => void>(),
} as unknown as Logger;

function setup(players: Record<string, unknown> = {}) {
  const pathfinder = {
    stop: vi.fn<() => void>(),
    setGoal: vi.fn<(goal: unknown, dynamic: boolean) => void>(),
  };
  const pvp = { stop: vi.fn<() => void>() };
  const collectBlock = { cancelTask: vi.fn<() => void>() };
  const bot = createFakeBot({ pathfinder, pvp, collectBlock, players });
  const cancelActive = vi.fn<() => void>();
  attachLifecycle(bot, { logger, cancelActive });
  return { bot, pathfinder, pvp, collectBlock, cancelActive };
}

const alex = { username: 'Alex', position: { x: 10, y: 64, z: 10 } };

describe('attachLifecycle', () => {
  it('cancels skill and navigation on death', () => {
    const { bot, pathfinder, pvp, collectBlock, cancelActive } = setup();
    bot.emit('death');
    expect(cancelActive).toHaveBeenCalled();
    expect(pathfinder.stop).toHaveBeenCalled();
    expect(pvp.stop).toHaveBeenCalled();
    expect(collectBlock.cancelTask).toHaveBeenCalled();
  });

  it('re-acquires the followed player with a fresh entity on respawn', () => {
    const { bot, pathfinder } = setup({ Alex: { entity: alex } });
    setFollowTarget(bot, { playerName: 'Alex', maxDistance: 4, goal: {} });
    bot.emit('death');
    expect(getFollowTarget(bot)).toBeUndefined();
    expect(pathfinder.setGoal).not.toHaveBeenCalled();
    bot.emit('spawn');
    expect(pathfinder.setGoal).toHaveBeenCalledTimes(1);
    const [goal, dynamic] = pathfinder.setGoal.mock.calls[0]!;
    expect((goal as { entity: unknown }).entity).toBe(alex);
    expect(dynamic).toBe(true);
    expect(getFollowTarget(bot)?.playerName).toBe('Alex');
  });

  it('waits for the player to appear if not visible at respawn', () => {
    const players: Record<string, unknown> = {};
    const { bot, pathfinder } = setup(players);
    setFollowTarget(bot, { playerName: 'Alex', maxDistance: 3, goal: {} });
    bot.emit('death');
    bot.emit('spawn');
    expect(pathfinder.setGoal).not.toHaveBeenCalled();
    players.Alex = { entity: alex };
    bot.emit('entitySpawn', alex);
    expect(pathfinder.setGoal).toHaveBeenCalledTimes(1);
  });

  it('does not follow anyone after respawn if it was not following', () => {
    const { bot, pathfinder } = setup({ Alex: { entity: alex } });
    bot.emit('death');
    bot.emit('spawn');
    bot.emit('entitySpawn', alex);
    expect(pathfinder.setGoal).not.toHaveBeenCalled();
  });

  it('drops the follow target when a different goal is set', () => {
    const { bot } = setup();
    const goal = {};
    setFollowTarget(bot, { playerName: 'Alex', maxDistance: 3, goal });
    bot.emit('goal_updated', goal, true);
    expect(getFollowTarget(bot)).toBeDefined();
    bot.emit('goal_updated', {}, false);
    expect(getFollowTarget(bot)).toBeUndefined();
  });

  it('re-points the follow goal when the target leaves and re-enters view', () => {
    const { bot, pathfinder } = setup({ Alex: { entity: alex } });
    setFollowTarget(bot, { playerName: 'Alex', maxDistance: 3, goal: {} });
    bot.emit('entityGone', alex);
    expect(pathfinder.stop).toHaveBeenCalled();
    bot.emit('entitySpawn', alex);
    expect(pathfinder.setGoal).toHaveBeenCalledTimes(1);
  });
});

describe('describeGoal', () => {
  it('describes follow, coordinate, and inverted goals', () => {
    class GoalFollow {
      entity = alex;
    }
    class GoalNear {
      x = 1;
      y = 2;
      z = 3;
    }
    class GoalInvert {
      goal = new GoalNear();
    }
    expect(describeGoal(new GoalFollow())).toBe('GoalFollow(Alex @ 10.0,64.0,10.0)');
    expect(describeGoal(new GoalNear())).toBe('GoalNear(1.0,2.0,3.0)');
    expect(describeGoal(new GoalInvert())).toBe('GoalInvert(GoalNear(1.0,2.0,3.0))');
    expect(describeGoal(null)).toBe('none');
  });
});
