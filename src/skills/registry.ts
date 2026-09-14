import type { Skill } from './types.js';

/**
 * Provider-agnostic collection of skills. Knows nothing about Anthropic/OpenAI — only
 * `llm/toolSchema.ts` converts entries here into provider tool formats.
 *
 * Stored/retrieved as `Skill<unknown>`: callers (the LLM decision loop) always validate raw JSON
 * tool-call args against `skill.argsSchema` at runtime before calling `run()`, so there's no
 * static benefit to threading each skill's specific `Args` type through the registry itself.
 */
export class SkillRegistry {
  private readonly skills = new Map<string, Skill<unknown>>();

  register(skill: Skill<unknown>): void {
    if (this.skills.has(skill.name)) {
      throw new Error(`Skill "${skill.name}" is already registered`);
    }
    this.skills.set(skill.name, skill);
  }

  get(name: string): Skill<unknown> | undefined {
    return this.skills.get(name);
  }

  list(): Skill<unknown>[] {
    return [...this.skills.values()];
  }
}
