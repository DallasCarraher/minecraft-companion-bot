/**
 * Schema for one training example logged per skill call within a decision tick. Shape follows
 * the data-collection design in issue #11: a learned reward model will eventually train on these
 * records to predict skill success probability. Kept as a plain interface (not zod) because
 * `dataCollector.ts` only ever writes this shape — it doesn't need to validate untrusted input,
 * and `dataPrep.ts` (a later phase of #11) is where reading/validating JSONL back in matters.
 *
 * Treat this as a durable wire format once bots start writing JSONL with it: add fields, don't
 * rename or remove them, and bump `schemaVersion` on any breaking shape change so later tooling
 * (whether a trained sklearn/XGBoost model, a hosted classifier, or anything else) can branch on
 * version instead of requiring a fresh data-collection window.
 */
export interface DecisionTickData {
  /** Bump only on breaking changes to this shape; consumers should branch on this, not guess. */
  schemaVersion: 1;
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

  /**
   * Whether this action moved the active goal/task forward, from the issue's original schema.
   * Not populated by this phase (always `null` for now) — inferring it needs look-ahead across
   * later ticks, which is out of scope here. Reserved so a later phase can start filling it in
   * without changing the shape every consumer already reads.
   */
  goalProgress: 'on_track' | 'blocked' | 'completed' | 'failed' | null;
}
