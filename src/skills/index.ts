import type { SkillRegistry } from './registry.js';
import { goToPlayer, followPlayer, fleeFrom } from './movement.js';
import { collectBlock, equipBestTool } from './gathering.js';
import { attackNearest, stopCombat } from './combat.js';
import { craftItem } from './crafting.js';
import { buildStructure } from './building.js';
import { equipArmor, dropJunk, chestTransfer } from './inventory.js';
import type { Skill } from './types.js';

export function registerAllSkills(registry: SkillRegistry): void {
  const skills: Skill<unknown>[] = [
    goToPlayer,
    followPlayer,
    fleeFrom,
    collectBlock,
    equipBestTool,
    attackNearest,
    stopCombat,
    craftItem,
    buildStructure,
    equipArmor,
    dropJunk,
    chestTransfer,
  ];

  for (const skill of skills) {
    registry.register(skill);
  }
}

export * from './types.js';
export { SkillRegistry } from './registry.js';
