/**
 * BoardStore — pure utility functions for chunking and compaction threshold.
 * Story 4 — persistence.
 *
 * The full BoardStore class (SQLite-backed Durable Object operations)
 * lives in src/worker/board-store-do.ts; this module exports the
 * portable pure helpers so they can be unit-tested without a DO instance.
 */
import {
  SNAPSHOT_CHUNK_BYTES,
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
} from '@/shared/config';

/**
 * Split a byte array into chunks of at most `size` bytes.
 * Returns an empty array for zero-length input.
 */
export function chunkBytes(data: Uint8Array, size?: number): Uint8Array[] {
  const chunkSize = size ?? SNAPSHOT_CHUNK_BYTES;
  if (data.length === 0 || chunkSize <= 0) return [];
  const result: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    result.push(data.slice(offset, offset + chunkSize));
  }
  return result;
}

/**
 * Concatenate chunks back into a single Uint8Array.
 */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Determine whether compaction should be triggered given the current
 * update log row count and total byte size.
 *
 * Compacts when EITHER threshold is met or exceeded.
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}
