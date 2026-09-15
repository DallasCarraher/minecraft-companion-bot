import { z } from 'zod';
import type { Skill } from '../skills/types.js';
import type { ToolSpec } from './types.js';

/**
 * Converts a list of skills' `argsSchema` into plain JSON Schema tool specs. One function serves
 * both providers since both Anthropic's `input_schema` and OpenAI's `parameters` accept plain JSON
 * Schema. Skill schemas must be declared with `.strict()` so the emitted schema has
 * `additionalProperties: false` — required by both providers' strict tool-calling mode.
 *
 * Callers pass whichever skills should be visible for this call — usually the output of
 * `filterRelevantSkills`, not necessarily every registered skill.
 */
export function buildToolSpecs(skills: Skill<unknown>[]): ToolSpec[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    jsonSchema: z.toJSONSchema(skill.argsSchema as z.ZodType, { target: 'draft-7' }) as Record<
      string,
      unknown
    >,
  }));
}
