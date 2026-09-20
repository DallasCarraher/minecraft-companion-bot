import type { Bot } from 'mineflayer';

type InvItem = ReturnType<Bot['inventory']['items']>[number];
type NamedItem = Pick<InvItem, 'name'>;

const TIER_DAMAGE: Record<string, { sword: number; axe: number; axeSpeed: number }> = {
  netherite: { sword: 8, axe: 10, axeSpeed: 1.0 },
  diamond: { sword: 7, axe: 9, axeSpeed: 1.0 },
  iron: { sword: 6, axe: 9, axeSpeed: 0.9 },
  stone: { sword: 5, axe: 9, axeSpeed: 0.8 },
  golden: { sword: 4, axe: 7, axeSpeed: 1.0 },
  wooden: { sword: 4, axe: 7, axeSpeed: 0.8 },
};
const SWORD_SPEED = 1.6;
const ARROWS = new Set(['arrow', 'spectral_arrow', 'tipped_arrow']);

/** Damage per second of a melee item at full cooldown; 0 if it isn't a melee weapon. */
export function meleeDps(name: string): number {
  const match = /^(netherite|diamond|iron|stone|golden|wooden)_(sword|axe)$/.exec(name);
  if (!match) return 0;
  const tier = TIER_DAMAGE[match[1]!]!;
  return match[2] === 'sword' ? tier.sword * SWORD_SPEED : tier.axe * tier.axeSpeed;
}

export function bestMelee<T extends NamedItem>(items: T[]): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (meleeDps(item.name) > (best ? meleeDps(best.name) : 0)) best = item;
  }
  return best;
}

export function findBow<T extends NamedItem>(items: T[]): T | null {
  return items.find((item) => item.name === 'bow') ?? null;
}

export function hasArrows(items: (NamedItem & { count: number })[]): boolean {
  return items.some((item) => ARROWS.has(item.name) && item.count > 0);
}
