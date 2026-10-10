import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';

const { Movements } = pathfinderPkg;

/**
 * Shared base for both configs below. Dry drops are capped at 3 blocks (fall damage starts above
 * 3; pathfinder's default is 4). Drops that land in water are still allowed at any height
 * (`infiniteLiquidDropdownDistance`, the pathfinder default), since water negates fall damage.
 */
function createMovements(bot: Bot, canDig: boolean): InstanceType<typeof Movements> {
  const movements = new Movements(bot);
  movements.canDig = canDig;
  movements.maxDropDown = 3;
  return movements;
}

/**
 * Pathfinder digs through anything in its way by default, which means ambient movement — walking
 * to a block, an autonomous reflex fight chasing a mob it noticed on its own — could tunnel
 * straight through a player's house, or a hole straight into the ground. This is the baseline,
 * non-destructive config used everywhere except an explicit "come to me" command (see
 * `applyDiggingMovements`). collectBlock's own explicit target block is still dug directly via
 * `bot.dig()`, so intentional harvesting keeps working.
 */
export function applySafeMovements(bot: Bot): void {
  bot.pathfinder.setMovements(createMovements(bot, false));
  if (bot.collectBlock.movements) {
    bot.collectBlock.movements.canDig = false;
  }
  if (bot.pvp.movements) {
    bot.pvp.movements.canDig = false;
  }
}

/**
 * followPlayer/goToPlayer are an explicit, high-priority "get to me, no matter what" command —
 * unlike ambient movement, they're allowed to dig, including digging back out of a hole the bot
 * got stuck in (e.g. one an older build's reflex combat tunneled). Pathfinder still prefers a
 * non-destructive route when one exists (digging only adds cost, it doesn't force it), so this
 * doesn't make the bot dig for no reason — it just stops "no path found" from being a dead end.
 */
export function applyDiggingMovements(bot: Bot): void {
  bot.pathfinder.setMovements(createMovements(bot, true));
}
