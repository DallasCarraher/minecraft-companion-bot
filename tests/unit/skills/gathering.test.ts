import { describe, expect, it } from 'vitest';
import { collectBlock, equipBestTool } from '../../../src/skills/gathering.js';

describe('collectBlock.argsSchema', () => {
  it('accepts a valid blockName and applies the count default', () => {
    const data = collectBlock.argsSchema.parse({ blockName: 'oak_log' });
    expect(data.count).toBe(1);
  });

  it('rejects a count above the max', () => {
    expect(collectBlock.argsSchema.safeParse({ blockName: 'oak_log', count: 65 }).success).toBe(
      false,
    );
  });

  it('rejects a non-integer count', () => {
    expect(collectBlock.argsSchema.safeParse({ blockName: 'oak_log', count: 1.5 }).success).toBe(
      false,
    );
  });
});

describe('equipBestTool.argsSchema', () => {
  it('accepts a valid blockName', () => {
    expect(equipBestTool.argsSchema.safeParse({ blockName: 'stone' }).success).toBe(true);
  });

  it('rejects a missing blockName', () => {
    expect(equipBestTool.argsSchema.safeParse({}).success).toBe(false);
  });
});
