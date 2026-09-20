import { z } from 'zod';
import pathfinderPkg from 'mineflayer-pathfinder';
import type { Bot } from 'mineflayer';
import { defineSkill } from './types.js';

const { goals } = pathfinderPkg;

const BED_SEARCH_RADIUS = 64;

/**
 * Maps the error text mineflayer's `bot.sleep()` throws (and the server's refusals surfaced
 * through it) to a message the LLM can relay in chat verbatim.
 */
function describeSleepRefusal(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const text = raw.toLowerCase();
  if (text.includes('not night') || text.includes('thunderstorm')) {
    return "I can't sleep right now — beds only work at night or during a thunderstorm.";
  }
  if (text.includes('monster')) {
    return "I can't sleep — there are monsters nearby.";
  }
  if (text.includes('occupied')) {
    return "I can't sleep — that bed is already occupied.";
  }
  if (text.includes('too far')) {
    return "I couldn't get close enough to the bed to sleep in it.";
  }
  return `I couldn't sleep: ${raw}`;
}

function bedBlockIds(bot: Bot): number[] {
  return bot.registry.blocksArray.filter((b) => b.name.endsWith('_bed')).map((b) => b.id);
}

export const sleepInBed = defineSkill({
  name: 'sleepInBed',
  description:
    'Find the nearest bed, walk to it, and sleep in it. Only works at night or during a thunderstorm. Reports failure if no bed is found, monsters are nearby, or the bed is occupied.',
  argsSchema: z.object({}).strict(),
  timeoutMs: 60_000,
  async run(ctx) {
    const { bot } = ctx;

    if (bot.isSleeping) {
      return { ok: true, message: 'Already sleeping.' };
    }

    // Cheap pre-check so we don't walk to a bed just to be refused.
    if (bot.time?.isDay && !(bot.thunderState > 0)) {
      return {
        ok: false,
        message: "I can't sleep right now — beds only work at night or during a thunderstorm.",
      };
    }

    const bed = bot.findBlock({ matching: bedBlockIds(bot), maxDistance: BED_SEARCH_RADIUS });
    if (!bed) {
      return { ok: false, message: `I couldn't find a bed within ${BED_SEARCH_RADIUS} blocks.` };
    }

    const onAbort = () => bot.pathfinder.stop();
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      try {
        await bot.pathfinder.goto(
          new goals.GoalGetToBlock(bed.position.x, bed.position.y, bed.position.z),
        );
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        return {
          ok: false,
          message: `I couldn't reach the bed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      try {
        await bot.sleep(bed);
      } catch (err) {
        return { ok: false, message: describeSleepRefusal(err) };
      }
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }

    // Outlives this skill run (and its abort signal): the wake happens after the tick is over.
    bot.once('wake', () => ctx.say('I woke up!'));

    return { ok: true, message: 'Went to bed and fell asleep.' };
  },
});
