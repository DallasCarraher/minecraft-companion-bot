import type { Registry } from 'prismarine-registry';
// prismarine-chat ships no types; mineflayer depends on it transitively so it's resolvable here.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const prismarineChat = require('prismarine-chat');

/**
 * Mineflayer types `kicked`/`end` reasons as `string`, but on modern protocol versions the
 * server sends a JSON chat-component object (e.g. `{ translate: 'disconnect.timeout' }` or
 * `{ text: 'Kicked for spamming' }`) and mineflayer forwards it unparsed. Interpolating that
 * into a template string collapses it to "[object Object]". This renders it into the actual
 * player-facing message, the same way the client would.
 */
export function formatKickReason(reason: unknown, registry: Registry): string {
  let parsed: unknown = reason;
  if (typeof parsed === 'string') {
    const raw = parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  if (parsed && typeof parsed === 'object') {
    try {
      const ChatMessage = prismarineChat(registry);
      return new ChatMessage(parsed).toString();
    } catch {
      return JSON.stringify(parsed);
    }
  }

  return String(parsed);
}
