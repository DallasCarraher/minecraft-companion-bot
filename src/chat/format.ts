import { CHAT_CHUNK_LENGTH } from '../config/constants.js';

/** Splits a reply into Minecraft-chat-safe chunks, breaking on word boundaries where possible. */
export function chunkChatMessage(message: string, maxLength = CHAT_CHUNK_LENGTH): string[] {
  const chunks: string[] = [];
  let remaining = message.trim();

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt <= 0) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}
