/**
 * Pure (Cloudflare-free) helpers backing BoardStore: chunking maths and the
 * compaction threshold. Kept separate so unit tests can import them without
 * the @cloudflare/workers-types globals.
 * Story 4: persistence.
 */
import {
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
  SNAPSHOT_CHUNK_BYTES,
} from '../shared/config';

/** Origin marker for updates applied while loading from storage (not re-stored/broadcast). */
export const LOAD_ORIGIN = '__vidi6-load__';

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/**
 * Split `data` into chunks of at most `size` bytes.
 * Empty input → empty array.
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (data.length === 0) return [];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.slice(offset, offset + size));
  }
  return chunks;
}

/**
 * Concatenate chunks back into a single Uint8Array.
 */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Determine whether compaction should be triggered.
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}
