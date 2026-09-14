import { describe, expect, it } from 'vitest';
import { goToPlayer, followPlayer, fleeFrom } from '../../../src/skills/movement.js';

describe('goToPlayer.argsSchema', () => {
  it('accepts a valid playerName and applies the maxDistance default', () => {
    const data = goToPlayer.argsSchema.parse({ playerName: 'Steve' });
    expect(data.maxDistance).toBe(3);
  });

  it('rejects an empty playerName', () => {
    expect(goToPlayer.argsSchema.safeParse({ playerName: '' }).success).toBe(false);
  });

  it('rejects unknown extra properties (strict schema)', () => {
    expect(goToPlayer.argsSchema.safeParse({ playerName: 'Steve', extra: true }).success).toBe(
      false,
    );
  });
});

describe('followPlayer.argsSchema', () => {
  it('accepts a valid playerName', () => {
    expect(followPlayer.argsSchema.safeParse({ playerName: 'Alex' }).success).toBe(true);
  });
});

describe('fleeFrom.argsSchema', () => {
  it('accepts a valid entityName and applies the distance default', () => {
    const data = fleeFrom.argsSchema.parse({ entityName: 'zombie' });
    expect(data.distance).toBe(16);
  });

  it('rejects a non-positive distance', () => {
    expect(fleeFrom.argsSchema.safeParse({ entityName: 'zombie', distance: 0 }).success).toBe(
      false,
    );
  });
});
