import type { ChatTurn } from '../memory/types.js';

const ESCALATION_KEYWORDS = ['build', 'plan', 'design', 'base'];

/**
 * Deliberately simple v1 heuristic, not a pluggable policy: escalate to the Sonnet tier only when
 * repair has already failed twice in the same tick, or the trigger message hints at multi-step
 * planning. Revisit with real usage data once there's a signal for what actually needs escalation.
 */
export function chooseModelTier(
  triggerMessage: ChatTurn,
  consecutiveRepairFailures: number,
): 'primary' | 'escalation' {
  if (consecutiveRepairFailures >= 2) return 'escalation';

  const lower = triggerMessage.text.toLowerCase();
  if (ESCALATION_KEYWORDS.some((keyword) => lower.includes(keyword))) return 'escalation';

  return 'primary';
}
