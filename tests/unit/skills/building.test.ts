import { describe, expect, it } from 'vitest';
import { buildStructure } from '../../../src/skills/building.js';

const validArgs = {
  shape: 'wall' as const,
  origin: { x: 0, y: 64, z: 0 },
  width: 5,
  depthOrHeight: 3,
  block: 'cobblestone',
};

describe('buildStructure.argsSchema', () => {
  it('accepts valid wall args', () => {
    expect(buildStructure.argsSchema.safeParse(validArgs).success).toBe(true);
  });

  it('accepts valid floor args', () => {
    expect(buildStructure.argsSchema.safeParse({ ...validArgs, shape: 'floor' }).success).toBe(
      true,
    );
  });

  it('rejects an invalid shape', () => {
    expect(buildStructure.argsSchema.safeParse({ ...validArgs, shape: 'pyramid' }).success).toBe(
      false,
    );
  });

  it('rejects a width above the max', () => {
    expect(buildStructure.argsSchema.safeParse({ ...validArgs, width: 33 }).success).toBe(false);
  });

  it('rejects a missing origin', () => {
    const { origin: _origin, ...withoutOrigin } = validArgs;
    expect(buildStructure.argsSchema.safeParse(withoutOrigin).success).toBe(false);
  });
});
