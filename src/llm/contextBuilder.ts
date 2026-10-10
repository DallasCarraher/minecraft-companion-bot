import type { Bot } from 'mineflayer';
import type { MemoryStore } from '../memory/store.js';
import type { ChatTurn, KnownLocation, TaskQueueItem } from '../memory/types.js';
import type { NormalizedMessage } from './types.js';

const NEARBY_BLOCK_RADIUS = 16;
const NEARBY_BLOCK_SAMPLE_LIMIT = 200;
const NEARBY_BLOCK_TYPE_LIMIT = 15;
const NEARBY_ENTITY_LIMIT = 10;

export interface DecisionContext {
  triggerMessage: ChatTurn;
  recentChat: ChatTurn[];
  health: number | null;
  food: number | null;
  inventory: { name: string; count: number }[];
  nearbyBlockTypes: string[];
  nearbyEntities: { name: string; distance: number; isHostile: boolean }[];
  goal: { description: string; createdAt: string } | null;
  activeTask: TaskQueueItem | null;
  relevantKnownLocations: KnownLocation[];
}

export function assembleDecisionContext(
  bot: Bot,
  memory: MemoryStore,
  triggerMessage: ChatTurn,
): DecisionContext {
  const snapshot = memory.snapshot;

  const inventoryByName = new Map<string, number>();
  for (const item of bot.inventory.items()) {
    inventoryByName.set(item.name, (inventoryByName.get(item.name) ?? 0) + item.count);
  }

  const airId = bot.registry.blocksByName['air']?.id;
  const nearbyBlockTypes = [
    ...new Set(
      bot
        .findBlocks({
          point: bot.entity.position,
          matching: (block) => block.type !== airId,
          maxDistance: NEARBY_BLOCK_RADIUS,
          count: NEARBY_BLOCK_SAMPLE_LIMIT,
        })
        .map((pos) => bot.blockAt(pos)?.name)
        .filter((name): name is string => Boolean(name)),
    ),
  ].slice(0, NEARBY_BLOCK_TYPE_LIMIT);

  const nearbyEntities = Object.values(bot.entities)
    .filter((entity) => entity !== bot.entity)
    .map((entity) => ({
      name: entity.username ?? entity.name ?? entity.type,
      distance: entity.position.distanceTo(bot.entity.position),
      isHostile: entity.type === 'hostile',
    }))
    .toSorted((a, b) => a.distance - b.distance)
    .slice(0, NEARBY_ENTITY_LIMIT);

  const messageWords = new Set(triggerMessage.text.toLowerCase().split(/\W+/).filter(Boolean));
  const relevantKnownLocations = Object.values(snapshot.knownLocations).filter((loc) =>
    loc.label
      .toLowerCase()
      .split(/\W+/)
      .some((word) => messageWords.has(word)),
  );

  return {
    triggerMessage,
    recentChat: snapshot.conversation,
    health: bot.health ?? null,
    food: bot.food ?? null,
    inventory: [...inventoryByName.entries()].map(([name, count]) => ({ name, count })),
    nearbyBlockTypes,
    nearbyEntities,
    goal: snapshot.goal,
    activeTask: snapshot.taskQueue.find((task) => task.status === 'active') ?? null,
    relevantKnownLocations,
  };
}

/** Serializes the assembled context into the first user-role message of a decision tick. */
export function contextToMessage(context: DecisionContext): NormalizedMessage {
  const lines = [
    `Chat from ${context.triggerMessage.username ?? 'unknown'}: "${context.triggerMessage.text}"`,
    '',
    `Recent chat: ${
      context.recentChat
        .slice(-10)
        .map((turn) => `${turn.username ?? turn.role}: ${turn.text}`)
        .join(' | ') || '(none)'
    }`,
    `Health: ${context.health ?? '?'}/20, Food: ${context.food ?? '?'}/20`,
    `Inventory: ${context.inventory.map((item) => `${item.name} x${item.count}`).join(', ') || '(empty)'}`,
    `Nearby blocks: ${context.nearbyBlockTypes.join(', ') || '(none)'}`,
    `Nearby entities: ${context.nearbyEntities.map((e) => `${e.name} (${e.distance.toFixed(1)}m)`).join(', ') || '(none)'}`,
    `Current goal: ${context.goal?.description ?? '(none)'}`,
    `Active task: ${context.activeTask?.description ?? '(none)'}`,
    `Relevant known locations: ${
      context.relevantKnownLocations
        .map((loc) => `${loc.label} (${loc.x}, ${loc.y}, ${loc.z})`)
        .join(', ') || '(none)'
    }`,
  ];

  return { role: 'user', text: lines.join('\n') };
}
