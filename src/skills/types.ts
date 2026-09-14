import type { Bot } from 'mineflayer';
import type { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import type { Logger } from '../logger/logger.js';
import type { MemoryStore } from '../memory/store.js';

export interface SkillContext {
  bot: Bot;
  logger: Logger;
  memory: MemoryStore;
  config: AppConfig;
  /** Aborted when the user says "stop", a new tick preempts this one, or the bot disconnects. */
  signal: AbortSignal;
  /** Sends an immediate chat line, e.g. an interim "on it" ack, independent of the final reply. */
  say: (message: string) => void;
}

export interface SkillResult {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * The contract shared between the skills library and the LLM layer: `llm/toolSchema.ts` turns
 * every registered Skill's `argsSchema` into a provider tool definition, and `llm/decisionLoop.ts`
 * looks skills up by `name` and calls `run()` with validated args.
 *
 * Cancellation is a per-skill responsibility: each plugin (pathfinder, pvp, collectblock) cancels
 * differently, so `run()` implementations must register an `abort` listener on `ctx.signal` that
 * calls the matching stop method (`bot.pathfinder.stop()`, `bot.pvp.stop()`,
 * `bot.collectBlock.stop()` etc). The timeout/abort *race* itself is handled centrally by
 * `decisionLoop.ts` via `util/abortable.ts` — skills only need to react to the signal, not
 * implement the race.
 */
export interface Skill<Args = unknown> {
  name: string;
  description: string;
  argsSchema: z.ZodType<Args>;
  timeoutMs: number;
  run(ctx: SkillContext, args: Args): Promise<SkillResult>;
}

export function defineSkill<Args>(skill: Skill<Args>): Skill<Args> {
  return skill;
}
