// The snapshot chunking and the compaction decision, with nothing Workers-only in
// them: pure functions over bytes and counters. They live here, rather than in
// `worker/board-store.ts`, so a plain unit test over them does not have to import
// the Durable Object storage module (which only typechecks against the Workers
// globals, not the browser ones). `worker/board-store.ts` re-exports them, so the
// storage module and its integration test keep importing them from where they did.
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from './config';

/**
 * Split `data` into pieces of at most `size` bytes. Zero bytes make zero
 * chunks; a length that is an exact multiple makes no trailing empty chunk.
 */
export function chunkBytes(data: Uint8Array, size = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < data.length; start += size) {
    chunks.push(data.subarray(start, Math.min(start + size, data.length)));
  }
  return chunks;
}

/** Put the chunks back: exactly the bytes that were split, in order. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  return joined;
}

/** Fold the log into a snapshot at either threshold, not below both. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}
