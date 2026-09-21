import { describe, expect, it } from 'vitest';
import { SkillRegistry } from '../../../src/skills/registry.js';
import { registerAllSkills } from '../../../src/skills/index.js';
import { filterRelevantSkills } from '../../../src/llm/skillFilter.js';
import type { DecisionContext } from '../../../src/llm/contextBuilder.js';

function makeContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    triggerMessage: { role: 'user', username: 'Steve', text: 'hi', at: new Date().toISOString() },
    recentChat: [],
    inventory: [],
    nearbyBlockTypes: [],
    nearbyEntities: [],
    goal: null,
    activeTask: null,
    relevantKnownLocations: [],
    ...overrides,
  };
}

function skillNames(skills: { name: string }[]): string[] {
  return skills.map((s) => s.name).toSorted();
}

describe('filterRelevantSkills', () => {
  const registry = new SkillRegistry();
  registerAllSkills(registry);

  it('includes combat skills when a hostile is nearby', () => {
    const context = makeContext({
      nearbyEntities: [{ name: 'zombie', distance: 5, isHostile: true }],
    });

    const names = skillNames(filterRelevantSkills(context, registry));

    expect(names).toContain('attackNearest');
    expect(names).toContain('stopCombat');
    expect(names).toContain('fleeFrom');
  });

  it('excludes combat skills when no hostile is nearby', () => {
    const context = makeContext({
      nearbyEntities: [{ name: 'Alex', distance: 5, isHostile: false }],
    });

    const names = skillNames(filterRelevantSkills(context, registry));

    expect(names).not.toContain('attackNearest');
    expect(names).not.toContain('stopCombat');
    expect(names).not.toContain('fleeFrom');
  });

  it('includes crafting/building skills when there is an active goal', () => {
    const context = makeContext({
      goal: { description: 'build a house', createdAt: new Date().toISOString() },
    });

    const names = skillNames(filterRelevantSkills(context, registry));

    expect(names).toContain('craftItem');
    expect(names).toContain('buildStructure');
  });

  it('includes crafting/building skills when there is an active task', () => {
    const context = makeContext({
      activeTask: {
        id: '1',
        description: 'craft a pickaxe',
        status: 'active',
        createdAt: new Date().toISOString(),
      },
    });

    const names = skillNames(filterRelevantSkills(context, registry));

    expect(names).toContain('craftItem');
    expect(names).toContain('buildStructure');
  });

  it('excludes crafting/building skills when there is no goal or active task', () => {
    const names = skillNames(filterRelevantSkills(makeContext(), registry));

    expect(names).not.toContain('craftItem');
    expect(names).not.toContain('buildStructure');
  });

  it('always includes movement, gathering, and inventory skills regardless of context', () => {
    const names = skillNames(filterRelevantSkills(makeContext(), registry));

    for (const alwaysOn of [
      'goToPlayer',
      'followPlayer',
      'collectBlock',
      'equipBestTool',
      'equipArmor',
      'eatFood',
      'dropJunk',
      'chestTransfer',
    ]) {
      expect(names).toContain(alwaysOn);
    }
  });

  it('never returns an empty list, even in a maximally filtered context', () => {
    const skills = filterRelevantSkills(makeContext(), registry);

    expect(skills.length).toBeGreaterThan(0);
  });

  it('falls back to the full registry if every skill would otherwise be filtered out', () => {
    const emptyRegistry = new SkillRegistry();
    emptyRegistry.register(registry.get('attackNearest')!);

    const skills = filterRelevantSkills(makeContext(), emptyRegistry);

    // attackNearest would normally be excluded (no hostiles), but it's the only registered
    // skill, so the safe fallback kicks in rather than sending zero tools.
    expect(skills.length).toBe(1);
    expect(skills[0]?.name).toBe('attackNearest');
  });
});
