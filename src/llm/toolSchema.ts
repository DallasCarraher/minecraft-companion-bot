import { z } from 'zod';
import type { SkillRegistry } from '../skills/registry.js';
import type { ToolSpec } from './types.js';

/**
 * Converts every registered skill's `argsSchema` into a plain JSON Schema tool spec. One function
 * serves both providers since both Anthropic's `input_schema` and OpenAI's `parameters` accept
 * plain JSON Schema. Skill schemas must be declared with `.strict()` so the emitted schema has
 * `additionalProperties: false` — required by both providers' strict tool-calling mode.
 */
export function buildToolSpecs(registry: SkillRegistry): ToolSpec[] {
  return registry.list().map((skill) => ({
    name: skill.name,
    description: skill.description,
    jsonSchema: z.toJSONSchema(skill.argsSchema as z.ZodType, { target: 'draft-7' }) as Record<
      string,
      unknown
    >,
  }));
}
