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

    const names = skillNames(filterRelevantSkills(context, registry).skills);

    expect(names).toContain('attackNearest');
    expect(names).toContain('stopCombat');
    expect(names).toContain('fleeFrom');
  });

  it('excludes combat skills when no hostile is nearby', () => {
    const context = makeContext({
      nearbyEntities: [{ name: 'Alex', distance: 5, isHostile: false }],
    });

    const { skills, hidden } = filterRelevantSkills(context, registry);
    const names = skillNames(skills);

    expect(names).not.toContain('attackNearest');
    expect(names).not.toContain('stopCombat');
    expect(names).not.toContain('fleeFrom');
    expect(hidden).toContainEqual({ name: 'attackNearest', reason: 'no hostile entity nearby' });
  });

  it('includes crafting skills when there is an active goal and inventory to craft with', () => {
    const context = makeContext({
      goal: { description: 'build a house', createdAt: new Date().toISOString() },
      inventory: [{ name: 'oak_log', count: 4 }],
    });

    const names = skillNames(filterRelevantSkills(context, registry).skills);

    expect(names).toContain('craftItem');
  });

  it('excludes crafting skills when there is a goal but no inventory', () => {
    const context = makeContext({
      goal: { description: 'build a house', createdAt: new Date().toISOString() },
      inventory: [],
    });

    const { skills, hidden } = filterRelevantSkills(context, registry);
    const names = skillNames(skills);

    expect(names).not.toContain('craftItem');
    expect(hidden).toContainEqual({ name: 'craftItem', reason: 'inventory is empty' });
  });

  it('includes building skills when there is an active goal, regardless of inventory', () => {
    const context = makeContext({
      goal: { description: 'build a house', createdAt: new Date().toISOString() },
    });

    const names = skillNames(filterRelevantSkills(context, registry).skills);

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
      inventory: [{ name: 'stick', count: 2 }],
    });

    const names = skillNames(filterRelevantSkills(context, registry).skills);

    expect(names).toContain('craftItem');
    expect(names).toContain('buildStructure');
  });

  it('excludes crafting/building skills when there is no goal or active task', () => {
    const { skills, hidden } = filterRelevantSkills(makeContext(), registry);
    const names = skillNames(skills);

    expect(names).not.toContain('craftItem');
    expect(names).not.toContain('buildStructure');
    expect(hidden).toContainEqual({ name: 'craftItem', reason: 'no active goal or task' });
    expect(hidden).toContainEqual({ name: 'buildStructure', reason: 'no active goal or task' });
  });

  it('includes gathering skills only when blocks are nearby', () => {
    const withBlocks = filterRelevantSkills(
      makeContext({ nearbyBlockTypes: ['oak_log'] }),
      registry,
    );
    expect(skillNames(withBlocks.skills)).toContain('collectBlock');

    const withoutBlocks = filterRelevantSkills(makeContext({ nearbyBlockTypes: [] }), registry);
    expect(skillNames(withoutBlocks.skills)).not.toContain('collectBlock');
    expect(withoutBlocks.hidden).toContainEqual({
      name: 'collectBlock',
      reason: 'no blocks nearby',
    });
  });

  it('always includes movement and info skills regardless of context', () => {
    const names = skillNames(filterRelevantSkills(makeContext(), registry).skills);

    for (const alwaysOn of [
      'goToPlayer',
      'followPlayer',
      'equipArmor',
      'dropJunk',
      'chestTransfer',
    ]) {
      expect(names).toContain(alwaysOn);
    }
  });

  it('never returns an empty list, even in a maximally filtered context', () => {
    const { skills } = filterRelevantSkills(makeContext(), registry);

    expect(skills.length).toBeGreaterThan(0);
  });

  it('falls back to the full registry if every skill would otherwise be filtered out', () => {
    const emptyRegistry = new SkillRegistry();
    emptyRegistry.register(registry.get('attackNearest')!);

    const { skills, hidden } = filterRelevantSkills(makeContext(), emptyRegistry);

    // attackNearest would normally be excluded (no hostiles), but it's the only registered
    // skill, so the safe fallback kicks in rather than sending zero tools.
    expect(skills.length).toBe(1);
    expect(skills[0]?.name).toBe('attackNearest');
    expect(hidden).toEqual([]);
  });
});
