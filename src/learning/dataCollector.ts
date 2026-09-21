import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Bot } from 'mineflayer';
import { DATA_COLLECTION_FLUSH_DEBOUNCE_MS } from '../config/constants.js';
import type { Logger } from '../logger/logger.js';
import { debounce, type Debounced } from '../util/debounce.js';
import type { DecisionContext } from '../llm/contextBuilder.js';
import type { SkillResult } from '../skills/types.js';
import type { DecisionTickData } from './types.js';

/**
 * Builds one `DecisionTickData` training example from the tick-level context (assembled once per
 * decision tick, in `contextBuilder.ts`) plus the per-skill-call action/outcome. `previousSkills`
 * is the history of skill results *within this same tick*, oldest first, so the model can learn
 * from short-range sequencing (e.g. "collectBlock right after a failed goToPlayer").
 */
export function buildDecisionTickData(
  bot: Bot,
  tickId: string,
  decisionContext: DecisionContext,
  previousSkills: { name: string; ok: boolean }[],
  action: { skillName: string; args: Record<string, unknown> },
  result: SkillResult,
  executionTimeMs: number,
): DecisionTickData {
  return {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    tickId,
    context: {
      biome: bot.blockAt(bot.entity.position)?.biome?.name ?? null,
      timeOfDay: bot.time?.timeOfDay ?? 0,
      position: {
        x: bot.entity.position.x,
        y: bot.entity.position.y,
        z: bot.entity.position.z,
      },
      health: bot.health ?? 0,
      inventory: decisionContext.inventory,
      nearbyBlocks: decisionContext.nearbyBlockTypes,
      nearbyEntities: decisionContext.nearbyEntities,
      goal: decisionContext.goal?.description ?? null,
      taskType: decisionContext.activeTask?.description ?? null,
      previousSkills,
    },
    action,
    outcome: {
      ok: result.ok,
      message: result.message,
      executionTimeMs,
      data: result.data,
    },
    goalProgress: null,
  };
}

/**
 * Buffers decision-tick training examples in memory and flushes them, debounced, to a daily JSONL
 * file under `dataDir` (`decision-ticks-YYYY-MM-DD.jsonl`, one JSON object per line). Disabled by
 * default via `DATA_COLLECTION_ENABLED` — `recordDecisionTick` is then a no-op so a bot not opted
 * into data collection pays no per-tick cost at all, not even a buffered array push.
 *
 * Appends rather than rewrites (unlike `MemoryStore`'s atomic full-state overwrite) since this is
 * a pure log: losing the last debounce window's worth of lines on an unclean shutdown is
 * acceptable for training data, and appending lets multiple flushes to the same day's file compose
 * without re-reading it.
 */
export class DataCollector {
  private buffer: DecisionTickData[] = [];
  private readonly debouncedFlush: Debounced<[]>;

  constructor(
    private readonly dataDir: string,
    private readonly enabled: boolean,
    private readonly logger: Logger,
  ) {
    this.debouncedFlush = debounce(() => {
      void this.flushNow();
    }, DATA_COLLECTION_FLUSH_DEBOUNCE_MS);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  recordDecisionTick(entry: DecisionTickData): void {
    if (!this.enabled) return;
    this.buffer.push(entry);
    this.debouncedFlush();
  }

  /** Cancels any pending debounced flush and writes buffered entries immediately. */
  async flush(): Promise<void> {
    this.debouncedFlush.cancel();
    await this.flushNow();
  }

  private async flushNow(): Promise<void> {
    if (this.buffer.length === 0) return;
    const entries = this.buffer;
    this.buffer = [];

    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const filePath = path.join(this.dataDir, `decision-ticks-${dateStamp()}.jsonl`);
      const lines = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
      await fs.appendFile(filePath, lines, 'utf8');
    } catch (err) {
      this.logger.warn({ err }, 'failed to flush decision-tick training data, will retry');
      this.buffer.unshift(...entries);
    }
  }
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
