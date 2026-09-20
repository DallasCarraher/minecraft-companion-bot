import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';

const LOG_PATH = '.scratch/packet-debug.jsonl';

// createBot runs again on every reconnect; truncate only once per process so a reconnect can't wipe the log.
let initialized = false;
// Parser is patched globally, so wrap it only once too (rewrapping would log each failure repeatedly).
let parserPatched = false;

/**
 * Dev-only protocol debugging, enabled with PACKET_DEBUG=1. Writes JSONL to .scratch/ (gitignored,
 * truncated each run) instead of flooding the terminal.
 *
 * - `error` lines: every parse failure, with the packet field, message, and the full raw hex.
 * - `dropped` lines: packets protodef swallowed. On a PartialReadError protodef only console.logs the
 *   stack and drops the packet (no `error` event, no `raw` event), so FullPacketParser#parsePacketBuffer is
 *   wrapped to capture the bytes and the error.
 * - `raw` lines: the undecoded bytes of packets named in PACKET_DEBUG_NAMES (comma-separated,
 *   default `entity_metadata`), so a failing packet can be compared with its successful neighbours.
 *   Use PACKET_DEBUG_NAMES=all to capture everything (large).
 */
export function attachPacketDebug(bot: Bot): void {
  if (!process.env.PACKET_DEBUG) return;

  mkdirSync(dirname(LOG_PATH), { recursive: true });
  if (!initialized) {
    writeFileSync(LOG_PATH, '');
    initialized = true;
  }
  const write = (entry: Record<string, unknown>) =>
    appendFileSync(LOG_PATH, `${JSON.stringify({ t: Date.now(), ...entry })}\n`);

  const names = (process.env.PACKET_DEBUG_NAMES ?? 'entity_metadata').split(',');
  const captureAll = names.includes('all');
  const client = bot._client;

  const { FullPacketParser } = createRequire(import.meta.url)('protodef') as {
    FullPacketParser: { prototype: { parsePacketBuffer(buf: Buffer): unknown } };
  };
  if (!parserPatched) {
    parserPatched = true;
    const original = FullPacketParser.prototype.parsePacketBuffer;
    FullPacketParser.prototype.parsePacketBuffer = function (this: unknown, buf: Buffer) {
      try {
        return original.call(this, buf);
      } catch (err) {
        const e = err as Error;
        write({
          kind: 'dropped',
          message: e.message,
          stack: e.stack?.split('\n').slice(0, 6),
          len: buf.length,
          hex: buf.toString('hex'),
        });
        throw err;
      }
    };
  }

  client.on('raw', (buf: Buffer, meta: { name: string; state: string }) => {
    if (captureAll || names.includes(meta.name)) {
      write({ kind: 'raw', state: meta.state, name: meta.name, len: buf.length, hex: buf.toString('hex') });
    }
  });

  client.on('error', (err: Error & { field?: string; buffer?: Buffer }) => {
    write({
      kind: 'error',
      field: err.field,
      message: err.message,
      len: err.buffer?.length,
      hex: err.buffer?.toString('hex'),
    });
  });
}
