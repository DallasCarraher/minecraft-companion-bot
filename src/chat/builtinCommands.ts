import type { MemoryStore } from '../memory/store.js';

export interface BuiltinCommandContext {
  memory: MemoryStore;
  cancelActive: () => void;
}

/**
 * Handles commands that must never cost an LLM call: `stop`, `status`, `help`. Returns the reply
 * text if `command` matched a built-in, or `null` if it should fall through to the decision loop.
 */
export function tryHandleBuiltinCommand(
  command: string,
  ctx: BuiltinCommandContext,
): string | null {
  switch (command.trim().toLowerCase()) {
    case 'stop':
      ctx.cancelActive();
      return 'Okay, I stopped what I was doing.';

    case 'status': {
      const { goal, taskQueue } = ctx.memory.snapshot;
      const active = taskQueue.find((task) => task.status === 'active');
      if (!goal && !active) return "I'm not doing anything right now.";
      return `Goal: ${goal?.description ?? '(none)'}. Active task: ${active?.description ?? '(none)'}.`;
    }

    case 'help':
      return (
        'Talk to me naturally! I can: go to/follow you or flee, collect blocks & equip the best tool, ' +
        'build structures, craft items, attack/stop fighting, and manage inventory (equip armor, drop junk, ' +
        'transfer via chest). Say "stop" to cancel, "status" to see what I\'m doing.'
      );

    default:
      return null;
  }
}
