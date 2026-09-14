import type { BotOptions } from 'mineflayer';
import type { AppConfig } from '../config/env.js';

/**
 * Builds the host/port (or Realms lookup) subset of BotOptions for the configured connection mode.
 *
 * Synchronous and side-effect free: no network calls happen here. In `realm` mode, the actual
 * Realm lookup is performed natively by `minecraft-protocol` inside `mineflayer.createBot()`
 * (it builds its own Authflow, calls the Realms API, and resolves host/port before connecting)
 * — verified by reading `minecraft-protocol/src/client/microsoftAuth.js`. We only need to supply
 * the `realms.pickRealm` callback; no direct `prismarine-auth`/`prismarine-realms` dependency is
 * required. Because this resolution runs fresh inside every `createClient` call, a realm's
 * address rotating between sessions is a non-issue as long as reconnects create a fresh bot.
 */
export function buildConnectionOptions(
  config: Pick<AppConfig, 'connectionMode' | 'serverHost' | 'serverPort' | 'realmName'>,
): Partial<BotOptions> {
  if (config.connectionMode === 'direct') {
    return { host: config.serverHost, port: config.serverPort };
  }

  const realmName = config.realmName;
  if (!realmName) {
    // Unreachable in practice: env.ts's superRefine already requires realmName in realm mode.
    throw new Error('REALM_NAME is required when CONNECTION_MODE=realm');
  }

  return {
    realms: {
      pickRealm: (realms) => {
        const match = realms.find((realm) => realm.name.toLowerCase() === realmName.toLowerCase());
        if (!match) {
          const available = realms.map((realm) => realm.name).join(', ') || '(none)';
          throw new Error(`Realm "${realmName}" not found. Available realms: ${available}`);
        }
        return match;
      },
    },
  };
}
