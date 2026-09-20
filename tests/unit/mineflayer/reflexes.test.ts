import { describe, expect, it, vi } from 'vitest';
import { pickBestFood } from '../../../src/mineflayer/eat.js';
import { bestMelee } from '../../../src/mineflayer/weapons.js';
import { Reflexes } from '../../../src/mineflayer/reflexes.js';
import { createFakeBot } from '../../fakes/fakeBot.js';

const foodsByName = {
  cooked_porkchop: { foodPoints: 8, saturation: 12.8 },
  bread: { foodPoints: 5, saturation: 6 },
  rotten_flesh: { foodPoints: 4, saturation: 0.8 },
};
const logger = { info: () => {}, warn: () => {} } as never;
async function waitUntil(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      return assertion();
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}
const pos = (x: number) => ({
  x,
  y: 64,
  z: 0,
  distanceTo: (o: { x: number }) => Math.abs(x - o.x),
});

describe('pickBestFood', () => {
  it('prefers the most nourishing food and skips harmful ones', () => {
    const bot = createFakeBot({
      registry: { foodsByName },
      inventory: {
        items: () => [
          { name: 'rotten_flesh', count: 9 },
          { name: 'bread', count: 3 },
          { name: 'cooked_porkchop', count: 64 },
          { name: 'dirt', count: 2 },
        ],
      },
    });
    expect(pickBestFood(bot)?.name).toBe('cooked_porkchop');
  });

  it('returns null when nothing is edible', () => {
    const bot = createFakeBot({
      registry: { foodsByName },
      inventory: { items: () => [{ name: 'rotten_flesh', count: 1 }] },
    });
    expect(pickBestFood(bot)).toBeNull();
  });
});

const inv = (...names: string[]) => names.map((name, i) => ({ name, type: i + 1, count: 1 }));

const withOffset = (e: ReturnType<typeof mob>) => {
  const p = e.position as unknown as { offset: unknown };
  p.offset = () => ({ plus: () => ({ x: 0, y: 0, z: 0 }) });
  return e;
};

describe('bestMelee', () => {
  it('prefers an iron sword over an iron axe, and ignores non-weapons', () => {
    const items = [{ name: 'cooked_porkchop' }, { name: 'iron_axe' }, { name: 'iron_sword' }];
    expect(bestMelee(items)?.name).toBe('iron_sword');
  });

  it('prefers a higher tier axe over a lower tier sword', () => {
    expect(bestMelee([{ name: 'wooden_sword' }, { name: 'diamond_axe' }])?.name).toBe(
      'diamond_axe',
    );
  });

  it('returns null with no melee weapon', () => {
    expect(bestMelee([{ name: 'bow' }, { name: 'dirt' }])).toBeNull();
  });
});

