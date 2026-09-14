import { describe, expect, it } from 'vitest';
import { SkillRegistry } from '../../../src/skills/registry.js';
import { registerAllSkills } from '../../../src/skills/index.js';
import { buildToolSpecs } from '../../../src/llm/toolSchema.js';

describe('buildToolSpecs', () => {
  const registry = new SkillRegistry();
  registerAllSkills(registry);
  const specs = buildToolSpecs(registry);

  it('produces one spec per registered skill', () => {
    expect(specs.length).toBe(registry.list().length);
    expect(specs.length).toBeGreaterThan(0);
  });

  it.each(specs)(
    '$name schema is a strict object schema (additionalProperties: false + required set)',
    (spec) => {
      expect(spec.jsonSchema.type).toBe('object');
      expect(spec.jsonSchema.additionalProperties).toBe(false);

      // Every property must appear in `required` — both providers' strict tool-calling mode
      // rejects schemas with properties omitted from `required` (optional args must be
      // nullable-with-default instead, as combat.ts's attackNearest does for `target`). A
      // zero-property schema (e.g. stopCombat) legitimately has no `required` key at all.
      const properties = Object.keys((spec.jsonSchema.properties as Record<string, unknown>) ?? {});
      const required = (spec.jsonSchema.required as string[] | undefined) ?? [];
      expect(new Set(required)).toEqual(new Set(properties));
    },
  );
});
