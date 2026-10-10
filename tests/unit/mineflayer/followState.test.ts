import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/mineflayer/movementsConfig.js', () => ({
  applyDiggingMovements: vi.fn<(bot: unknown) => void>(),
  applySafeMovements: vi.fn<(bot: unknown) => void>(),
}));

import {
  clearFollowTarget,
  getFollowTarget,
  setFollowTarget,
  stopFollowing,
} from '../../../src/mineflayer/followState.js';
import { applySafeMovements } from '../../../src/mineflayer/movementsConfig.js';
import { createFakeBot } from '../../fakes/fakeBot.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('stopFollowing', () => {
  it("halts pathfinding and reverts followPlayer's digging-enabled movements when a follow was active", () => {
    const stop = vi.fn<() => void>();
    const bot = createFakeBot({
      pathfinder: { stop, goal: null, setGoal: vi.fn<(goal: unknown, dynamic?: boolean) => void>() },
    });
    setFollowTarget(bot, { playerName: 'Steve', maxDistance: 3, goal: {} });

    stopFollowing(bot);

    expect(getFollowTarget(bot)).toBeUndefined();
    expect(stop).toHaveBeenCalled();
    expect(applySafeMovements).toHaveBeenCalledWith(bot);
  });

  it('does nothing when the bot was not following anyone', () => {
    const stop = vi.fn<() => void>();
    const bot = createFakeBot({
      pathfinder: { stop, goal: null, setGoal: vi.fn<(goal: unknown, dynamic?: boolean) => void>() },
    });

    stopFollowing(bot);

    expect(stop).not.toHaveBeenCalled();
    expect(applySafeMovements).not.toHaveBeenCalled();
  });

  it('clearFollowTarget alone does not touch movements (only stopFollowing does)', () => {
    const bot = createFakeBot({
      pathfinder: {
        stop: vi.fn<() => void>(),
        goal: null,
        setGoal: vi.fn<(goal: unknown, dynamic?: boolean) => void>(),
      },
    });
    setFollowTarget(bot, { playerName: 'Steve', maxDistance: 3, goal: {} });

    clearFollowTarget(bot);

    expect(getFollowTarget(bot)).toBeUndefined();
    expect(applySafeMovements).not.toHaveBeenCalled();
  });
});
