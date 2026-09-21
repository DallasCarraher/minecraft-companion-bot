import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import collectBlockPkg from 'mineflayer-collectblock';
import pvpPkg from 'mineflayer-pvp';
import toolPkg from 'mineflayer-tool';
import armorManager from 'mineflayer-armor-manager';

// All five plugins below are CommonJS with no named ESM exports. Under `"type": "module"` +
// `moduleResolution: "NodeNext"` they must be imported as a default import and destructured —
// a named import (e.g. `import { pathfinder } from 'mineflayer-pathfinder'`) compiles but fails
// at runtime because there is no such named export in the underlying CJS module.
const { pathfinder, Movements } = pathfinderPkg;
const { plugin: collectBlockPlugin } = collectBlockPkg;
const { plugin: pvpPlugin } = pvpPkg;
const { plugin: toolPlugin } = toolPkg;

/**
 * Conservative drop handling only: dig/place/parkour stay at pathfinder defaults (unchanged);
 * dry drops are capped at 3 blocks (fall damage starts above 3, pathfinder default was 4). Drops that land in water are still allowed at any height
 * (`infiniteLiquidDropdownDistance`), since water negates fall damage. Bubble columns
 * (soul-sand elevators) are NOT traversable by mineflayer-pathfinder; followPlayer's
 * unreachable fallback handles that case.
 */
export function createMovements(bot: Bot): InstanceType<typeof Movements> {
  const movements = new Movements(bot);
  movements.maxDropDown = 3;
  movements.infiniteLiquidDropdownDistance = true;
  return movements;
}

export function loadPlugins(bot: Bot): void {
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlockPlugin);
  bot.loadPlugin(pvpPlugin);
  bot.loadPlugin(toolPlugin);
  bot.loadPlugin(armorManager);

  bot.once('spawn', () => {
    bot.pathfinder.setMovements(createMovements(bot));
  });
}
