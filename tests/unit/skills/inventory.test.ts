import { describe, expect, it } from 'vitest';
import { equipArmor, dropJunk, chestTransfer } from '../../../src/skills/inventory.js';

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

describe('chestTransfer.argsSchema', () => {
  const position = { x: 1, y: 64, z: 1 };

  it('accepts valid deposit args and applies the count default', () => {
    const data = chestTransfer.argsSchema.parse({
      direction: 'deposit',
      position,
      itemName: 'cobblestone',
    });
    expect(data.count).toBe(64);
  });

  it('accepts valid withdraw args', () => {
    expect(
      chestTransfer.argsSchema.safeParse({
        direction: 'withdraw',
        position,
        itemName: 'cobblestone',
        count: 10,
      }).success,
    ).toBe(true);
  });

  it('rejects a non-numeric position field', () => {
    expect(
      chestTransfer.argsSchema.safeParse({
        direction: 'deposit',
        position: { x: '1', y: 64, z: 1 },
        itemName: 'cobblestone',
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid direction', () => {
    expect(
      chestTransfer.argsSchema.safeParse({
        direction: 'sideways',
        position,
        itemName: 'cobblestone',
      }).success,
    ).toBe(false);
  });
});
