/**
 * Pure, storage-free helpers behind {@link BoardStore}: snapshot byte chunking and the
 * compaction-threshold decision. They touch no Durable Object types, so they can be unit
 * tested under the plain (DOM-lib) project without the Workers ambient. `board-store.ts`
 * re-exports them; the SQLite layer composes them with `storage.sql`.
 */
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../shared/config.js';

/** Split `data` into at most `size`-byte chunks (default {@link SNAPSHOT_CHUNK_BYTES}). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    chunks.push(data.subarray(offset, Math.min(offset + size, data.byteLength)));
  }
  return chunks;
}

/** Concatenate chunked byte arrays back into one, byte-identical to the original split. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Whether a log with `count` rows totalling `bytes` bytes should be compacted. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}
