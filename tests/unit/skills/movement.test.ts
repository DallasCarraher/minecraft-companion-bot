import { afterEach, describe, expect, it, vi } from 'vitest';

// applyDiggingMovements/applySafeMovements construct a real mineflayer-pathfinder `Movements`,
// which needs a full minecraft-data block/item registry the fake bot doesn't provide. Mock the
// module so these tests verify *that* the skills call into it, not its internals.
vi.mock('../../../src/mineflayer/movementsConfig.js', () => ({
  applyDiggingMovements: vi.fn<(bot: unknown) => void>(),
  applySafeMovements: vi.fn<(bot: unknown) => void>(),
}));

import {
  goToPlayer,
  followPlayer,
  fleeFrom,
  UNREACHABLE_NOTIFY_MS,
  REPLAN_INTERVAL_MS,
} from '../../../src/skills/movement.js';
import { getFollowTarget, stopFollowing } from '../../../src/mineflayer/followState.js';
import { applyDiggingMovements, applySafeMovements } from '../../../src/mineflayer/movementsConfig.js';
import { createFakeBot } from '../../fakes/fakeBot.js';
import type { SkillContext } from '../../../src/skills/types.js';

afterEach(() => {
  vi.clearAllMocks();
});

function makeCtx(overrides: Record<string, unknown> = {}) {
  const setGoal = vi.fn<(goal: unknown, dynamic?: boolean) => void>();
  const goto = vi.fn<() => Promise<void>>(async () => {});
  const stop = vi.fn<() => void>();
  const interruptReflexes = vi.fn<() => void>();
  const say = vi.fn<(message: string) => void>();
  const playerEntity = { id: 1, position: { x: 0, y: 64, z: 0, distanceTo: () => 0 } };
  const bot = createFakeBot({
    players: { Steve: { entity: playerEntity } },
    pathfinder: { setGoal, goto, stop, goal: null },
    ...overrides,
  });
  const ctx = {
    bot,
    logger: { info() {}, warn() {}, debug() {}, error() {} },
    memory: {},
    config: {},
    signal: new AbortController().signal,
    say,
    interruptReflexes,
  } as unknown as SkillContext;
  return { ctx, bot, setGoal, goto, stop, say, interruptReflexes };
}

describe('goToPlayer.argsSchema', () => {
  it('accepts a valid playerName and applies the maxDistance default', () => {
    const data = goToPlayer.argsSchema.parse({ playerName: 'Steve' });
    expect(data.maxDistance).toBe(3);
  });

  it('rejects an empty playerName', () => {
    expect(goToPlayer.argsSchema.safeParse({ playerName: '' }).success).toBe(false);
  });

  it('rejects unknown extra properties (strict schema)', () => {
    expect(goToPlayer.argsSchema.safeParse({ playerName: 'Steve', extra: true }).success).toBe(
      false,
    );
  });
});

describe('followPlayer.argsSchema', () => {
  it('accepts a valid playerName', () => {
    expect(followPlayer.argsSchema.safeParse({ playerName: 'Alex' }).success).toBe(true);
  });
});

describe('goToPlayer.run', () => {
  it('interrupts any reflex fight, allows digging for the trip, and reverts to safe movements after', async () => {
    const { ctx, goto, interruptReflexes } = makeCtx();
    const result = await goToPlayer.run(ctx, { playerName: 'Steve', maxDistance: 3 });
    expect(interruptReflexes).toHaveBeenCalled();
    expect(goto).toHaveBeenCalled();
    expect(applyDiggingMovements).toHaveBeenCalledWith(ctx.bot);
    expect(applySafeMovements).toHaveBeenCalledWith(ctx.bot);
    expect(result).toEqual({ ok: true, message: 'Reached Steve.' });
  });

  it('reverts to safe movements even when pathing fails', async () => {
    const { ctx, bot } = makeCtx({
      pathfinder: {
        setGoal: vi.fn<(goal: unknown, dynamic?: boolean) => void>(),
        goto: vi.fn<() => Promise<void>>(async () => {
          throw new Error("can't get there");
        }),
        stop: vi.fn<() => void>(),
        goal: null,
      },
    });
    await expect(
      goToPlayer.run(ctx, { playerName: 'Steve', maxDistance: 3 }),
    ).rejects.toThrow("can't get there");
    expect(applySafeMovements).toHaveBeenCalledWith(bot);
  });
});

