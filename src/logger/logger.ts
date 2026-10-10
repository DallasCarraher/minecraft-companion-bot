import pino from 'pino';
import type { AppConfig } from '../config/env.js';

export type Logger = pino.Logger;

/** Every dev run's logs land here (newest entries appended to the bottom) so they can be read after the bot is stopped. */
export const DEV_LOG_FILE = 'logs/dev.log';

export function createLogger(config: Pick<AppConfig, 'logLevel'>): Logger {
  const fileTarget = {
    target: 'pino-pretty',
    level: config.logLevel,
    options: { colorize: false, destination: DEV_LOG_FILE, mkdir: true, append: true },
  };

  return pino({
    level: config.logLevel,
    transport: {
      targets:
        process.env.NODE_ENV === 'production'
          ? [fileTarget]
          : [{ target: 'pino-pretty', level: config.logLevel, options: { colorize: true } }, fileTarget],
    },
  });
}
