import type { Bot } from 'mineflayer';
import type { Logger } from '../logger/logger.js';
import { exponentialBackoff } from '../util/backoff.js';
import {
  RECONNECT_BACKOFF_INITIAL_MS,
  RECONNECT_BACKOFF_MAX_MS,
  RECONNECT_STABLE_UPTIME_MS,
} from '../config/constants.js';

/**
 * Owns the bot's connect/reconnect lifecycle. On disconnect it backs off exponentially and
 * creates a fresh bot via `factory`. Each new bot is handed to `onBot`, which is responsible for
 * wiring up (and tearing down) everything that depends on a live `Bot` instance — e.g. the chat
 * router — since those can't simply be reused across reconnects.
 *
 * Deliberately does not attempt to resume whatever the bot was doing before it disconnected: an
 * in-flight skill is abandoned, not retried automatically, since world state may have changed
 * while offline (block mined by someone else, player moved). `onDisconnect` exists so callers can
 * react to that (e.g. mark the active task `interrupted` in memory) without this module needing
 * to know anything about skills or memory.
 */
export class ReconnectSupervisor {
  private stopped = false;
  private currentBot: Bot | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = exponentialBackoff(RECONNECT_BACKOFF_INITIAL_MS, RECONNECT_BACKOFF_MAX_MS);
  private stableUptimeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly factory: () => Bot,
    private readonly logger: Logger,
    private readonly onDisconnect?: (reason: string) => void,
  ) {}

  start(onBot: (bot: Bot) => void): void {
    this.spawnBot(onBot);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.stableUptimeTimer) clearTimeout(this.stableUptimeTimer);
    this.currentBot?.end('shutdown');
  }

  private spawnBot(onBot: (bot: Bot) => void): void {
    const bot = this.factory();
    this.currentBot = bot;

    bot.once('spawn', () => {
      this.backoff = exponentialBackoff(RECONNECT_BACKOFF_INITIAL_MS, RECONNECT_BACKOFF_MAX_MS);
      this.stableUptimeTimer = setTimeout(() => {
        this.logger.debug('connection stable, backoff counter reset');
      }, RECONNECT_STABLE_UPTIME_MS);
    });

    let disconnected = false;
    const handleDisconnect = (reason: string) => {
      if (disconnected) return; // mineflayer emits both 'kicked' and 'end' for a single disconnect
      disconnected = true;

      if (this.stableUptimeTimer) clearTimeout(this.stableUptimeTimer);
      if (this.stopped) return;

      this.logger.warn({ reason }, 'bot disconnected, scheduling reconnect');
      this.onDisconnect?.(reason);

      const delayMs = this.backoff.next().value;
      this.reconnectTimer = setTimeout(() => this.spawnBot(onBot), delayMs);
    };

    bot.once('end', (reason: string) => handleDisconnect(reason ?? 'end'));
    bot.once('kicked', (reason: string) => handleDisconnect(`kicked: ${reason}`));

    onBot(bot);
  }
}