describe('Reflexes', () => {
  function setup(
    zombie: Record<string, unknown>,
    items = inv('cooked_porkchop', 'iron_axe', 'iron_sword'),
  ) {
    const equipped: string[] = [];
    const entities: Record<number, unknown> = { 7: zombie };
    const pvp = {
      target: null as unknown,
      attack: vi.fn<(e: unknown) => void>((e) => void (pvp.target = e)),
      stop: vi.fn<() => Promise<void>>(async () => void (pvp.target = null)),
    };
    const setGoal = vi.fn<(g: unknown, d: boolean) => void>();
    const activateItem = vi.fn<() => void>();
    const deactivateItem = vi.fn<() => void>();
    const bot = createFakeBot({
      entity: { position: pos(0) },
      food: 20,
      health: 20,
      heldItem: items[0],
      inventory: { items: () => items },
      entities,
      pvp,
      pathfinder: { setGoal, stop: () => {}, goal: null },
      equip: async (item: { name: string }) => void equipped.push(item.name),
      lookAt: async () => {},
      activateItem,
      deactivateItem,
      nearestEntity: (f: (e: unknown) => boolean) => (f(zombie) ? zombie : null),
    });
    const reflexes = new Reflexes(bot, logger);
    reflexes.attach();
    const hurt = () =>
      bot.emit('entityHurt', { type: 'player', username: 'Dall133', position: pos(2) } as never);
    const kill = () => {
      delete entities[7];
      pvp.target = null;
    };
    return { bot, reflexes, pvp, setGoal, equipped, activateItem, hurt, kill };
  }
  const mob = (name: string, x: number) => ({
    id: 7,
    type: 'hostile',
    name,
    height: 1.9,
    position: pos(x),
    velocity: { scaled: () => ({ x: 0, y: 0, z: 0 }) },
  });

  it('melees with the best weapon, not the item in hand', async () => {
    const zombie = mob('zombie', 3);
    const { reflexes, pvp, equipped, hurt, kill } = setup(zombie);
    hurt();
    expect(pvp.attack).toHaveBeenCalledWith(zombie);
    await waitUntil(() => expect(equipped).toContain('iron_sword'));
    expect(equipped).not.toContain('iron_axe');
    kill();
    reflexes.detach();
  });

  it('shoots a bow at range when it has arrows', async () => {
    const zombie = withOffset(mob('zombie', 8));
    const { reflexes, pvp, equipped, activateItem, hurt } = setup(
      zombie,
      inv('iron_sword', 'bow', 'arrow'),
    );
    hurt();
    await waitUntil(() => expect(activateItem).toHaveBeenCalled());
    expect(equipped).toContain('bow');
    expect(pvp.attack).not.toHaveBeenCalled();
    reflexes.cancel();
    reflexes.detach();
  });

  it('never melees creepers, and ignores them without a bow', () => {
    const creeper = mob('creeper', 2);
    const { reflexes, pvp, hurt } = setup(creeper);
    hurt();
    expect(pvp.attack).not.toHaveBeenCalled();
    reflexes.detach();
  });

  it('restores the follow goal after a reflex fight', async () => {
    const zombie = mob('zombie', 3);
    const { bot, reflexes, setGoal, hurt, kill } = setup(zombie);
    const follow = { kind: 'follow' };
    bot.emit('goal_updated' as never, follow as never, true as never);
    hurt();
    bot.emit('goal_updated' as never, { kind: 'pvp' } as never, true as never); // pvp's own: ignored
    kill();
    await waitUntil(() => expect(setGoal).toHaveBeenCalledWith(follow, true));
    reflexes.detach();
  });

  it('does not resume the old goal after cancel()', async () => {
    const zombie = mob('zombie', 3);
    const { bot, reflexes, setGoal, hurt, kill } = setup(zombie);
    bot.emit('goal_updated' as never, { kind: 'follow' } as never, true as never);
    hurt();
    reflexes.cancel();
    kill();
    await new Promise((r) => setTimeout(r, 400));
    expect(setGoal).not.toHaveBeenCalled();
    reflexes.detach();
  });

  it('drops the fight and returns to a followed player who runs off', async () => {
    const zombie = mob('zombie', 3);
    const { bot, reflexes, pvp, setGoal, hurt } = setup(zombie);
    const owner = { type: 'player', username: 'Dall133', position: pos(2) };
    const follow = { entity: owner };
    bot.emit('goal_updated' as never, follow as never, true as never);
    hurt();
    expect(pvp.attack).toHaveBeenCalled();
    owner.position = pos(40); // player flees
    await waitUntil(() => expect(setGoal).toHaveBeenCalledWith(follow, true));
    expect(pvp.target).toBeNull();
    reflexes.detach();
  });

  it('does not start a fight while the followed player is far away', () => {
    const zombie = mob('zombie', 3);
    const { bot, reflexes, pvp, hurt } = setup(zombie);
    const owner = { type: 'player', username: 'Dall133', position: pos(40) };
    bot.emit('goal_updated' as never, { entity: owner } as never, true as never);
    hurt();
    expect(pvp.attack).not.toHaveBeenCalled();
    reflexes.detach();
  });
});
