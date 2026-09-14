import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

const AppConfigSchema = z
  .object({
    botUsername: z.string().min(1),
    minecraftVersion: z.string().min(1),

    connectionMode: z.enum(['direct', 'realm']),
    serverHost: z.string().optional(),
    serverPort: z.coerce.number().int().positive().default(25565),
    realmName: z.string().optional(),

    msAuthProfilesFolder: z.string().min(1),

    llmProvider: z.enum(['anthropic', 'openai']),
    anthropicApiKey: z.string().optional(),
    anthropicModelPrimary: z.string().default('claude-haiku-4-5'),
    anthropicModelEscalation: z.string().default('claude-sonnet-5'),
    openaiApiKey: z.string().optional(),
    openaiModelPrimary: z.string().default('gpt-4.1-mini'),

    chatTriggerMode: z.enum(['mention', 'prefix', 'all']).default('mention'),
    chatTriggerPrefix: z.string().default('!bot'),
    chatAllowlist: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name.length > 0),
      ),
    chatCooldownMs: z.coerce.number().int().nonnegative().default(3000),

    pathfinderMaxDistance: z.coerce.number().int().positive().default(128),
    combatAggressionRadius: z.coerce.number().int().positive().default(8),
    decisionLoopMaxIterations: z.coerce.number().int().positive().default(6),

    logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .superRefine((value, ctx) => {
    if (value.connectionMode === 'direct' && !value.serverHost) {
      ctx.addIssue({
        code: 'custom',
        path: ['serverHost'],
        message: 'SERVER_HOST is required when CONNECTION_MODE=direct',
      });
    }
    if (value.connectionMode === 'realm' && !value.realmName) {
      ctx.addIssue({
        code: 'custom',
        path: ['realmName'],
        message: 'REALM_NAME is required when CONNECTION_MODE=realm',
      });
    }
    if (value.llmProvider === 'anthropic' && !value.anthropicApiKey) {
      ctx.addIssue({
        code: 'custom',
        path: ['anthropicApiKey'],
        message: 'ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic',
      });
    }
    if (value.llmProvider === 'openai' && !value.openaiApiKey) {
      ctx.addIssue({
        code: 'custom',
        path: ['openaiApiKey'],
        message: 'OPENAI_API_KEY is required when LLM_PROVIDER=openai',
      });
    }
  });

export type AppConfig = z.infer<typeof AppConfigSchema>;

function readEnv(): Record<string, string | undefined> {
  return {
    botUsername: process.env.BOT_USERNAME,
    minecraftVersion: process.env.MINECRAFT_VERSION,
    connectionMode: process.env.CONNECTION_MODE,
    serverHost: process.env.SERVER_HOST,
    serverPort: process.env.SERVER_PORT,
    realmName: process.env.REALM_NAME,
    msAuthProfilesFolder: process.env.MS_AUTH_PROFILES_FOLDER,
    llmProvider: process.env.LLM_PROVIDER,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModelPrimary: process.env.ANTHROPIC_MODEL_PRIMARY,
    anthropicModelEscalation: process.env.ANTHROPIC_MODEL_ESCALATION,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModelPrimary: process.env.OPENAI_MODEL_PRIMARY,
    chatTriggerMode: process.env.CHAT_TRIGGER_MODE,
    chatTriggerPrefix: process.env.CHAT_TRIGGER_PREFIX,
    chatAllowlist: process.env.CHAT_ALLOWLIST,
    chatCooldownMs: process.env.CHAT_COOLDOWN_MS,
    pathfinderMaxDistance: process.env.PATHFINDER_MAX_DISTANCE,
    combatAggressionRadius: process.env.COMBAT_AGGRESSION_RADIUS,
    decisionLoopMaxIterations: process.env.DECISION_LOOP_MAX_ITERATIONS,
    logLevel: process.env.LOG_LEVEL,
  };
}

/** Parses and validates process.env. Throws with a full list of issues rather than the first only. */
export function parseConfig(env: Record<string, string | undefined> = readEnv()): AppConfig {
  const result = AppConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return result.data;
}

/** Parses and validates process.env, exiting the process on failure. Use this from the real entry point. */
export function loadConfig(): AppConfig {
  try {
    return parseConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
