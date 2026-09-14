import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';

/**
 * Minimal EventEmitter-based fake mineflayer Bot, stubbing only the surface that
 * `contextBuilder.ts`, `decisionLoop.ts`, and `chat/router.ts` actually touch. Not a full `Bot` —
 * cast through `unknown` deliberately, since satisfying the real (huge) `Bot` interface would add
 * far more test-fixture maintenance than it buys.
 */
export function createFakeBot(overrides: Record<string, unknown> = {}): Bot {
  const emitter = new EventEmitter();

  const fake = {
    username: 'TestBot',
    entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 0 } },
    entities: {},
    players: {},
    inventory: { items: () => [] },
    findBlocks: () => [],
    findBlock: () => null,
    blockAt: () => null,
    registry: { blocksByName: { air: { id: 0 } }, itemsByName: {} },
    chat: () => {},
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    emit: emitter.emit.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
    ...overrides,
  };

  return fake as unknown as Bot;
}
