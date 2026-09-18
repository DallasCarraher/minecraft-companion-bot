import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataCollector, buildDecisionTickData } from '../../../src/learning/dataCollector.js';
import type { DecisionContext } from '../../../src/llm/contextBuilder.js';
import { createFakeBot } from '../../fakes/fakeBot.js';

const silentLogger = pino({ level: 'silent' });

const baseDecisionContext: DecisionContext = {
  triggerMessage: { role: 'user', username: 'Alice', text: 'hi', at: new Date().toISOString() },
  recentChat: [],
  inventory: [{ name: 'oak_log', count: 3 }],
  nearbyBlockTypes: ['grass_block'],
  nearbyEntities: [],
  goal: null,
  activeTask: null,
  relevantKnownLocations: [],
};

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcb-data-collector-test-'));
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('DataCollector', () => {
  it('does not write a file when disabled', async () => {
    const collector = new DataCollector(dataDir, false, silentLogger);
    const bot = createFakeBot();
    collector.recordDecisionTick(
      buildDecisionTickData(
        bot,
        'tick-1',
        baseDecisionContext,
        [],
        { skillName: 'collectBlock', args: {} },
        { ok: true, message: 'done' },
        12,
      ),
    );
    await collector.flush();

    const files = await fs.readdir(dataDir).catch(() => []);
    expect(files).toEqual([]);
  });

  it('appends one JSONL line per recorded tick when enabled', async () => {
    const collector = new DataCollector(dataDir, true, silentLogger);
    const bot = createFakeBot();

    collector.recordDecisionTick(
      buildDecisionTickData(
        bot,
        'tick-1',
        baseDecisionContext,
        [],
        { skillName: 'collectBlock', args: { blockName: 'oak_log' } },
        { ok: true, message: 'collected 1 oak_log' },
        42,
      ),
    );
    collector.recordDecisionTick(
      buildDecisionTickData(
        bot,
        'tick-1',
        baseDecisionContext,
        [{ name: 'collectBlock', ok: true }],
        { skillName: 'goToPlayer', args: { username: 'Alice' } },
        { ok: false, message: 'path blocked' },
        7,
      ),
    );
    await collector.flush();

    const files = await fs.readdir(dataDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^decision-ticks-\d{4}-\d{2}-\d{2}\.jsonl$/);

    const raw = await fs.readFile(path.join(dataDir, files[0]!), 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]!);
    expect(first).toMatchObject({
      tickId: 'tick-1',
      action: { skillName: 'collectBlock', args: { blockName: 'oak_log' } },
      outcome: { ok: true, message: 'collected 1 oak_log', executionTimeMs: 42 },
      context: { inventory: [{ name: 'oak_log', count: 3 }], previousSkills: [] },
    });

    const second = JSON.parse(lines[1]!);
    expect(second.context.previousSkills).toEqual([{ name: 'collectBlock', ok: true }]);
    expect(second.outcome).toMatchObject({ ok: false, message: 'path blocked' });
  });

  it('is a no-op to flush when nothing has been recorded', async () => {
    const collector = new DataCollector(dataDir, true, silentLogger);
    await expect(collector.flush()).resolves.toBeUndefined();
    const files = await fs.readdir(dataDir).catch(() => []);
    expect(files).toEqual([]);
  });
});
