import { describe, expect, it } from 'vitest';
import { attackNearest, stopCombat } from '../../../src/skills/combat.js';

describe('attackNearest.argsSchema', () => {
  it('defaults target to null when omitted', () => {
    const data = attackNearest.argsSchema.parse({});
    expect(data.target).toBeNull();
  });

  it('accepts an explicit target', () => {
    const data = attackNearest.argsSchema.parse({ target: 'zombie' });
    expect(data.target).toBe('zombie');
  });

  it('rejects extra unknown properties (strict schema)', () => {
    expect(attackNearest.argsSchema.safeParse({ target: 'zombie', extra: 1 }).success).toBe(false);
  });
});

describe('stopCombat.argsSchema', () => {
  it('accepts an empty object', () => {
    expect(stopCombat.argsSchema.safeParse({}).success).toBe(true);
  });

  it('rejects unknown properties', () => {
    expect(stopCombat.argsSchema.safeParse({ foo: 'bar' }).success).toBe(false);
  });
});
