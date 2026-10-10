import { describe, expect, it } from 'vitest';
import { isLikelyPlayerBuilt } from '../../../src/mineflayer/buildBlocks.js';

describe('isLikelyPlayerBuilt', () => {
  it('flags common building/decoration block types', () => {
    for (const name of [
      'oak_planks',
      'oak_door',
      'oak_stairs',
      'glass',
      'white_wool',
      'white_concrete',
      'bricks',
      'chest',
      'furnace',
      'crafting_table',
      'torch',
      'redstone_wire',
      'ladder',
    ]) {
      expect(isLikelyPlayerBuilt(name)).toBe(true);
    }
  });

  it('allows raw resource block types', () => {
    for (const name of ['oak_log', 'stone', 'iron_ore', 'dirt', 'sand', 'gravel', 'coal_ore']) {
      expect(isLikelyPlayerBuilt(name)).toBe(false);
    }
  });
});
