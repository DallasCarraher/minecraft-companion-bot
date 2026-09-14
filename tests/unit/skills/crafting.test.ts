import { describe, expect, it } from 'vitest';
import { craftItem } from '../../../src/skills/crafting.js';

describe('craftItem.argsSchema', () => {
  it('accepts a valid itemName and applies the count default', () => {
    const data = craftItem.argsSchema.parse({ itemName: 'stick' });
    expect(data.count).toBe(1);
  });

  it('rejects an empty itemName', () => {
    expect(craftItem.argsSchema.safeParse({ itemName: '' }).success).toBe(false);
  });

  it('rejects a count above the max', () => {
    expect(craftItem.argsSchema.safeParse({ itemName: 'stick', count: 65 }).success).toBe(false);
  });
});
