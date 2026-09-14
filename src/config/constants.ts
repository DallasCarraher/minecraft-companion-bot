/** Minecraft chat lines are truncated by the client around this length; keep replies under it. */
export const CHAT_CHUNK_LENGTH = 240;

/** How many recent chat turns are kept in memory as LLM context. */
export const CONVERSATION_HISTORY_LIMIT = 40;

/** How many times a malformed tool call is sent back to the model for repair before giving up. */
export const TOOL_REPAIR_RETRY_LIMIT = 1;

/** Debounce window for persisting memory to disk after an update. */
export const MEMORY_WRITE_DEBOUNCE_MS = 500;

/** Reconnect backoff bounds. */
export const RECONNECT_BACKOFF_INITIAL_MS = 2000;
export const RECONNECT_BACKOFF_MAX_MS = 60000;
export const RECONNECT_STABLE_UPTIME_MS = 30000;
