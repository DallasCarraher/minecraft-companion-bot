/**
 * Schema for one training example logged per skill call within a decision tick. Shape follows
 * the data-collection design in issue #11: a learned reward model will eventually train on these
 * records to predict skill success probability. Kept as a plain interface (not zod) because
 * `dataCollector.ts` only ever writes this shape — it doesn't need to validate untrusted input,
 * and `dataPrep.ts` (a later phase of #11) is where reading/validating JSONL back in matters.
 */
export interface DecisionTickData {
  timestamp: string;
  tickId: string;

  context: {
    biome: string | null;
    timeOfDay: number;
    position: { x: number; y: number; z: number };
    health: number;
    inventory: { name: string; count: number }[];
    nearbyBlocks: string[];
    nearbyEntities: { name: string; isHostile: boolean; distance: number }[];
    goal: string | null;
    taskType: string | null;
    previousSkills: { name: string; ok: boolean }[];
  };

  action: {
    skillName: string;
    args: Record<string, unknown>;
  };

  outcome: {
    ok: boolean;
    message: string;
    executionTimeMs: number;
    data?: Record<string, unknown>;
  };
}
