import { SNAPSHOT_CHUNK_BYTES, COMPACTION_UPDATE_COUNT, COMPACTION_BYTES } from '../shared/config';

/**
 * Split data into chunks of at most `size` bytes.
 * Returns 0 chunks for empty input.
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (data.length === 0) return [];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  while (offset < data.length) {
    const end = Math.min(offset + size, data.length);
    chunks.push(data.slice(offset, end));
    offset = end;
  }
  return chunks;
}

/**
 * Join chunks back into a single Uint8Array.
 */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const c of chunks) totalLength += c.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

/**
 * Determine whether compaction should occur.
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}
