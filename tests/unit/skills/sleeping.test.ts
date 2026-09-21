import { describe, expect, it, vi } from 'vitest';
import { sleepInBed } from '../../../src/skills/sleeping.js';
import { createFakeBot } from '../../fakes/fakeBot.js';
import type { SkillContext } from '../../../src/skills/types.js';

const bed = { position: { x: 5, y: 64, z: 5 } };

function makeCtx(overrides: Record<string, unknown> = {}) {
  const say = vi.fn();
  const bot = createFakeBot({
    registry: {
      blocksArray: [
        { name: 'red_bed', id: 26 },
        { name: 'stone', id: 1 },
      ],
    },
    time: { isDay: false },
    thunderState: 0,
    isSleeping: false,
    findBlock: () => bed,
    pathfinder: { goto: vi.fn().mockResolvedValue(undefined), stop: vi.fn() },
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
  const ctx = {
    bot,
    say,
    signal: new AbortController().signal,
  } as unknown as SkillContext;
  return { ctx, bot, say };
}

describe('sleepInBed.argsSchema', () => {
  it('accepts an empty object and rejects extras', () => {
    expect(sleepInBed.argsSchema.safeParse({}).success).toBe(true);
    expect(sleepInBed.argsSchema.safeParse({ x: 1 }).success).toBe(false);
  });
});

describe('sleepInBed.run', () => {
  it('walks to the bed, sleeps, and announces waking', async () => {
    const { ctx, bot, say } = makeCtx();
    const result = await sleepInBed.run(ctx, {});
    expect(result.ok).toBe(true);
    expect(bot.sleep).toHaveBeenCalledWith(bed);
    bot.emit('wake');
    expect(say).toHaveBeenCalledWith('I woke up!');
  });

  it('fails without pathing when it is daytime', async () => {
    const { ctx, bot } = makeCtx({ time: { isDay: true } });
    const result = await sleepInBed.run(ctx, {});
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/night/);
    expect(bot.sleep).not.toHaveBeenCalled();
  });

  it('fails when no bed is found', async () => {
    const { ctx } = makeCtx({ findBlock: () => null });
    const result = await sleepInBed.run(ctx, {});
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/couldn't find a bed/);
  });

  it.each([
    ['there are monsters nearby', /monsters/],
    ['the bed is occupied', /occupied/],
    ['the bed is too far away', /close enough/],
    ["it's not night and it's not a thunderstorm", /night/],
  ])('maps sleep refusal "%s" to a clear message', async (reason, pattern) => {
    const { ctx, say, bot } = makeCtx({ sleep: vi.fn().mockRejectedValue(new Error(reason)) });
    const result = await sleepInBed.run(ctx, {});
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(pattern);
    bot.emit('wake');
    expect(say).not.toHaveBeenCalled();
  });

  it('fails when the bed is unreachable', async () => {
    const { ctx, bot } = makeCtx({
      pathfinder: { goto: vi.fn().mockRejectedValue(new Error('No path')), stop: vi.fn() },
    });
    const result = await sleepInBed.run(ctx, {});
    expect(result.ok).toBe(false);
    expect(bot.sleep).not.toHaveBeenCalled();
  });
});
