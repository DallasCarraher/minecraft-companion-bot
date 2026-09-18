import type { SkillRegistry } from '../skills/registry.js';
import type { Skill } from '../skills/types.js';
import type { DecisionContext } from './contextBuilder.js';

export interface HiddenSkill {
  name: string;
  reason: string;
}

export interface SkillFilterResult {
  skills: Skill<unknown>[];
  hidden: HiddenSkill[];
}

/**
 * Narrows the tool list sent to the model each decision tick, based on the same `DecisionContext`
 * already assembled for the tick's user message. Filtering is per `SkillCategory`:
 *
 * - `combat`: only relevant when a hostile mob is actually nearby.
 * - `crafting`: only relevant with an active goal/task *and* something in inventory to craft
 *   with — showing `craftItem` with an empty inventory is pure noise.
 * - `building`: only relevant with an active goal/task that might call for it.
 * - `gathering`: only relevant when there's something nearby to gather.
 * - `movement`, `info`: no cheap precondition worth checking, so always included.
 *
 * Biome-gated skills (e.g. a future "fishInWater") aren't handled yet — there's no such skill and
 * no biome data in `DecisionContext` today, so that rule is deferred until one exists.
 *
 * Conservative by design: a skill is only excluded when we're confident it can't apply. Never
 * returns an empty list — if every skill somehow gets filtered out, the full registry is returned
 * as a safe fallback rather than leaving the model with no tools at all.
 */
export function filterRelevantSkills(
  context: DecisionContext,
  registry: SkillRegistry,
): SkillFilterResult {
  const hasHostileNearby = context.nearbyEntities.some((entity) => entity.isHostile);
  const hasGoalOrTask = context.goal !== null || context.activeTask !== null;
  const hasNearbyBlocks = context.nearbyBlockTypes.length > 0;
  const hasInventory = context.inventory.length > 0;

  const hidden: HiddenSkill[] = [];

  const filtered = registry.list().filter((skill) => {
    switch (skill.category) {
      case 'combat':
        if (!hasHostileNearby) {
          hidden.push({ name: skill.name, reason: 'no hostile entity nearby' });
          return false;
        }
        return true;
      case 'crafting':
        if (!hasGoalOrTask) {
          hidden.push({ name: skill.name, reason: 'no active goal or task' });
          return false;
        }
        if (!hasInventory) {
          hidden.push({ name: skill.name, reason: 'inventory is empty' });
          return false;
        }
        return true;
      case 'building':
        if (!hasGoalOrTask) {
          hidden.push({ name: skill.name, reason: 'no active goal or task' });
          return false;
        }
        return true;
      case 'gathering':
        if (!hasNearbyBlocks) {
          hidden.push({ name: skill.name, reason: 'no blocks nearby' });
          return false;
        }
        return true;
      case 'movement':
      case 'info':
      default:
        return true;
    }
  });

  if (filtered.length > 0) {
    return { skills: filtered, hidden };
  }

  // Safe fallback: never leave the model with zero tools, even if that means the hidden list
  // above no longer reflects what's actually offered.
  return { skills: registry.list(), hidden: [] };
}
