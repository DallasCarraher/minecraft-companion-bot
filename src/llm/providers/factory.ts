import type { AppConfig } from '../../config/env.js';
import type { LLMProvider } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';

/**
 * Adding a new provider (e.g. Groq) means: write `providers/groq.ts` implementing `LLMProvider`,
 * add one case here. Nothing else in the codebase changes.
 */
export function createLLMProvider(config: AppConfig): LLMProvider {
  switch (config.llmProvider) {
    case 'anthropic':
      if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is required');
      return new AnthropicProvider(config.anthropicApiKey, config.anthropicModelPrimary);
    case 'openai':
      if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is required');
      return new OpenAIProvider(config.openaiApiKey, config.openaiModelPrimary);
  }
}

/** The Sonnet escalation tier is Anthropic-only in v1 (see modelRouter.ts). */
export function createEscalationProvider(config: AppConfig): LLMProvider | undefined {
  if (config.llmProvider !== 'anthropic' || !config.anthropicApiKey) return undefined;
  return new AnthropicProvider(config.anthropicApiKey, config.anthropicModelEscalation);
}
