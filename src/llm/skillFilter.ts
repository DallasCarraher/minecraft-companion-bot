import type { SkillRegistry } from '../skills/registry.js';
import type { Skill } from '../skills/types.js';
import type { DecisionContext } from './contextBuilder.js';

/** Only relevant when a hostile mob is actually nearby. */
const COMBAT_SKILLS = new Set(['attackNearest', 'stopCombat', 'fleeFrom']);

/**
 * Only relevant when there's an active goal/task that might call for them.
 *
 * craftItem is deliberately NOT in this set: a player can ask to craft something in plain chat
 * without any goal/task ever being created, and filtering it out there left the model unable to
 * call it at all -- it would hallucinate an excuse instead of reporting a real error.
 */
const GOAL_GATED_SKILLS = new Set(['buildStructure']);

/**
 * Narrows the tool list sent to the model each decision tick, based on the same `DecisionContext`
 * already assembled for the tick's user message. Movement, gathering, and inventory skills have no
 * cheap precondition worth checking, so they're always included.
 *
 * Conservative by design: a skill is only excluded when we're confident it can't apply (no
 * hostiles nearby, no goal/task in play), and the "no cheap precondition" bucket errs toward
 * inclusion. Never returns an empty list — if every skill somehow gets filtered out, the full
 * registry is returned as a safe fallback rather than leaving the model with no tools at all.
 */
export function filterRelevantSkills(
  context: DecisionContext,
  registry: SkillRegistry,
): Skill<unknown>[] {
  const hasHostileNearby = context.nearbyEntities.some((entity) => entity.isHostile);
  const hasGoalOrTask = context.goal !== null || context.activeTask !== null;

  const filtered = registry.list().filter((skill) => {
    if (COMBAT_SKILLS.has(skill.name)) return hasHostileNearby;
    if (GOAL_GATED_SKILLS.has(skill.name)) return hasGoalOrTask;
    return true;
  });

  return filtered.length > 0 ? filtered : registry.list();
}
