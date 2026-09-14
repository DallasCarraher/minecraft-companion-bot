import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../../../src/memory/store.js';

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcb-memory-test-'));
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('MemoryStore', () => {
  it('creates a default state when no file exists', async () => {
    const store = await MemoryStore.loadOrCreate('default', dataDir);
    expect(store.snapshot).toMatchObject({
      version: 1,
      realmId: 'default',
      conversation: [],
      goal: null,
    });
  });

  it('persists updates on flush and reloads them', async () => {
    const store = await MemoryStore.loadOrCreate('default', dataDir);
    store.update((draft) => {
      draft.goal = { description: 'chop wood', createdAt: '2026-01-01T00:00:00.000Z' };
    });
    await store.flush();

    const reloaded = await MemoryStore.loadOrCreate('default', dataDir);
    expect(reloaded.snapshot.goal?.description).toBe('chop wood');
  });

  it('caps the conversation window via appendChatTurn', async () => {
    const store = await MemoryStore.loadOrCreate('default', dataDir);
    for (let i = 0; i < 50; i++) {
      store.appendChatTurn({ role: 'user', text: `message ${i}`, at: new Date().toISOString() });
    }
    expect(store.snapshot.conversation.length).toBe(40);
    expect(store.snapshot.conversation[0]?.text).toBe('message 10');
    expect(store.snapshot.conversation.at(-1)?.text).toBe('message 49');
  });

  it('starts fresh instead of crashing when the state file is corrupt', async () => {
    const filePath = path.join(dataDir, 'state.default.json');
    await fs.writeFile(filePath, '{ not valid json', 'utf8');

    const warnings: string[] = [];
    const store = await MemoryStore.loadOrCreate('default', dataDir, (message) =>
      warnings.push(message),
    );

    expect(store.snapshot.version).toBe(1);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('ignores a stale .tmp file left over from a previous crash', async () => {
    const store = await MemoryStore.loadOrCreate('default', dataDir);
    store.update((draft) => {
      draft.goal = { description: 'real state', createdAt: '2026-01-01T00:00:00.000Z' };
    });
    await store.flush();

    // Simulate a crash mid-write: a leftover .tmp file with different, incomplete content.
    await fs.writeFile(path.join(dataDir, 'state.default.json.tmp'), '{ "corrupt": true', 'utf8');

    const reloaded = await MemoryStore.loadOrCreate('default', dataDir);
    expect(reloaded.snapshot.goal?.description).toBe('real state');
  });
});
