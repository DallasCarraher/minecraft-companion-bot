import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import type { Logger } from '../logger/logger.js';
import { eatBestFood } from './eat.js';
import { bestMelee, findBow, findShield, hasArrows } from './weapons.js';

const { goals } = pathfinderPkg;

const EAT_BELOW_FOOD = 14;
const EMERGENCY_FOOD = 6;
const FOOD_ALERT_COOLDOWN_MS = 180_000;
const URGENT_FOOD_ALERT_COOLDOWN_MS = 60_000;
const DEFEND_RADIUS = 6;
const CHECK_INTERVAL_MS = 1_000;
/** Never provoke these at all. */
const NEVER_ENGAGE = new Set(['enderman']);
/** Fine to shoot from range, but melee-ing them is a mistake (they explode). */
const RANGED_ONLY = new Set(['creeper']);
/** How far away counts as "safe" when backing off from a threat we won't fight. */
const FLEE_DISTANCE = 10;
/** Switch targets only when another hostile is at least this much closer (avoids thrashing). */
const RETARGET_MARGIN = 1.5;
const BOW_MIN_RANGE = 6;
const BOW_MAX_RANGE = 28;
const BOW_CHARGE_MS = 1_100;
/**
 * While following a player, drop a fight and run back once they're this far from the bot and the
 * enemy; only start fighting again once they're back inside the (smaller) resume distance. Kept
 * tight so a reflex fight doesn't drag the bot far off a "follow me" course chasing something that
 * isn't actually a threat to the player yet — it snaps back to following quickly instead.
 */
const LEASH_DISTANCE = 8;
const LEASH_RESUME_DISTANCE = 5;
const FIGHT_TIMEOUT_MS = 90_000;
const ARROW_SPEED = 2.7; // blocks/tick, average after drag
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Entity = Bot['entity'];
type PathGoal = NonNullable<Bot['pathfinder']['goal']>;

/**
 * Autonomous survival reflexes that run without an LLM call: eat when hungry, and fight hostile
 * mobs that threaten the bot or a nearby player. After a fight, any follow/goto goal that the
 * fight preempted is restored so "follow me and defend me" keeps working.
 */
