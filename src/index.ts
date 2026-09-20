import { loadConfig } from './config/env.js';
import { createLogger } from './logger/logger.js';
import { createBot } from './mineflayer/client.js';
import { ReconnectSupervisor } from './mineflayer/reconnect.js';
import { SkillRegistry, registerAllSkills } from './skills/index.js';
import { createLLMProvider, createEscalationProvider } from './llm/providers/factory.js';
import { MemoryStore } from './memory/store.js';
import { ChatRouter } from './chat/router.js';
import { Reflexes } from './mineflayer/reflexes.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);

  const registry = new SkillRegistry();
  registerAllSkills(registry);

  const provider = createLLMProvider(config);
  const escalationProvider = createEscalationProvider(config);

  const memory = await MemoryStore.loadOrCreate('default', 'data', (message) =>
    logger.warn(message),
  );

  let activeRouter: ChatRouter | null = null;

  const supervisor = new ReconnectSupervisor(
    () => createBot(config, logger),
    logger,
    (reason) => {
      logger.warn({ reason }, 'connection lost');
      activeRouter?.cancelActive();
      memory.update((draft) => {
        for (const task of draft.taskQueue) {
          if (task.status === 'active') task.status = 'interrupted';
        }
      });
    },
  );

  supervisor.start((bot) => {
    const reflexes = new Reflexes(bot, logger);
    reflexes.attach();
    const router = new ChatRouter({
      bot,
      memory,
      provider,
      escalationProvider,
      registry,
      config,
      logger,
      onCancel: () => reflexes.cancel(),
    });
    router.attach();
    activeRouter = router;
    bot.once('spawn', () => logger.info({ username: bot.username }, 'bot spawned and ready'));
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    activeRouter?.cancelActive();
    await memory.flush();
    supervisor.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