describe('followPlayer.run', () => {
  it('interrupts any reflex fight, allows digging, and sets the follow goal without waiting for "stop"', async () => {
    const { ctx, setGoal, interruptReflexes } = makeCtx();
    const result = await followPlayer.run(ctx, { playerName: 'Steve', maxDistance: 3 });
    expect(interruptReflexes).toHaveBeenCalled();
    expect(applyDiggingMovements).toHaveBeenCalledWith(ctx.bot);
    expect(setGoal).toHaveBeenCalledWith(expect.anything(), true);
    expect(result).toEqual({ ok: true, message: 'Following Steve.' });
    // Unlike goToPlayer, following doesn't finish when run() returns, so digging stays enabled —
    // stopFollowing() (tested in followState.test.ts) is what reverts it.
    expect(applySafeMovements).not.toHaveBeenCalled();
  });
});

describe('fleeFrom.argsSchema', () => {
  it('accepts a valid entityName and applies the distance default', () => {
    const data = fleeFrom.argsSchema.parse({ entityName: 'zombie' });
    expect(data.distance).toBe(16);
  });

  it('rejects a non-positive distance', () => {
    expect(fleeFrom.argsSchema.safeParse({ entityName: 'zombie', distance: 0 }).success).toBe(
      false,
    );
  });
});

describe('followPlayer unreachable fallback', () => {
  afterEach(() => vi.useRealTimers());

  it('tells the player once after sustained noPath and re-plans periodically', async () => {
    vi.useFakeTimers();
    const { ctx, bot, say, setGoal } = makeCtx();
    await followPlayer.run(ctx, { playerName: 'Steve', maxDistance: 3 });
    bot.emit('path_update', { status: 'noPath' });
    expect(say).not.toHaveBeenCalled();
    vi.advanceTimersByTime(UNREACHABLE_NOTIFY_MS);
    bot.emit('path_update', { status: 'noPath' });
    bot.emit('path_update', { status: 'noPath' });
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0]![0]).toMatch(/come down|meet me/);
    const before = setGoal.mock.calls.length;
    vi.advanceTimersByTime(REPLAN_INTERVAL_MS);
    expect(setGoal.mock.calls.length).toBe(before + 1);
    // Same goal object re-issued, so lifecycle.ts doesn't read it as a superseding goal.
    expect(setGoal.mock.calls.at(-1)![0]).toBe(getFollowTarget(bot)?.goal);
    stopFollowing(bot);
  });

  it('does not chat when a path succeeds', async () => {
    vi.useFakeTimers();
    const { ctx, bot, say } = makeCtx();
    await followPlayer.run(ctx, { playerName: 'Steve', maxDistance: 3 });
    bot.emit('path_update', { status: 'noPath' });
    bot.emit('path_update', { status: 'success' });
    vi.advanceTimersByTime(UNREACHABLE_NOTIFY_MS * 2);
    bot.emit('path_update', { status: 'success' });
    expect(say).not.toHaveBeenCalled();
    stopFollowing(bot);
  });

  it('stops watching and re-planning once the follow ends', async () => {
    vi.useFakeTimers();
    const { ctx, bot, say, setGoal } = makeCtx();
    await followPlayer.run(ctx, { playerName: 'Steve', maxDistance: 3 });
    bot.emit('path_update', { status: 'noPath' });
    stopFollowing(bot);
    const before = setGoal.mock.calls.length;
    vi.advanceTimersByTime(UNREACHABLE_NOTIFY_MS + REPLAN_INTERVAL_MS);
    bot.emit('path_update', { status: 'noPath' });
    expect(say).not.toHaveBeenCalled();
    expect(setGoal.mock.calls.length).toBe(before);
  });
});

describe('goToPlayer NoPath handling', () => {
  it('reports failure to the player instead of throwing, and still reverts to safe movements', async () => {
    const err = Object.assign(new Error('No path'), { name: 'NoPath' });
    const { ctx, bot, say } = makeCtx({
      pathfinder: {
        setGoal: vi.fn<(goal: unknown, dynamic?: boolean) => void>(),
        goto: vi.fn<() => Promise<void>>().mockRejectedValue(err),
        stop: vi.fn<() => void>(),
        goal: null,
      },
    });
    const result = await goToPlayer.run(ctx, { playerName: 'Steve', maxDistance: 3 });
    expect(result.ok).toBe(false);
    expect(say).toHaveBeenCalledOnce();
    expect(applySafeMovements).toHaveBeenCalledWith(bot);
  });
});
