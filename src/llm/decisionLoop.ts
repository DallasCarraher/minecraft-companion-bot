import type { Bot } from 'mineflayer';
import type { AppConfig } from '../config/env.js';
import { TOOL_REPAIR_RETRY_LIMIT } from '../config/constants.js';
import type { Logger } from '../logger/logger.js';
import type { MemoryStore } from '../memory/store.js';
import type { ChatTurn } from '../memory/types.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { SkillContext } from '../skills/types.js';
import { withTimeout } from '../util/abortable.js';
import { assembleDecisionContext, contextToMessage } from './contextBuilder.js';
import { chooseModelTier } from './modelRouter.js';
import { requestRepair } from './repair.js';
import { filterRelevantSkills } from './skillFilter.js';
import { buildToolSpecs } from './toolSchema.js';
import type { LLMProvider, NormalizedMessage, NormalizedToolResult } from './types.js';

export interface DecisionTickParams {
  bot: Bot;
  logger: Logger;
  memory: MemoryStore;
  config: AppConfig;
  registry: SkillRegistry;
  provider: LLMProvider;
  escalationProvider?: LLMProvider;
  triggerMessage: ChatTurn;
  systemPrompt: string;
  /** Tick-level cancellation: user said "stop", a new tick preempted this one, or the bot disconnected. */
  signal: AbortSignal;
  /** Sends an immediate chat line independent of the final reply (e.g. an "on it" ack). */
  say: (message: string) => void;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Runs one multi-step agentic decision tick: assembles world/memory context, lets the model call
 * tools (skills) in a loop until it produces a final chat reply or the iteration cap is hit.
 *
 * This is the one place the multi-turn loop, repair-retry, and model-escalation logic live —
 * provider adapters only implement a single stateless `createTurn`, so this function works
 * identically regardless of which provider(s) are configured.
 */
export async function runDecisionTick(params: DecisionTickParams): Promise<{ replyText: string }> {
  const { bot, logger, memory, config, registry, systemPrompt, triggerMessage, signal, say } =
    params;

  say('On it — working on that now.');

  const decisionContext = assembleDecisionContext(bot, memory, triggerMessage);
  const tools = buildToolSpecs(filterRelevantSkills(decisionContext, registry));
  const messages: NormalizedMessage[] = [contextToMessage(decisionContext)];

  let consecutiveRepairFailures = 0;

  for (let iteration = 0; iteration < config.decisionLoopMaxIterations; iteration++) {
    if (signal.aborted) return { replyText: 'Stopped.' };

    const tier = chooseModelTier(triggerMessage, consecutiveRepairFailures);
    const provider =
      tier === 'escalation' && params.escalationProvider
        ? params.escalationProvider
        : params.provider;

    const response = await provider.createTurn({ system: systemPrompt, messages, tools });

    if (response.stopReason !== 'tool_calls') {
      return { replyText: response.text ?? 'Done.' };
    }

    messages.push({ role: 'assistant', toolCalls: response.toolCalls });
    const toolResults: NormalizedToolResult[] = [];

    for (const call of response.toolCalls) {
      const skill = registry.get(call.name);
      if (!skill) {
        toolResults.push({
          toolCallId: call.id,
          content: `Unknown skill "${call.name}"`,
          isError: true,
        });
        continue;
      }

      let validated = skill.argsSchema.safeParse(safeParseJson(call.argsRaw));
      let currentCall = call;

      for (
        let repairAttempt = 0;
        !validated.success && repairAttempt < TOOL_REPAIR_RETRY_LIMIT;
        repairAttempt++
      ) {
        consecutiveRepairFailures++;
        const repaired = await requestRepair({
          provider,
          system: systemPrompt,
          tools,
          priorMessages: messages,
          failedCall: currentCall,
          validationError: validated.error.message,
        });
        if (!repaired) break;
        currentCall = repaired;
        validated = skill.argsSchema.safeParse(safeParseJson(repaired.argsRaw));
      }

      if (!validated.success) {
        toolResults.push({
          toolCallId: call.id,
          content: `Invalid arguments after repair: ${validated.error.message}`,
          isError: true,
        });
        continue;
      }
      consecutiveRepairFailures = 0;

      const skillCtx: Omit<SkillContext, 'signal'> = { bot, logger, memory, config, say };

      try {
        const result = await withTimeout(
          (innerSignal) => skill.run({ ...skillCtx, signal: innerSignal }, validated.data),
          skill.timeoutMs,
          signal,
        );
        toolResults.push({ toolCallId: call.id, content: result.message, isError: !result.ok });
      } catch (err) {
        toolResults.push({
          toolCallId: call.id,
          content: err instanceof Error ? err.message : String(err),
          isError: true,
        });
      }
    }

    messages.push({ role: 'tool', toolResults });
  }

  return {
    replyText: "That's taking more steps than expected — let me know if you want me to keep going.",
  };
}
