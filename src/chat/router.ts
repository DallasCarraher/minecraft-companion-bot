import type { Bot } from 'mineflayer';
import type { AppConfig } from '../config/env.js';
import type { Logger } from '../logger/logger.js';
import type { MemoryStore } from '../memory/store.js';
import type { LLMProvider } from '../llm/types.js';
import { runDecisionTick } from '../llm/decisionLoop.js';
import type { SkillRegistry } from '../skills/registry.js';
import { buildSystemPrompt } from '../prompts/system.js';
import { tryHandleBuiltinCommand } from './builtinCommands.js';
import { chunkChatMessage } from './format.js';
import { CHAT_CHUNK_LENGTH } from '../config/constants.js';

export interface ChatRouterDeps {
  bot: Bot;
  memory: MemoryStore;
  provider: LLMProvider;
  escalationProvider?: LLMProvider;
  registry: SkillRegistry;
  config: AppConfig;
  logger: Logger;
}

/**
 * Wires `bot.on('chat', ...)` and `bot.on('whisper', ...)` to: trigger filtering -> built-in
 * commands (never touch the LLM) -> per-user cooldown -> single-flight decision tick dispatch.
 * Un-triggered chat is still recorded to memory as ambient context, but never reaches the LLM —
 * that plus the cooldown are the two cost-control levers described in docs/architecture.md.
 * Replies always go back over whichever channel (public chat vs. private `/tell`) the triggering
 * message arrived on, so a whispered conversation stays private end to end.
 */
export class ChatRouter {
  private activeController: AbortController | null = null;
  private activeGoalDescription: string | null = null;
  private readonly lastMessageAtByUser = new Map<string, number>();

  constructor(private readonly deps: ChatRouterDeps) {}

  attach(): void {
    const { bot, logger } = this.deps;
    bot.on('chat', (username, message) => {
      void this.handleChat(username, message, false).catch((err) => {
        logger.error({ err }, 'unhandled error in chat handler');
      });
    });
    bot.on('whisper', (username, message) => {
      void this.handleChat(username, message, true).catch((err) => {
        logger.error({ err }, 'unhandled error in whisper handler');
      });
    });
  }

  /** Cancels the in-flight decision tick's skill execution, if any. */
  cancelActive(): void {
    this.activeController?.abort();
  }

  private async handleChat(username: string, message: string, viaWhisper: boolean): Promise<void> {
    const { bot, memory, config, logger } = this.deps;
    if (username === bot.username) return;
    if (config.chatAllowlist.length > 0 && !config.chatAllowlist.includes(username)) return;

    const reply = (text: string) => this.sendReply(username, text, viaWhisper);

    memory.appendChatTurn({ role: 'user', username, text: message, at: new Date().toISOString() });

    // A whisper is already a direct, private address to the bot — it doesn't need the public
    // trigger (mention/prefix) to also be present.
    if (!viaWhisper && !this.isTriggered(message)) return;
    const strippedText = viaWhisper ? message.trim() : this.stripTrigger(message);

    const builtinReply = tryHandleBuiltinCommand(strippedText, {
      memory,
      cancelActive: () => this.cancelActive(),
    });
    if (builtinReply !== null) {
      reply(builtinReply);
      return;
    }

    const now = Date.now();
    const lastAt = this.lastMessageAtByUser.get(username) ?? 0;
    if (now - lastAt < config.chatCooldownMs) {
      reply('One sec...');
      return;
    }
    this.lastMessageAtByUser.set(username, now);

    if (this.activeController) {
      reply(
        `Still working on: ${this.activeGoalDescription ?? 'something'} — say "stop" if you want me to drop it.`,
      );
      return;
    }

    const controller = new AbortController();
    this.activeController = controller;
    this.activeGoalDescription = strippedText;

    try {
      const { replyText } = await runDecisionTick({
        bot,
        logger,
        memory,
        config,
        registry: this.deps.registry,
        provider: this.deps.provider,
        escalationProvider: this.deps.escalationProvider,
        triggerMessage: {
          role: 'user',
          username,
          text: strippedText,
          at: new Date().toISOString(),
        },
        systemPrompt: buildSystemPrompt(config),
        signal: controller.signal,
        say: (chatMessage) => reply(chatMessage),
      });
      // An abort (e.g. the "stop" built-in) already sent its own reply and cancelActive()'s
      // caller has moved on — don't also relay decisionLoop's own "Stopped." for this tick.
      if (controller.signal.aborted) return;
      reply(replyText);
      memory.appendChatTurn({ role: 'assistant', text: replyText, at: new Date().toISOString() });
    } catch (err) {
      logger.error({ err }, 'decision tick failed');
      reply('Something went wrong on my end — sorry!');
    } finally {
      this.activeController = null;
      this.activeGoalDescription = null;
    }
  }

  private isTriggered(message: string): boolean {
    const { config, bot } = this.deps;
    switch (config.chatTriggerMode) {
      case 'all':
        return true;
      case 'prefix':
        return message.trim().toLowerCase().startsWith(config.chatTriggerPrefix.toLowerCase());
      case 'mention':
        return message.toLowerCase().includes(bot.username.toLowerCase());
    }
  }

  private stripTrigger(message: string): string {
    const { config, bot } = this.deps;
    const trimmed = message.trim();

    if (
      config.chatTriggerMode === 'prefix' &&
      trimmed.toLowerCase().startsWith(config.chatTriggerPrefix.toLowerCase())
    ) {
      return trimmed.slice(config.chatTriggerPrefix.length).trim();
    }
    if (config.chatTriggerMode === 'mention') {
      return trimmed.replace(new RegExp(bot.username, 'ig'), '').trim();
    }
    return trimmed;
  }

  /** Sends `message` back over public chat or a private `/tell`, matching the inbound channel. */
  private sendReply(username: string, message: string, viaWhisper: boolean): void {
    const { bot } = this.deps;
    // /tell <username> <message> counts entirely against the same server-side chat length limit
    // as a plain chat message, so a whisper's budget is smaller by however much the command and
    // username cost.
    const maxLength = viaWhisper
      ? CHAT_CHUNK_LENGTH - `/tell ${username} `.length
      : CHAT_CHUNK_LENGTH;

    for (const chunk of chunkChatMessage(message, maxLength)) {
      if (viaWhisper) {
        bot.whisper(username, chunk);
      } else {
        bot.chat(chunk);
      }
    }
  }
}