export class Reflexes {
  private eating = false;
  private lastFoodAlertAt = 0;
  private fighting = false;
  private fightId = 0;
  private userGoal: { goal: PathGoal; dynamic: boolean } | null = null;
  private suppressedUntil = 0;
  private shieldRaised = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly bot: Bot,
    private readonly logger: Logger,
  ) {}

  attach(): void {
    const { bot } = this;
    // Track the goal the user's commands set, ignoring pvp's own follow-the-target goal.
    bot.on('goal_updated', (goal: PathGoal | null, dynamic: boolean) => {
      if (this.fighting) return;
      this.userGoal = goal ? { goal, dynamic } : null;
    });
    bot.on('entityHurt', (entity: Entity) => this.onEntityHurt(entity));
    bot.on('health', () => void this.maybeEat());
    this.timer = setInterval(() => this.tick(), CHECK_INTERVAL_MS);
    bot.once('end', () => this.detach());
  }

  detach(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Called on the "stop" command: end any reflex fight and don't resume the old goal. */
  cancel(): void {
    this.userGoal = null;
    this.suppressedUntil = Date.now() + 5_000;
    if (this.fighting) {
      this.fighting = false;
      this.fightId++;
      void this.bot.pvp.stop();
    }
  }

  private tick(): void {
    void this.maybeEat();
    if (this.bot.health === undefined) return;
    const threat = this.findThreat(this.bot.entity, this.scanRadius());
    if (threat) this.engage(threat);
  }

  private onEntityHurt(hurt: Entity): void {
    const { bot } = this;
    const isSelf = hurt === bot.entity;
    const isPlayer = hurt.type === 'player' && hurt.username !== bot.username;
    if (!isSelf && !isPlayer) return;
    const threat = this.findThreat(hurt, this.scanRadius() + 2);
    if (threat) this.engage(threat);
  }

  /**
   * How far out to notice hostiles. With a bow in hand this reaches out to full bow range, so
   * arrows get loosed at approaching mobs well before they close to melee distance; without one
   * there's no way to soften them up early, so stick to the tight defend radius.
   */
  private scanRadius(): number {
    return this.canShoot() ? BOW_MAX_RANGE : DEFEND_RADIUS;
  }

  private findThreat(around: Entity, radius: number): Entity | null {
    const { bot } = this;
    const found = bot.nearestEntity(
      (e) =>
        e.type === 'hostile' &&
        !NEVER_ENGAGE.has(e.name ?? '') &&
        e.position.distanceTo(around.position) <= radius &&
        e.position.distanceTo(bot.entity.position) <= radius + 4,
    );
    return found ?? null;
  }

  private engage(target: Entity): void {
    const { bot } = this;
    if (Date.now() < this.suppressedUntil || bot.pvp.target || this.fighting) return;
    if (this.ownerFled(target, LEASH_RESUME_DISTANCE)) return;
    this.fighting = true;
    const id = ++this.fightId;
    if (RANGED_ONLY.has(target.name ?? '') && !this.canEngageRanged(target)) {
      this.logger.info({ target: target.name }, 'reflex: fleeing (no clear shot)');
      void this.flee(target, id).finally(() => this.onFightEnded(id));
      return;
    }
    this.logger.info({ target: target.name }, 'reflex: defending');
    void this.fight(target, id).finally(() => this.onFightEnded(id));
  }

  /** The player we're currently following, if any — the one the bot should stay close to. */
  private followedPlayer(): Entity | null {
    const followed = (this.userGoal?.goal as { entity?: Entity } | undefined)?.entity;
    if (followed?.type !== 'player') return null;
    return (followed.username && this.bot.players[followed.username]?.entity) || followed;
  }

  /** True when the followed player has moved away from both us and the enemy. */
  private ownerFled(target: Entity, maxDistance: number): boolean {
    const owner = this.followedPlayer();
    if (!owner) return false;
    return (
      owner.position.distanceTo(this.bot.entity.position) > maxDistance &&
      owner.position.distanceTo(target.position) > maxDistance - 4
    );
  }

  private canShoot(): boolean {
    const items = this.bot.inventory.items();
    return findBow(items) !== null && hasArrows(items);
  }

  /** Whether we could loose an arrow at `target` right now: armed, and an unobstructed view of it. */
  private canEngageRanged(target: Entity): boolean {
    return this.canShoot() && this.hasLineOfSight(target);
  }

  /**
   * True when nothing solid sits between our eyes and the target's center — otherwise `shoot()`
   * would draw and fire a bow at a mob it can't actually hit through a wall, floor, or hill.
   */
  private hasLineOfSight(target: Entity): boolean {
    const { bot } = this;
    // `eyeHeight` is set at runtime by mineflayer's entities plugin but missing from its types.
    const eyeHeight = (bot.entity as { eyeHeight?: number }).eyeHeight ?? 1.62;
    const origin = new Vec3(
      bot.entity.position.x,
      bot.entity.position.y + eyeHeight,
      bot.entity.position.z,
    );
    const aim = new Vec3(
      target.position.x,
      target.position.y + target.height / 2,
      target.position.z,
    );
    const delta = aim.minus(origin);
    const distance = delta.norm();
    if (distance < 0.001) return true;
    return bot.world.raycast(origin, delta.normalize(), distance) === null;
  }

  /** Backs away from a threat we won't fight right now (e.g. a creeper with no clear shot). */
  private async flee(target: Entity, id: number): Promise<void> {
    const { bot } = this;
    const deadline = Date.now() + FIGHT_TIMEOUT_MS;
    const running = () =>
      this.fightId === id && Date.now() < deadline && bot.health !== undefined && bot.health > 0;
    bot.pathfinder.stop();
    try {
      while (running() && bot.entities[target.id] === target) {
        if (this.ownerFled(target, LEASH_DISTANCE)) return;
        if (target.position.distanceTo(bot.entity.position) >= FLEE_DISTANCE) return;
        const goal = new goals.GoalInvert(
          new goals.GoalNear(
            target.position.x,
            target.position.y,
            target.position.z,
            FLEE_DISTANCE,
          ),
        );
        bot.pathfinder.setGoal(goal);
        await sleep(250);
      }
    } catch (err) {
      this.logger.warn({ err }, 'reflex: flee failed');
    } finally {
      bot.pathfinder.stop();
    }
  }

  private async fight(first: Entity, id: number): Promise<void> {
    const { bot } = this;
    const deadline = Date.now() + FIGHT_TIMEOUT_MS;
    const running = () =>
      this.fightId === id && Date.now() < deadline && bot.health !== undefined && bot.health > 0;
    const targetOn = (t: Entity) =>
      running() && bot.entities[t.id] === t && !this.ownerFled(t, LEASH_DISTANCE);
    let target = first;
    try {
      bot.pathfinder.stop();
      while (running()) {
        await sleep(50); // never spin, whatever the branches below decide
        if (bot.entities[target.id] !== target) {
          // Target died or left: carry on with whatever else is threatening us.
          const next = this.findThreat(bot.entity, DEFEND_RADIUS);
          if (!next) return;
          target = next;
          continue;
        }
        if (this.ownerFled(target, LEASH_DISTANCE)) return;
        target = this.closerThreat(target) ?? target;
        const current = target;
        const stillOn = () => targetOn(current);
        const distance = current.position.distanceTo(bot.entity.position);
        if (
          this.canShoot() &&
          distance >= BOW_MIN_RANGE &&
          distance <= BOW_MAX_RANGE &&
          this.hasLineOfSight(current)
        ) {
          await this.shoot(current, stillOn);
        } else if (RANGED_ONLY.has(current.name ?? '') || distance > BOW_MAX_RANGE + 4) {
          return;
        } else {
          await this.melee(current, stillOn);
        }
      }
    } catch (err) {
      this.logger.warn({ err }, 'reflex: fight failed');
    } finally {
      await bot.pvp.stop();
      this.lowerShield();
      // Only release an item we're actually using (a drawn bow) — never spuriously.
      if (bot.usingHeldItem) bot.deactivateItem();
    }
  }

  /** Equips a shield to the off-hand, if the bot has one, and raises it to block. */
  private async raiseShield(): Promise<void> {
    if (this.shieldRaised) return;
    const { bot } = this;
    const shield = findShield(bot.inventory.items());
    if (!shield) return;
    if (bot.inventory.slots?.[45]?.type !== shield.type) {
      await bot.equip(shield, 'off-hand').catch(() => {});
    }
    bot.activateItem(true);
    this.shieldRaised = true;
  }

  /** Lowers the shield, if raised — needed before drawing a bow, since only one hand can be "in use". */
  private lowerShield(): void {
    if (!this.shieldRaised) return;
    this.bot.deactivateItem();
    this.shieldRaised = false;
  }

  /** A hostile meaningfully closer than `target` (e.g. a second zombie swarming us), if any. */
  private closerThreat(target: Entity): Entity | null {
    const { bot } = this;
    const targetDistance = target.position.distanceTo(bot.entity.position);
    const found = bot.nearestEntity(
      (e) =>
        e !== target &&
        e.type === 'hostile' &&
        !NEVER_ENGAGE.has(e.name ?? '') &&
        !(RANGED_ONLY.has(e.name ?? '') && !this.canEngageRanged(e)) &&
        e.position.distanceTo(bot.entity.position) <= DEFEND_RADIUS &&
        e.position.distanceTo(bot.entity.position) < targetDistance - RETARGET_MARGIN,
    );
    return found ?? null;
  }

  /** Melee until the target dies, a closer threat shows up, or (if we can shoot) it backs off. */
  private async melee(target: Entity, stillOn: () => boolean): Promise<void> {
    const { bot } = this;
    bot.pvp.attack(target);
    // A shield in the off-hand doesn't stop a main-hand sword swing, so keep it raised throughout.
    await this.raiseShield();
    while (stillOn() && bot.pvp.target === target) {
      const sword = bestMelee(bot.inventory.items());
      if (sword && bot.heldItem?.type !== sword.type && !this.eating) {
        await bot.equip(sword, 'hand');
      }
      if (this.closerThreat(target)) break;
      const distance = target.position.distanceTo(bot.entity.position);
      if (this.canShoot() && distance >= BOW_MIN_RANGE + 2) break;
      await sleep(250);
    }
    await bot.pvp.stop();
  }

  private async shoot(target: Entity, stillOn: () => boolean): Promise<void> {
    const { bot } = this;
    const bow = findBow(bot.inventory.items());
    if (!bow) return;
    await bot.pvp.stop();
    // Drawing a bow and holding a shield up both occupy the "active item" state — can't do both.
    this.lowerShield();
    if (bot.heldItem?.type !== bow.type) await bot.equip(bow, 'hand');
    bot.activateItem();
    const chargeUntil = Date.now() + BOW_CHARGE_MS;
    while (Date.now() < chargeUntil && stillOn()) {
      await this.aimAt(target);
      await sleep(100);
    }
    if (stillOn()) await this.aimAt(target);
    bot.deactivateItem();
    await sleep(350);
  }

  /** Leads the target by its velocity and lifts the aim to compensate for arrow drop. */
  private async aimAt(target: Entity): Promise<void> {
    const { bot } = this;
    const distance = target.position.distanceTo(bot.entity.position);
    const flightTicks = distance / ARROW_SPEED;
    const drop = 0.5 * 0.05 * flightTicks * flightTicks;
    const aim = target.position
      .offset(0, target.height * 0.85 + drop, 0)
      .plus(target.velocity.scaled(flightTicks));
    await bot.lookAt(aim, true);
  }

  private onFightEnded(id: number): void {
    if (this.fightId !== id) return;
    this.fighting = false;
    void this.equipBestMelee();
    const saved = this.userGoal;
    if (saved && Date.now() >= this.suppressedUntil) {
      this.bot.pathfinder.setGoal(saved.goal, saved.dynamic);
    }
  }

  private async equipBestMelee(): Promise<void> {
    const sword = bestMelee(this.bot.inventory.items());
    if (sword && this.bot.heldItem?.type !== sword.type) {
      await this.bot.equip(sword, 'hand').catch(() => {});
    }
  }

  private async maybeEat(): Promise<void> {
    const { bot } = this;
    if (this.eating || bot.food === undefined || bot.food > EAT_BELOW_FOOD) return;
    if (bot.pvp.target && bot.food > EMERGENCY_FOOD) return;
    this.eating = true;
    try {
      const eaten = await eatBestFood(bot);
      if (eaten) {
        this.lastFoodAlertAt = 0; // next shortage should alert right away
        this.logger.info({ eaten, food: bot.food }, 'reflex: ate');
      } else {
        this.alertNeedsFood();
      }
    } catch (err) {
      this.logger.warn({ err }, 'reflex: eating failed');
    } finally {
      this.eating = false;
    }
  }

  /** Tells players in chat that the bot is hungry with nothing edible; rate-limited. */
  private alertNeedsFood(): void {
    const { bot } = this;
    const urgent = bot.food <= EMERGENCY_FOOD;
    const cooldown = urgent ? URGENT_FOOD_ALERT_COOLDOWN_MS : FOOD_ALERT_COOLDOWN_MS;
    if (Date.now() - this.lastFoodAlertAt < cooldown) return;
    this.lastFoodAlertAt = Date.now();
    bot.chat(
      urgent
        ? "I'm starving and out of food — can you give me something to eat?"
        : "I'm getting hungry and I'm out of food. Can you spare some?",
    );
  }
}
