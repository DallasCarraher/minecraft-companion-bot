import mineflayer, { type Bot } from 'mineflayer';
import type { AppConfig } from '../config/env.js';
import type { Logger } from '../logger/logger.js';
import { buildConnectionOptions } from './connectionTarget.js';
import { attachPacketDebug } from './packetDebug.js';
import { loadPlugins } from './plugins.js';

/**
 * Creates and connects a Mineflayer bot.
 *
 * Auth is handled entirely by mineflayer/minecraft-protocol internally: passing
 * `auth: 'microsoft'` with a `profilesFolder` makes it manage the Microsoft device-code flow and
 * token cache on its own (first run blocks on `onMsaCode` printing a URL+code; later runs are
 * silent). In `realm` connection mode, `buildConnectionOptions` supplies a `realms.pickRealm`
 * callback, and minecraft-protocol resolves the Realm's host/port natively before connecting.
 *
 * `version` is always pinned explicitly (never `'auto'`): letting Mineflayer auto-negotiate the
 * protocol version means a realm's version bump silently changes behavior mid-session with no
 * warning. Pinning makes a version bump a deliberate, visible operator action (bump
 * MINECRAFT_VERSION, and mineflayer/minecraft-data if needed).
 */
export function createBot(config: AppConfig, logger: Logger): Bot {
  const bot = mineflayer.createBot({
    username: config.botUsername,
    auth: 'microsoft',
    profilesFolder: config.msAuthProfilesFolder,
    version: config.minecraftVersion,
    onMsaCode: (data) => {
      logger.info(
        { verificationUri: data.verification_uri, userCode: data.user_code },
        'Sign in to Microsoft to authenticate the bot account (one-time; cached afterward)',
      );
    },
    ...buildConnectionOptions(config),
  });

  bot.on('error', (err) => logger.error({ err }, 'bot error'));

  attachPacketDebug(bot);
  loadPlugins(bot);

  return bot;
}
