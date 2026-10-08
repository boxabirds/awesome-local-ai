/**
 * Snapshot chunking helpers for vidi6's durable storage (story 4).
 *
 * A compacted board snapshot is one Yjs update byte string, stored as rows
 * of at most SNAPSHOT_CHUNK_BYTES so no single BLOB approaches SQLite
 * limits. Load is: read chunks in idx order, concatenate, apply.
 *
 * These are pure and unit-tested without workerd (TC-01, TC-02); the
 * Durable Object side (src/worker/board-store.ts) re-exports them.
 */

import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from './config';

/**
 * Splits `data` into chunks of at most `size` bytes (the last chunk may be
 * shorter). An empty input yields zero chunks — an empty snapshot stores no
 * rows and reloads as an empty document.
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (data.byteLength === 0) {
    return [];
  }
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    chunks.push(data.subarray(offset, Math.min(offset + size, data.byteLength)));
  }
  return chunks;
}

/**
 * Concatenates chunks (in order) back into the original byte string.
 * `joinChunks(chunkBytes(x))` is byte-identical to `x`.
 */
export function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Compaction trigger: the log has grown enough that a full load would
 * replay too many rows (count threshold) or too many bytes (large-update
 * threshold). Both boundaries are inclusive (TC-02).
 */
export function shouldCompact(updateCount: number, updateBytes: number): boolean {
  return updateCount >= COMPACTION_UPDATE_COUNT || updateBytes >= COMPACTION_BYTES;
}
