import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  goToPlayer,
  followPlayer,
  fleeFrom,
  UNREACHABLE_NOTIFY_MS,
  REPLAN_INTERVAL_MS,
} from '../../../src/skills/movement.js';
import type { SkillContext } from '../../../src/skills/types.js';
import { createFakeBot } from '../../fakes/fakeBot.js';

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
  function setup() {
    const bot = createFakeBot({
      players: { Steve: { entity: { position: { x: 0, y: 70, z: 0 } } } },
      pathfinder: { setGoal: vi.fn(), stop: vi.fn() },
    });
    const say = vi.fn();
    const controller = new AbortController();
    const ctx = { bot, say, signal: controller.signal } as unknown as SkillContext;
    const done = followPlayer.run(ctx, { playerName: 'Steve', maxDistance: 3 });
    return { bot, say, controller, done };
  }

  afterEach(() => vi.useRealTimers());

  it('tells the player once after sustained noPath and re-plans periodically', async () => {
    vi.useFakeTimers();
    const { bot, say, controller, done } = setup();
    bot.emit('path_update', { status: 'noPath' });
    expect(say).not.toHaveBeenCalled();
    vi.advanceTimersByTime(UNREACHABLE_NOTIFY_MS);
    bot.emit('path_update', { status: 'noPath' });
    bot.emit('path_update', { status: 'noPath' });
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0]![0]).toMatch(/come down|meet me/);
    const before = (bot.pathfinder.setGoal as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.advanceTimersByTime(REPLAN_INTERVAL_MS);
    expect((bot.pathfinder.setGoal as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
    controller.abort();
    await done;
  });

  it('does not chat when a path succeeds', async () => {
    vi.useFakeTimers();
    const { bot, say, controller, done } = setup();
    bot.emit('path_update', { status: 'noPath' });
    bot.emit('path_update', { status: 'success' });
    vi.advanceTimersByTime(UNREACHABLE_NOTIFY_MS * 2);
    bot.emit('path_update', { status: 'success' });
    expect(say).not.toHaveBeenCalled();
    controller.abort();
    await done;
  });
});

describe('goToPlayer NoPath handling', () => {
  it('reports failure to the player instead of throwing', async () => {
    const err = Object.assign(new Error('No path'), { name: 'NoPath' });
    const bot = createFakeBot({
      players: { Steve: { entity: { position: { x: 0, y: 70, z: 0 } } } },
      pathfinder: { goto: vi.fn().mockRejectedValue(err), stop: vi.fn() },
    });
    const say = vi.fn();
    const ctx = { bot, say, signal: new AbortController().signal } as unknown as SkillContext;
    const result = await goToPlayer.run(ctx, { playerName: 'Steve', maxDistance: 3 });
    expect(result.ok).toBe(false);
    expect(say).toHaveBeenCalledOnce();
  });
});
