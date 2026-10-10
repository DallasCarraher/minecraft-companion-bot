import type { Bot } from 'mineflayer';

/** Foods that hurt more than they help; never eaten automatically. */
const AVOID_FOODS = new Set([
  'rotten_flesh',
  'spider_eye',
  'pufferfish',
  'poisonous_potato',
  'chorus_fruit',
  'suspicious_stew',
]);

export function pickBestFood(bot: Bot) {
  const foods = bot.registry.foodsByName;
  let best: { item: ReturnType<Bot['inventory']['items']>[number]; score: number } | null = null;
  for (const item of bot.inventory.items()) {
    const food = foods[item.name];
    if (!food || AVOID_FOODS.has(item.name)) continue;
    const score = food.foodPoints * 10 + food.saturation;
    if (!best || score > best.score) best = { item, score };
  }
  return best?.item ?? null;
}

/** Eats the best food in the inventory. Returns the item name eaten, or null if there's none. */
export async function eatBestFood(bot: Bot): Promise<string | null> {
  const item = pickBestFood(bot);
  if (!item) return null;
  const previous = bot.heldItem;
  await bot.equip(item, 'hand');
  try {
    await bot.consume();
  } finally {
    // Don't leave the food in hand — the previous item is usually a weapon or tool.
    const restore = previous && bot.inventory.items().find((i) => i.type === previous.type);
    if (restore && restore.name !== item.name) await bot.equip(restore, 'hand');
  }
  return item.name;
}
