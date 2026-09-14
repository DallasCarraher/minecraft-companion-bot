import { promises as fs } from 'node:fs';
import path from 'node:path';
import { debounce, type Debounced } from '../util/debounce.js';
import { CONVERSATION_HISTORY_LIMIT, MEMORY_WRITE_DEBOUNCE_MS } from '../config/constants.js';
import { BotStateSchema, createDefaultState, type BotState, type ChatTurn } from './types.js';

/**
 * Loads/persists a single realm's BotState as JSON under `<dataDir>/state.<realmId>.json`.
 *
 * Writes are debounced (trailing edge, `MEMORY_WRITE_DEBOUNCE_MS`) so a busy decision tick
 * doesn't hit disk on every field mutation, and atomic (write to `.tmp`, then rename over the
 * real file) so a crash mid-write can never leave a truncated/corrupt state file — the rename is
 * the only operation that touches the real path, and it's atomic at the filesystem level. Any
 * stale `.tmp` left over from a previous crash is simply never read (loads only ever look at the
 * real path), so it can't corrupt the next load either.
 */
export class MemoryStore {
  private readonly debouncedPersist: Debounced<[]>;

  private constructor(
    private state: BotState,
    private readonly filePath: string,
  ) {
    this.debouncedPersist = debounce(() => {
      void this.persistNow();
    }, MEMORY_WRITE_DEBOUNCE_MS);
  }

  static async loadOrCreate(
    realmId: string,
    dataDir: string,
    onLoadWarning?: (message: string) => void,
  ): Promise<MemoryStore> {
    await fs.mkdir(dataDir, { recursive: true });
    const filePath = path.join(dataDir, `state.${realmId}.json`);

    let state: BotState;
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = BotStateSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        state = parsed.data;
      } else {
        onLoadWarning?.(`Corrupt or incompatible state file at ${filePath}, starting fresh`);
        state = createDefaultState(realmId);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        onLoadWarning?.(`Failed to read state file at ${filePath}, starting fresh: ${String(err)}`);
      }
      state = createDefaultState(realmId);
    }

    return new MemoryStore(state, filePath);
  }

  get snapshot(): Readonly<BotState> {
    return this.state;
  }

  /** Synchronously mutates the in-memory state and schedules a debounced persist. */
  update(mutator: (draft: BotState) => void): void {
    mutator(this.state);
    this.debouncedPersist();
  }

  /** Appends a chat turn and trims the conversation window to CONVERSATION_HISTORY_LIMIT. */
  appendChatTurn(turn: ChatTurn): void {
    this.update((draft) => {
      draft.conversation.push(turn);
      const overflow = draft.conversation.length - CONVERSATION_HISTORY_LIMIT;
      if (overflow > 0) draft.conversation.splice(0, overflow);
    });
  }

  /** Cancels any pending debounced write and persists immediately. Call this on shutdown. */
  async flush(): Promise<void> {
    this.debouncedPersist.cancel();
    await this.persistNow();
  }

  private async persistNow(): Promise<void> {
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2), 'utf8');
    await fs.rename(tmpPath, this.filePath);
  }
}
