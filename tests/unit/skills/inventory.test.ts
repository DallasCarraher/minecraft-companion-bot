import { describe, expect, it } from 'vitest';
import {
  equipArmor,
  dropJunk,
  depositToChest,
  withdrawFromChest,
} from '../../../src/skills/inventory.js';

describe('equipArmor.argsSchema', () => {
  it('accepts an empty object', () => {
    expect(equipArmor.argsSchema.safeParse({}).success).toBe(true);
  });
});

describe('dropJunk.argsSchema', () => {
  it('accepts a non-empty itemNames array', () => {
    expect(dropJunk.argsSchema.safeParse({ itemNames: ['rotten_flesh'] }).success).toBe(true);
  });

  it('rejects an empty itemNames array', () => {
    expect(dropJunk.argsSchema.safeParse({ itemNames: [] }).success).toBe(false);
  });
});

describe('depositToChest.argsSchema', () => {
  const position = { x: 1, y: 64, z: 1 };

  it('accepts valid args and applies the count default', () => {
    const data = depositToChest.argsSchema.parse({ position, itemName: 'cobblestone' });
    expect(data.count).toBe(64);
  });

  it('rejects a non-numeric position field', () => {
    expect(
      depositToChest.argsSchema.safeParse({
        position: { x: '1', y: 64, z: 1 },
        itemName: 'cobblestone',
      }).success,
    ).toBe(false);
  });
});

describe('withdrawFromChest.argsSchema', () => {
  it('accepts valid args', () => {
    expect(
      withdrawFromChest.argsSchema.safeParse({
        position: { x: 1, y: 64, z: 1 },
        itemName: 'cobblestone',
        count: 10,
      }).success,
    ).toBe(true);
  });
});
